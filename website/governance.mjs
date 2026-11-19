const fault=(status,message)=>Object.assign(new Error(message),{status});
export function migrateGovernance(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const [table,name,definition] of [['users','moderation_version','INTEGER NOT NULL DEFAULT 0'],['comments','hidden','INTEGER NOT NULL DEFAULT 0'],['comments','version','INTEGER NOT NULL DEFAULT 1']]){
   if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS admin_actions(
   id INTEGER PRIMARY KEY,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,
   target_type TEXT NOT NULL,target_id TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,
   reason TEXT NOT NULL,created TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS admin_actions_target ON admin_actions(target_type,target_id,id);`);
  if(!db.prepare('PRAGMA table_info(admin_actions)').all().some(c=>c.name==='source')){
   // Known maintenance actions have no web writer. Preserve ambiguous historical rows in the feed.
   db.exec(`ALTER TABLE admin_actions ADD COLUMN source TEXT NOT NULL DEFAULT 'maintenance' CHECK(source IN ('maintenance','governance'));
    UPDATE admin_actions SET source='governance'
    WHERE action NOT IN ('course.import','course.rename','document.import','document.layout','document.rename','markdown-migration','split','subject-migration','user.promote')
    AND NOT (action='course.archive' AND reason IN (
     '按站长要求整理数学分析课程目录（服务器维护）',
     '本模块无对应课名，保留原资料和恢复历史',
     '按用户要求移除本模块无对应课名的原课程；保留可恢复记录'))
    AND NOT (action='course.reorder' AND reason IN ('按本地资料次序排列','沿用旧站课程目录次序'))
    AND NOT (action='course.create' AND reason='按用户要求将I和II课程分开');`);
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
function insertAction(db,{actorId=null,action,targetType,targetId,before={},after={},reason=''},governance){
 const source=governance?',source':'';
 const value=governance?",'governance'":"";
 db.prepare(`INSERT INTO admin_actions(actor_id,action,target_type,target_id,before_json,after_json,reason,created${source}) VALUES(?,?,?,?,?,?,?,?${value})`)
  .run(actorId,action,targetType,String(targetId),JSON.stringify(before),JSON.stringify(after),reason,new Date().toISOString());
}
export function recordAction(db,action){insertAction(db,action,false)}
export function recordGovernanceAction(db,action){insertAction(db,action,true)}
export function createGovernance({db,identity,body,send,recent,undoRecent}){
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}};
 function administrator(req,write=false){const u=write?identity.requireEditor(req):identity.current(req);if(!u)throw fault(401,'请先登录');if(u.role!=='admin'||!u.canEdit)throw fault(403,'需要已验证邮箱的管理员');return u}
 function reason(b){if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>300)throw fault(400,'请填写不超过300字的操作原因');return b.reason.trim()}
 function matchVersion(value,expected){if(!Number.isSafeInteger(value)||value!==expected)throw fault(409,'状态已变化，请刷新后重试')}
 return async function handle(req,res,p,url){
  if(p[1]!=='admin')return false;
  administrator(req,req.method!=='GET');
  if(req.method==='GET'){
   if(p[2]==='recent'&&p.length===3){const before=url.searchParams.get('before')||0;const out=recent(before,{daily:url.searchParams.get('daily')==='1',minChange:url.searchParams.get('minChange')||0,sort:url.searchParams.get('sort')||'time'});send(res,200,out);return true;}
   const before=url.searchParams.get('before');if(before!==null&&!/^[1-9][0-9]{0,14}$/.test(before))throw fault(400,'分页位置不正确');
   const cursor=before?Number(before):Number.MAX_SAFE_INTEGER;let rows,key;
   if(p[2]==='users'&&p.length===3){
    const q=(url.searchParams.get('q')||'').trim().slice(0,80);key='users';
    rows=db.prepare('SELECT rowid AS cursor,id,username,role,blocked,moderation_version,email_verified_at IS NOT NULL AS verified,created FROM users WHERE rowid<? AND instr(lower(username),lower(?))>0 ORDER BY rowid DESC LIMIT 101').all(cursor,q);
   }else if(p[2]==='comments'&&p.length===3){
    key='comments';rows=db.prepare('SELECT c.*,c.id AS cursor,u.username,d.title AS document_title FROM comments c JOIN users u ON u.id=c.user_id JOIN documents d ON d.id=c.document_id WHERE c.id<? ORDER BY c.id DESC LIMIT 101').all(cursor);
   }else if(p[2]==='actions'&&p.length===3){
    key='actions';rows=db.prepare(`SELECT a.id,a.actor_id,a.action,a.target_type,a.target_id,a.before_json,a.after_json,a.reason,a.created,
     a.id AS cursor,coalesce(u.username,'本机维护者') AS actor FROM admin_actions a LEFT JOIN users u ON u.id=a.actor_id
     WHERE a.id<? AND a.source='governance' ORDER BY a.id DESC LIMIT 101`).all(cursor);
   }else throw fault(404,'管理接口不存在');
   const more=rows.length>100;rows=rows.slice(0,100);send(res,200,{[key]:rows,nextBefore:more?rows.at(-1).cursor:null});return true;
  }
  if(req.method==='POST'&&p[2]==='recent'&&p.length===6&&p[5]==='undo'){
   req.requireEditor=true;const b=await body(req),u=administrator(req,true),why=reason(b);undoRecent(p[3],p[4],u,why);send(res,200,{ok:true});return true;
  }
  if(req.method!=='POST'||p.length!==5)throw fault(404,'管理接口不存在');
  req.requireEditor=true;const b=await body(req),u=administrator(req,true),why=reason(b);
  if(p[2]==='users'&&p[4]==='block'){
   if(typeof b.blocked!=='boolean')throw fault(400,'封禁状态不正确');
   transaction(()=>{
    const target=db.prepare('SELECT id,role,blocked,moderation_version,email_verified_at FROM users WHERE id=?').get(p[3]);if(!target)throw fault(404,'账号不存在');
    matchVersion(b.version,target.moderation_version);
    if(b.blocked&&target.id===u.id)throw fault(409,'不能封禁当前登录的管理员');
    if(b.blocked&&target.role==='admin'&&!target.blocked&&target.email_verified_at&&db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND blocked=0 AND email_verified_at IS NOT NULL").get().n<=1)throw fault(409,'不能封禁最后一位可用管理员');
    db.prepare('UPDATE users SET blocked=?,moderation_version=moderation_version+1 WHERE id=?').run(b.blocked?1:0,target.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(target.id);
    recordGovernanceAction(db,{actorId:u.id,action:b.blocked?'user.block':'user.unblock',targetType:'user',targetId:target.id,before:{blocked:!!target.blocked,version:target.moderation_version},after:{blocked:b.blocked,version:target.moderation_version+1},reason:why});
   });
  }else if(p[2]==='comments'&&p[4]==='moderate'){
   if(typeof b.hidden!=='boolean')throw fault(400,'评论状态不正确');
   transaction(()=>{
    const target=db.prepare('SELECT * FROM comments WHERE id=?').get(p[3]);if(!target)throw fault(404,'评论不存在');matchVersion(b.version,target.version);
    db.prepare('UPDATE comments SET hidden=?,version=version+1 WHERE id=?').run(b.hidden?1:0,target.id);
    recordGovernanceAction(db,{actorId:u.id,action:b.hidden?'comment.hide':'comment.restore',targetType:'comment',targetId:target.id,before:{hidden:!!target.hidden,version:target.version},after:{hidden:b.hidden,version:target.version+1},reason:why});
   });
  }else throw fault(404,'管理接口不存在');
  send(res,200,{ok:true});return true;
 };
}
