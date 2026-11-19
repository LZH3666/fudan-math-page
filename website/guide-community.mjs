import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {recordGovernanceAction as recordAction} from './governance.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'内容为空或过长');return v.trim()};
const fileName=/^[a-f0-9]{64}\.(pdf|md)$/;
export function createGuideCommunity({db,identity,body,send,dataDir,getEntry,snapshot}){
 const directory=path.join(dataDir,'guide-files');fs.mkdirSync(directory,{recursive:true});
 db.exec(`CREATE TABLE IF NOT EXISTS atlas_share_files(id TEXT PRIMARY KEY,filename TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),entry_id TEXT REFERENCES atlas_entries(id),created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS atlas_share_votes(entry_id TEXT NOT NULL REFERENCES atlas_entries(id),user_id TEXT NOT NULL REFERENCES users(id),value INTEGER NOT NULL CHECK(value IN (-1,1)),PRIMARY KEY(entry_id,user_id));
 CREATE TABLE IF NOT EXISTS atlas_share_comments(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES atlas_entries(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS atlas_share_comment_parent ON atlas_share_comments(entry_id,created,id);
 CREATE TABLE IF NOT EXISTS atlas_share_comment_history(id INTEGER PRIMARY KEY,comment_id TEXT NOT NULL REFERENCES atlas_share_comments(id),version INTEGER NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),snapshot TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(comment_id,version));`);
 const admin=u=>u?.canEdit&&u.role==='admin';
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}};
 const rate=u=>{const t=Date.now(),key='atlas:'+u.id,r=db.prepare('SELECT * FROM auth_limits WHERE bucket=?').get(key);if(r&&r.until>t&&r.n>=20)fail(429,'操作过于频繁，请稍后重试');db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=CASE WHEN until<=? THEN 1 ELSE n+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END').run(key,t+60000,t,t)};
 const parent=(id,u,write=false)=>{const r=getEntry(id);if(r.kind!=='guide'||(r.hidden&&!admin(u)))fail(404,'分享不存在');if(write&&r.hidden)fail(409,'隐藏分享不能互动');return r};
 const resourceIds=r=>JSON.parse(r?.resources||'{"attachments":[],"links":[]}');
 const publicFile=r=>({id:r.id,name:r.name,mime:r.mime,size:r.size,url:'/api/atlas/files/'+r.id});
 function resources(r){if(r.kind!=='guide')return r;const refs=resourceIds(r);return {...r,attachments:refs.attachments.map(id=>db.prepare('SELECT * FROM atlas_share_files WHERE id=?').get(id)).filter(Boolean).map(publicFile),links:refs.links};}
 function decorate(r,u){r=resources(r);if(r.kind!=='guide')return r;const counts=db.prepare('SELECT coalesce(sum(value=1),0) likes,coalesce(sum(value=-1),0) dislikes FROM atlas_share_votes WHERE entry_id=?').get(r.id);return {...r,featured:!!r.featured,...counts,my_vote:u?db.prepare('SELECT value FROM atlas_share_votes WHERE entry_id=? AND user_id=?').get(r.id,u.id)?.value||0:0,comment_count:db.prepare('SELECT count(*) n FROM atlas_share_comments WHERE entry_id=? AND hidden=0').get(r.id).n};}
 function prepareResources(b,old,u){
  const prior=resourceIds(old),ids=b.attachments??prior.attachments,links=b.links??prior.links;
  if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))fail(400,'每条分享最多3个附件');
  if(!Array.isArray(links)||links.length>10)fail(400,'每条分享最多10个网页链接');
  const clean=links.map(value=>{const s=text(value,2000);let url;try{url=new URL(s)}catch{fail(400,'请填写完整的http或https网页链接')}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail(400,'网页链接格式不正确');return url.href});
  for(const id of ids){const file=db.prepare('SELECT * FROM atlas_share_files WHERE id=?').get(id);if(!file||(!file.entry_id&&file.user_id!==u.id)||(file.entry_id&&file.entry_id!==old?.id))fail(400,'附件不属于当前分享或上传者');}
  return JSON.stringify({attachments:ids,links:[...new Set(clean)]});
 }
 function bindFiles(id,refs){for(const file of JSON.parse(refs).attachments)db.prepare('UPDATE atlas_share_files SET entry_id=? WHERE id=? AND entry_id IS NULL').run(id,file)}
 const comment=(id,entry)=>{const r=db.prepare('SELECT c.*,u.username FROM atlas_share_comments c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.entry_id=?').get(id,entry);if(!r)fail(404,'评论不存在');return r};
 const commentSnapshot=(r,u)=>db.prepare('INSERT INTO atlas_share_comment_history(comment_id,version,actor_id,snapshot,created) VALUES(?,?,?,?,?)').run(r.id,r.version,u.id,JSON.stringify(r),new Date().toISOString());
 async function handle(req,res,p,url){
  const upload=p[2]==='uploads',download=p[2]==='files',interaction=p[2]==='entries'&&['vote','feature','comments'].includes(p[4]);if(!upload&&!download&&!interaction)return false;
  const u=identity.current(req),method=req.method;
  if(download){
   if(!['GET','HEAD'].includes(method)||p.length!==4)fail(404,'附件不存在');const f=db.prepare('SELECT * FROM atlas_share_files WHERE id=?').get(p[3]);if(!f||!fileName.test(f.filename))fail(404,'附件不存在');
   if(f.entry_id)parent(f.entry_id,u);else if(u?.id!==f.user_id)fail(404,'附件不存在');
   const target=path.join(directory,f.filename);if(!fs.existsSync(target)||!fs.statSync(target).isFile())fail(404,'附件不存在');
   res.writeHead(200,{'Content-Type':f.mime,'Content-Disposition':(f.mime==='application/pdf'?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(f.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':f.size});if(method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);return true;
  }
  if(method==='GET'&&interaction){
   parent(p[3],u);if(p[4]!=='comments')fail(405,'方法不允许');const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail(400,'页码不正确');
   if(p.length===5){const rows=db.prepare('SELECT c.*,u.username FROM atlas_share_comments c JOIN users u ON u.id=c.user_id WHERE entry_id=? AND (?=1 OR hidden=0) ORDER BY created,id LIMIT 31 OFFSET ?').all(p[3],admin(u)?1:0,(page-1)*30);send(res,200,{comments:rows.slice(0,30),more:rows.length>30});return true;}
   const c=comment(p[5],p[3]);if(c.hidden&&!admin(u))fail(404,'评论不存在');
   if(p.length===7&&p[6]==='history'){const rows=db.prepare('SELECT h.version,h.snapshot,h.created,u.username FROM atlas_share_comment_history h JOIN users u ON u.id=h.actor_id WHERE comment_id=? ORDER BY version DESC LIMIT 31 OFFSET ?').all(c.id,(page-1)*30);send(res,200,{history:rows.slice(0,30),more:rows.length>30});return true;}fail(404,'评论接口不存在');
  }
  if(!['POST','PUT'].includes(method))fail(405,'方法不允许');req.requireEditor=true;identity.requireEditor(req);const b=await body(req,upload?7500000:100000),actor=identity.requireEditor(req);
  if(upload){
   if(method!=='POST'||p.length!==3)fail(404,'附件接口不存在');const name=text(b.name,180);if(/[\x00-\x1f\\/]/.test(name)||!/^.+\.(?:pdf|md|markdown)$/i.test(name))fail(400,'仅支持PDF和Markdown文件');if(typeof b.data==='string'&&b.data.length>Math.ceil(5*1024*1024/3)*4)fail(413,'每个附件不能超过5 MB');if(typeof b.data!=='string'||!b.data||b.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.data))fail(400,'附件数据不正确');
   const bytes=Buffer.from(b.data,'base64');if(bytes.length>5*1024*1024)fail(413,'每个附件不能超过5 MB');if(!bytes.length)fail(400,'附件不能为空');let ext,mime;
   if(/\.pdf$/i.test(name)){if(!bytes.subarray(0,8).toString().startsWith('%PDF-')||!bytes.subarray(-1024).includes(Buffer.from('%%EOF')))fail(400,'PDF文件格式不正确');ext='pdf';mime='application/pdf';}
   else{try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\0'))throw Error()}catch{fail(400,'Markdown须为UTF-8文本')}ext='md';mime='text/markdown; charset=utf-8';}
   const filename=createHash('sha256').update(bytes).digest('hex')+'.'+ext,id=randomUUID();tx(()=>{rate(actor);const target=path.join(directory,filename);try{fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e;if(!fs.readFileSync(target).equals(bytes))fail(409,'附件文件校验失败')}db.prepare('INSERT INTO atlas_share_files(id,filename,name,mime,size,user_id,created) VALUES(?,?,?,?,?,?,?)').run(id,filename,name,mime,bytes.length,actor.id,new Date().toISOString())});send(res,201,{file:publicFile(db.prepare('SELECT * FROM atlas_share_files WHERE id=?').get(id))});return true;
  }
  const result=tx(()=>{
   const r=parent(p[3],actor,true);rate(actor);
   if(p[4]==='vote'&&p.length===5&&method==='POST'){
    if(![0,1,-1].includes(b.value))fail(400,'赞踩值不正确');if(b.value===0)db.prepare('DELETE FROM atlas_share_votes WHERE entry_id=? AND user_id=?').run(r.id,actor.id);else db.prepare('INSERT INTO atlas_share_votes VALUES(?,?,?) ON CONFLICT(entry_id,user_id) DO UPDATE SET value=excluded.value').run(r.id,actor.id,b.value);return {entry:decorate(getEntry(r.id),actor)};
   }
   if(p[4]==='feature'&&p.length===5&&method==='POST'){
    if(!admin(actor))fail(403,'需要管理员权限');if(typeof b.featured!=='boolean')fail(400,'精华状态不正确');if(b.version!==r.version)fail(409,'分享已变化，请刷新');const reason=text(b.reason,300);
    db.prepare('UPDATE atlas_entries SET featured=?,version=version+1,updated=? WHERE id=?').run(b.featured?1:0,new Date().toISOString(),r.id);snapshot(getEntry(r.id),actor);recordAction(db,{actorId:actor.id,action:b.featured?'atlas.feature':'atlas.unfeature',targetType:'atlas',targetId:r.id,before:{featured:!!r.featured,version:r.version},after:{featured:b.featured,version:r.version+1},reason});return {entry:decorate(getEntry(r.id),actor)};
   }
   if(p[4]!=='comments')fail(404,'互动接口不存在');
   if(p.length===5&&method==='POST'){const id=randomUUID(),stamp=new Date().toISOString();db.prepare('INSERT INTO atlas_share_comments(id,entry_id,user_id,body,created,updated) VALUES(?,?,?,?,?,?)').run(id,r.id,actor.id,text(b.body,5000),stamp,stamp);const c=comment(id,r.id);commentSnapshot(c,actor);return {comment:c};}
   const c=comment(p[5],r.id);if(c.hidden&&!admin(actor))fail(404,'评论不存在');if(!Number.isSafeInteger(b.version)||b.version!==c.version)fail(409,'评论已变化，请保留正文并刷新');
   if(p.length===6&&method==='PUT'){if(c.hidden)fail(409,'隐藏评论不能编辑');if(c.user_id!==actor.id)fail(403,'只能编辑自己的评论');db.prepare('UPDATE atlas_share_comments SET body=?,version=version+1,updated=? WHERE id=?').run(text(b.body,5000),new Date().toISOString(),c.id);}
   else if(p.length===7&&p[6]==='moderate'&&method==='POST'){if(!admin(actor))fail(403,'需要管理员权限');if(typeof b.hidden!=='boolean')fail(400,'隐藏状态不正确');const reason=text(b.reason,300);db.prepare('UPDATE atlas_share_comments SET hidden=?,version=version+1,updated=? WHERE id=?').run(b.hidden?1:0,new Date().toISOString(),c.id);recordAction(db,{actorId:actor.id,action:b.hidden?'atlas.comment.hide':'atlas.comment.restore',targetType:'atlas-comment',targetId:c.id,before:{hidden:!!c.hidden,version:c.version},after:{hidden:b.hidden,version:c.version+1},reason});}
   else fail(404,'评论接口不存在');const updated=comment(c.id,r.id);commentSnapshot(updated,actor);return {comment:updated};
  });send(res,method==='PUT'?200:201,result);return true;
 }
 return {handle,resources,decorate,prepareResources,bindFiles};
}
