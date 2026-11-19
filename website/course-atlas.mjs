import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {recordGovernanceAction as recordAction} from './governance.mjs';
import {createCourseRatings} from './course-ratings.mjs';
import {academicTerms} from './dist/course-rating.mjs';
import {prepareCatalog,findCourse,courseIds,courseOfferings} from './dist/course-model.mjs';
import {createGuideCommunity} from './guide-community.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const text=(v,max,optional=false)=>{if(typeof v!=='string'||v.length>max||(!optional&&!v.trim()))fail(400,'内容为空或过长');return v.trim()};
export function createCourseAtlas({db,identity,body,send,catalogPath,dataDir}){
 let catalog,stamp;
 const extraPath=path.join(path.dirname(catalogPath),'university-courses.json');
 const fullPath=path.join(path.dirname(catalogPath),'full-reviews.json');
 const load=()=>{if(!fs.existsSync(catalogPath))fail(503,'课程数据尚未准备好');const next=[catalogPath,extraPath,fullPath].map(p=>fs.existsSync(p)?fs.statSync(p).mtimeMs:0).join(':');if(next!==stamp){const base=JSON.parse(fs.readFileSync(catalogPath,'utf8')),extra=fs.existsSync(extraPath)?JSON.parse(fs.readFileSync(extraPath,'utf8')):{},full=fs.existsSync(fullPath)?JSON.parse(fs.readFileSync(fullPath,'utf8')):{};catalog=prepareCatalog({...base,full_reviews:full.reviews||[]},extra);stamp=next}return catalog};
 const courseExists=id=>!!findCourse(load(),id),group=id=>findCourse(load(),id),courseIdsFor=id=>courseIds(group(id));
 const validateContext=(b,courseId)=>{const term=text(b.term,80);if(!academicTerms().includes(term))fail(400,'请选择2022—2023秋至当前学期之间的修读学期');const g=group(courseId),offerings=courseOfferings(g).filter(o=>o.term===term);if(offerings.length){const offering=offerings.find(o=>o.id===b.offeringId);if(!offering)fail(400,'请选择该学期本课程的具体教学班');return {teacher:offering.teachers.join('、'),term,offering_id:offering.id}}if(b.offeringId)fail(400,'该学期暂无已收录的教学班，请清空教学班选择');return {teacher:text(b.teacher??'',100,true),term,offering_id:''}};
 const importedScoresFor=id=>{const g=group(id),groups=new Set(g.source_group_ids||[]);return (load().full_reviews||[]).filter(r=>groups.has(r.group_id)&&Number.isInteger(r.overall_score)&&r.overall_score>=1&&r.overall_score<=5).map(r=>({teacher:r.teacher||'',overall_score:r.overall_score}))};
 const ratings=createCourseRatings({db,identity,body,send,courseExists,validateContext,courseIdsFor,canonicalId:id=>group(id).id,importedScoresFor});
 db.exec(`CREATE TABLE IF NOT EXISTS atlas_entries(id TEXT PRIMARY KEY,kind TEXT NOT NULL,course_id TEXT,teacher TEXT NOT NULL,term TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS atlas_course ON atlas_entries(kind,course_id,updated);
 CREATE TABLE IF NOT EXISTS atlas_history(id INTEGER PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES atlas_entries(id),version INTEGER NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),snapshot TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(entry_id,version));`);
 if(!db.prepare('PRAGMA table_info(atlas_entries)').all().some(c=>c.name==='offering_id'))db.exec("ALTER TABLE atlas_entries ADD COLUMN offering_id TEXT NOT NULL DEFAULT ''");
 for(const [name,definition] of [['resources',"TEXT NOT NULL DEFAULT '{\"attachments\":[],\"links\":[]}'"],['featured','INTEGER NOT NULL DEFAULT 0']])if(!db.prepare('PRAGMA table_info(atlas_entries)').all().some(c=>c.name===name))db.exec('ALTER TABLE atlas_entries ADD COLUMN '+name+' '+definition);
 let community;
 const admin=u=>u?.canEdit&&u.role==='admin';
 const get=id=>{const r=db.prepare('SELECT e.*,u.username FROM atlas_entries e JOIN users u ON u.id=e.user_id WHERE e.id=?').get(id);if(!r)fail(404,'内容不存在');return community?community.resources(r):r};
 const readable=(r,u)=>{if(r.hidden&&!admin(u))fail(404,'内容不存在')};
 const snapshot=(r,u)=>db.prepare('INSERT INTO atlas_history(entry_id,version,actor_id,snapshot,created) VALUES(?,?,?,?,?)').run(r.id,r.version,u.id,JSON.stringify(r),new Date().toISOString());
 const fields=(b,guide=false)=>({title:guide&&(b.title==null||b.title==='')?'选课经验分享':text(b.title,120),body:text(b.body??'',20000,guide),teacher:text(b.teacher??'',100,true),term:text(b.term??'',80,true)});
 community=createGuideCommunity({db,identity,body,send,dataDir,getEntry:get,snapshot});
 return async(req,res,p,url)=>{
  if(p[1]!=='atlas')return false;
  if(await ratings(req,res,p,url))return true;
  if(await community.handle(req,res,p,url))return true;
  if(p[2]!=='entries')fail(404,'课程接口不存在');
  const u=identity.current(req),method=req.method;
  if(method==='GET'){
   const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail(400,'页码不正确');
   if(p.length===3){
    const kind=url.searchParams.get('kind'),courseId=url.searchParams.get('courseId')||null;if(!['review','guide'].includes(kind))fail(400,'栏目不正确');
    const sort=url.searchParams.get('sort')||'hot';if(kind==='guide'&&!['hot','time'].includes(sort))fail(400,'排序方式不正确');
    if(kind==='review'&&!courseExists(courseId))fail(404,'课程不存在');
    const hidden=admin(u)&&url.searchParams.get('hidden')==='1';
    const ids=kind==='review'?courseIdsFor(courseId):[null],marks=ids.map(()=>'?').join(',');
    const score="coalesce((SELECT sum(value) FROM atlas_share_votes WHERE entry_id=e.id),0)+2*(SELECT count(*) FROM atlas_share_comments WHERE entry_id=e.id AND hidden=0)";
    const ordering=kind==='guide'?(sort==='hot'?'hot_score DESC,e.created DESC,e.id':'e.created DESC,e.id'):'e.updated DESC,e.id';
    const rows=db.prepare(`SELECT e.*,u.username,${kind==='guide'?score:'0'} AS hot_score FROM atlas_entries e JOIN users u ON u.id=e.user_id WHERE e.kind=? AND (e.course_id IN (${marks}) OR ?='guide') AND (?=1 OR e.hidden=0) ORDER BY ${ordering} LIMIT 31 OFFSET ?`).all(kind,...ids,kind,hidden?1:0,(page-1)*30);
    send(res,200,{entries:rows.slice(0,30).map(r=>community.decorate(r,u)),more:rows.length>30});return true;
   }
   const r=get(p[3]);readable(r,u);
   if(p.length===5&&p[4]==='history'){
    const rows=db.prepare('SELECT h.version,h.snapshot,h.created,u.username FROM atlas_history h JOIN users u ON u.id=h.actor_id WHERE entry_id=? ORDER BY version DESC LIMIT 31 OFFSET ?').all(r.id,(page-1)*30);
    send(res,200,{history:rows.slice(0,30),more:rows.length>30});return true;
   }
   if(p.length!==4)fail(404,'内容不存在');send(res,200,{entry:community.decorate(r,u)});return true;
  }
  if(!['POST','PUT'].includes(method))fail(405,'方法不允许');
  req.requireEditor=true;identity.requireEditor(req);const b=await body(req,100000),actor=identity.requireEditor(req);
  db.exec('BEGIN IMMEDIATE');let result;
  try{
   const key='atlas:'+actor.id,t=Date.now(),limit=db.prepare('SELECT * FROM auth_limits WHERE bucket=?').get(key);if(limit&&limit.until>t&&limit.n>=20)fail(429,'编辑过于频繁，请稍后重试');
   if(method==='POST'&&p.length===3){
    if(!['review','guide'].includes(b.kind))fail(400,'栏目不正确');const v=fields(b,b.kind==='guide');let courseId=b.kind==='review'?b.courseId:null;if(b.kind==='review'){if(!courseExists(courseId))fail(404,'课程不存在');Object.assign(v,validateContext(b,courseId));courseId=group(courseId).id}
    const resources=b.kind==='guide'?community.prepareResources(b,null,actor):'{"attachments":[],"links":[]}';if(b.kind==='guide'&&!v.body&&!JSON.parse(resources).attachments.length&&!JSON.parse(resources).links.length)fail(400,'请填写正文或添加附件、链接');
    const stamp=new Date().toISOString(),id=randomUUID();db.prepare('INSERT INTO atlas_entries(id,kind,course_id,teacher,term,title,body,user_id,created,updated,offering_id,resources) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,b.kind,courseId,v.teacher,v.term,v.title,v.body,actor.id,stamp,stamp,v.offering_id||'',resources);community.bindFiles(id,resources);result=get(id);
   }else{
    const r=get(p[3]);readable(r,actor);if(!Number.isSafeInteger(b.version)||b.version!==r.version)fail(409,'内容已有新版本，请刷新后重试；请保留尚未保存的文字');
    if(method==='PUT'&&p.length===4){
     if(r.hidden)fail(409,'隐藏内容不能编辑');if(r.user_id!==actor.id)fail(403,r.kind==='guide'?'只能编辑自己的分享':'只能编辑自己的评价');const v=fields(b,r.kind==='guide');if(r.kind==='review'){if(!courseExists(r.course_id))fail(404,'课程不存在');Object.assign(v,validateContext(b,r.course_id))}
     const resources=r.kind==='guide'?community.prepareResources(b,r,actor):r.resources;if(r.kind==='guide'&&!v.body&&!JSON.parse(resources).attachments.length&&!JSON.parse(resources).links.length)fail(400,'请填写正文或添加附件、链接');
     db.prepare('UPDATE atlas_entries SET title=?,body=?,teacher=?,term=?,offering_id=?,resources=?,version=version+1,updated=? WHERE id=?').run(v.title,v.body,v.teacher,v.term,v.offering_id||'',resources,new Date().toISOString(),r.id);community.bindFiles(r.id,resources);
    }else if(method==='POST'&&p.length===5&&p[4]==='moderate'){
     if(!admin(actor))fail(403,'需要管理员权限');if(typeof b.hidden!=='boolean')fail(400,'隐藏状态不正确');const reason=text(b.reason,300);
     db.prepare('UPDATE atlas_entries SET hidden=?,version=version+1,updated=? WHERE id=?').run(b.hidden?1:0,new Date().toISOString(),r.id);
     recordAction(db,{actorId:actor.id,action:b.hidden?'atlas.hide':'atlas.restore',targetType:'atlas',targetId:r.id,before:{hidden:!!r.hidden,version:r.version},after:{hidden:b.hidden,version:r.version+1},reason});
    }else fail(404,'课程接口不存在');result=get(r.id);
   }
   snapshot(result,actor);
   db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=CASE WHEN until<=? THEN 1 ELSE n+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END').run(key,t+60000,t,t);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  send(res,method==='PUT'?200:201,{entry:community.decorate(result,actor)});return true;
 };
}
