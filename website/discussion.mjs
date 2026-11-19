import {randomUUID} from 'node:crypto';
import {recordGovernanceAction as recordAction} from './governance.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const value=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)fail(400,'标题或正文为空或过长');return s.trim()};
export function createDiscussion({db,identity,body,send}){
 db.exec(`CREATE TABLE IF NOT EXISTS discussion_posts(
 id TEXT PRIMARY KEY,topic_id TEXT REFERENCES discussion_posts(id),user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS discussion_topic ON discussion_posts(topic_id,created,id);
 CREATE TABLE IF NOT EXISTS discussion_history(id INTEGER PRIMARY KEY,post_id TEXT NOT NULL REFERENCES discussion_posts(id),version INTEGER NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,hidden INTEGER NOT NULL,created TEXT NOT NULL,UNIQUE(post_id,version));`);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 const get=id=>{const p=db.prepare('SELECT p.*,u.username FROM discussion_posts p JOIN users u ON u.id=p.user_id WHERE p.id=?').get(id);if(!p)fail(404,'帖子不存在');return p};
 const admin=u=>u?.role==='admin'&&u.canEdit;
 const readable=(p,u)=>{if((p.hidden||(p.topic_id&&get(p.topic_id).hidden))&&!admin(u))fail(404,'帖子不存在')};
 const snapshot=(p,u)=>db.prepare('INSERT INTO discussion_history(post_id,version,user_id,title,body,hidden,created) VALUES(?,?,?,?,?,?,?)').run(p.id,p.version,u.id,p.title,p.body,p.hidden,new Date().toISOString());
 function rate(u){const key='discussion:'+u.id,t=Date.now(),r=db.prepare('SELECT * FROM auth_limits WHERE bucket=?').get(key);if(r&&r.until>t&&r.n>=20)fail(429,'讨论操作过于频繁，请稍后重试');db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=CASE WHEN until<=? THEN 1 ELSE n+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END').run(key,t+60000,t,t)}
 return async(req,res,p,url)=>{
  if(p[1]!=='discussion')return false;
  const u=identity.current(req),method=req.method;
  if(method==='GET'){
   const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail(400,'页码不正确');
   const offset=(page-1)*30;
   if(p.length===2){
    const hidden=admin(u)&&url.searchParams.get('hidden')==='1';
    const rows=db.prepare(`SELECT p.id,p.title,p.user_id,p.hidden,p.version,p.created,p.updated,u.username,
     (SELECT count(*) FROM discussion_posts r WHERE r.topic_id=p.id AND r.hidden=0) AS replies
     FROM discussion_posts p JOIN users u ON u.id=p.user_id WHERE p.topic_id IS NULL AND (?=1 OR p.hidden=0) ORDER BY p.created DESC,p.id DESC LIMIT 31 OFFSET ?`).all(hidden?1:0,offset);
    send(res,200,{topics:rows.slice(0,30),more:rows.length>30});return true;
   }
   const post=get(p[2]);readable(post,u);
   if(p.length===4&&p[3]==='history'){
    if(!u?.canEdit||(u.id!==post.user_id&&!admin(u)))fail(403,'仅作者与管理员可查看编辑记录');
    const rows=db.prepare('SELECT h.*,u.username FROM discussion_history h JOIN users u ON u.id=h.user_id WHERE post_id=? ORDER BY version DESC LIMIT 31 OFFSET ?').all(post.id,offset);
    send(res,200,{history:rows.slice(0,30),more:rows.length>30});return true;
   }
   if(p.length!==3||post.topic_id)fail(404,'主题不存在');
   const rows=db.prepare('SELECT p.*,u.username FROM discussion_posts p JOIN users u ON u.id=p.user_id WHERE topic_id=? AND (?=1 OR hidden=0) ORDER BY p.created,p.id LIMIT 31 OFFSET ?').all(post.id,admin(u)?1:0,offset);
   send(res,200,{topic:post,replies:rows.slice(0,30),more:rows.length>30});return true;
  }
  if(!['POST','PUT'].includes(method))fail(405,'方法不允许');
  req.requireEditor=true;identity.requireEditor(req);const b=await body(req,100000),actor=identity.requireEditor(req);
  const result=tx(()=>{
   rate(actor);
   if(method==='POST'&&(p.length===2||(p.length===4&&p[3]==='replies'))){
    const parent=p.length===4?get(p[2]):null;if(parent){readable(parent,actor);if(parent.topic_id||parent.hidden)fail(409,'此主题不能回复')}
    const id=randomUUID(),stamp=new Date().toISOString(),title=parent?'':value(b.title,120),content=value(b.body,20000);
    db.prepare('INSERT INTO discussion_posts(id,topic_id,user_id,title,body,created,updated) VALUES(?,?,?,?,?,?,?)').run(id,parent?.id||null,actor.id,title,content,stamp,stamp);snapshot(get(id),actor);return get(id);
   }
   const post=get(p[2]);readable(post,actor);
   if(!Number.isSafeInteger(b.version)||b.version!==post.version)fail(409,'帖子已变化，请刷新后重试；未保存的内容仍保留');
   if(method==='PUT'&&p.length===3){
    if(actor.id!==post.user_id)fail(403,'只能编辑自己的帖子');if(post.hidden||(post.topic_id&&get(post.topic_id).hidden))fail(409,'隐藏帖子不能编辑');
    db.prepare('UPDATE discussion_posts SET title=?,body=?,version=version+1,updated=? WHERE id=?').run(post.topic_id?'':value(b.title,120),value(b.body,20000),new Date().toISOString(),post.id);
   }else if(method==='POST'&&p.length===4&&p[3]==='moderate'){
    if(!admin(actor))fail(403,'需要管理员权限');if(typeof b.hidden!=='boolean')fail(400,'隐藏状态不正确');const reason=value(b.reason,300);
    db.prepare('UPDATE discussion_posts SET hidden=?,version=version+1 WHERE id=?').run(b.hidden?1:0,post.id);
    recordAction(db,{actorId:actor.id,action:b.hidden?'discussion.hide':'discussion.restore',targetType:'discussion',targetId:post.id,before:{hidden:!!post.hidden,version:post.version},after:{hidden:b.hidden,version:post.version+1},reason});
   }else fail(404,'讨论接口不存在');
   snapshot(get(post.id),actor);return get(post.id);
  });
  send(res,method==='PUT'?200:201,{post:result});return true;
 };
}
