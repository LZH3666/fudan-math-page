import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareJob} from './isolated-compiler.mjs';
import {jobKey} from './compile-protocol.mjs';
import {legacyMarker} from './dist/legacy-format.js';
import {recordAction} from './governance.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const id=(kind,title)=>'legacy-'+kind+'-'+hash(title).slice(0,32);
export function analysisCourse(record){
 const text=record.text.replace(/\s+/g,' ').trim();
 const cases={
  '数学分析':[['楼分析','楼分析'],['(DK)','数学分析 (DK)']],
  '常微分方程':[['现代常微分方程','现代常微分方程']],
  '复分析':[['复变函数','复变函数']],
  '泛函分析':[['泛函分析续论','泛函分析续论']],
  '算子代数':[['K 理论','算子代数 K 理论'],['高指标理论','高指标理论']],
  '偏微分方程':[['现代偏微分方程','现代偏微分方程'],['二阶椭圆型方程','二阶椭圆型方程'],['非线性发展方程','非线性发展方程'],['变分法与 PDE','变分法与 PDE'],['应用偏微分方程','应用偏微分方程'],['微局部分析','微局部分析']]
 };
 const match=cases[record.group]?.find(([needle])=>text.includes(needle));
 if(match)return match[1];
 if(record.group==='偏微分方程')throw Error('Unclassified PDE course: '+record.title);
 return record.group;
}

// Explicit offline maintenance operation. This does not change account status
// or provide an HTTP path around the normal editor verification rules.
export function importAnalysis({db,records,results,sourceDir,dataDir,runtime,actorId}){
 const actor=db.prepare('SELECT id,role,blocked FROM users WHERE id=?').get(actorId);
 if(!actor||actor.role!=='admin'||actor.blocked)throw Error('Maintenance import requires an existing unblocked administrator ID');
 const byTitle=new Map(records.map(r=>[r.title,r])),compiled=new Map(results.map(r=>[r.title,r]));
 if(byTitle.size!==records.length||compiled.size!==results.length)throw Error('Duplicate source/result title');
 const roots=records.filter(r=>!r.parentTitle),names=[...new Set(roots.map(analysisCourse))];
 const planned=records.map((r,position)=>{
  if(hash(r.source)!==r.hash||hash(fs.readFileSync(path.join(sourceDir,'raw',r.hash+'.tex')))!==r.hash)throw Error('Original source mismatch: '+r.title);
  const parent=r.parentTitle?byTitle.get(r.parentTitle):null;
  if(r.parentTitle&&(!parent||parent.parentTitle))throw Error('Invalid nested source: '+r.title);
  const result=compiled.get(r.title),preamble=legacyMarker+'\n'+(r.originalPreamble||'');
  if(!result||result.sourceHash!==r.hash||result.preamble!==preamble)throw Error('Missing matching compile result: '+r.title);
  if(result.ok){
   const job=prepareJob(r.source,preamble,path.join(sourceDir,'rehearsal','assets'));
   if(jobKey(job,runtime)!==result.artifact)throw Error('Stale compile result: '+r.title);
   const pdf=fs.readFileSync(path.join(sourceDir,'rehearsal','compiled',result.artifact+'.pdf'));
   const meta=JSON.parse(fs.readFileSync(path.join(sourceDir,'rehearsal','compiled',result.artifact+'.json')));
   if(pdf.subarray(0,5).toString()!=='%PDF-'||meta.key!==result.artifact||meta.runtime!==runtime)throw Error('Invalid compilation artifact');
  }
  const url='https://bananaspace.org'+r.href;
  if(new URL(url).origin!=='https://bananaspace.org'||!r.href.startsWith('/legacy/wiki/'))throw Error('Unexpected source URL');
  return {record:r,result,preamble,position,course:analysisCourse(parent||r),documentId:id('page',r.title),url};
 });
 // Copy verified immutable artifacts before committing their database references.
 fs.mkdirSync(path.join(dataDir,'compiled'),{recursive:true});
 for(const item of planned.filter(p=>p.result.ok))for(const ext of ['pdf','json']){
  const name=item.result.artifact+'.'+ext,src=path.join(sourceDir,'rehearsal','compiled',name),dest=path.join(dataDir,'compiled',name);
  if(fs.existsSync(dest)){if(hash(fs.readFileSync(dest))!==hash(fs.readFileSync(src)))throw Error('Artifact collision: '+name)}
  else fs.copyFileSync(src,dest,fs.constants.COPYFILE_EXCL);
 }
 const created=[],reused=[],archived=[],pages=[];
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
 try{
  const courses=new Map();
  for(const [position,title] of names.entries()){
   const matches=db.prepare("SELECT * FROM courses WHERE title=? AND subject='analysis' AND archived=0").all(title);
   if(matches.length>1)throw Error('Ambiguous existing course: '+title);
   let c=matches[0];
   if(c){
    reused.push(c.id);
    if(c.position!==position){
     const before={...c};db.prepare('UPDATE courses SET position=?,version=version+1 WHERE id=?').run(position,c.id);c=db.prepare('SELECT * FROM courses WHERE id=?').get(c.id);
     db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'reorder',JSON.stringify(c),new Date().toISOString());
     recordAction(db,{actorId,action:'course.reorder',targetType:'course',targetId:c.id,before,after:c,reason:'沿用旧站课程目录次序'});
    }
   }else{
    const courseId=id('course',title),homeId=id('home',title),updated=new Date().toISOString();
    if(db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId))throw Error('Archived import course must be explicitly restored: '+title);
    db.prepare("INSERT INTO courses(id,title,subject,position,home_id) VALUES(?,?,'analysis',?,?)").run(courseId,title,position,homeId);
    db.prepare("INSERT INTO documents(id,course_id,type,title,tex,version,position,updated,is_course_home) VALUES(?,?,'page',?,'',0,0,?,1)").run(homeId,courseId,title,updated);
    c=db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);created.push(courseId);
    db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'create',JSON.stringify(c),updated);
    recordAction(db,{actorId,action:'course.import',targetType:'course',targetId:c.id,after:c,reason:'按用户:Solution目录建立独立课程'});
   }
   courses.set(title,c);
  }
  for(const p of planned){
   const existing=db.prepare('SELECT * FROM documents WHERE id=?').get(p.documentId);
   if(existing){
    const source=db.prepare('SELECT * FROM legacy_sources WHERE document_id=?').get(p.documentId);
    if(!source||source.source_title!==p.record.title||source.source_hash!==p.record.hash)throw Error('Import ID conflict');
    pages.push({id:p.documentId,title:p.record.title,course:p.course,skipped:true});continue;
   }
   const course=courses.get(p.course),parentId=p.record.parentTitle?id('page',p.record.parentTitle):course.home_id;
   const updated=new Date().toISOString(),artifact=p.result.ok?p.result.artifact:'';
   db.prepare("INSERT INTO documents(id,course_id,type,title,tex,position,updated,parent_id,preamble,render_mode,artifact) VALUES(?,?,'page',?,?,?,?,?,?,'latex',?)").run(p.documentId,course.id,p.record.text.trim(),p.record.source,p.position,updated,parentId,p.preamble,artifact);
   db.prepare("INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created,parent_id,preamble,render_mode,artifact,archived) VALUES(?,1,?,?,'page',?,?,?,?,?,?,'latex',?,0)").run(p.documentId,p.record.text.trim(),p.record.source,p.position,actorId,'维护导入：原作者及修订见 '+p.url+'；CC BY-SA 4.0；原文未改，仅格式兼容。',updated,parentId,p.preamble,artifact);
   db.prepare('INSERT INTO legacy_sources(document_id,source_title,url,source_hash,license,imported_version,compile_error) VALUES(?,?,?,?,?,1,?)').run(p.documentId,p.record.title,p.url,p.record.hash,'CC BY-SA 4.0',p.result.ok?'':p.result.error);
   recordAction(db,{actorId,action:'document.import',targetType:'document',targetId:p.documentId,after:{sourceHash:p.record.hash,artifact},reason:'按用户要求复制原源码；'+(artifact?'隔离编译通过':'保留原文，编译待处理')});
   pages.push({id:p.documentId,title:p.record.title,course:p.course,compiled:!!artifact});
  }
  for(const c of db.prepare("SELECT * FROM courses WHERE subject='analysis' AND archived=0").all())if(!names.includes(c.title)){
   db.prepare('UPDATE courses SET archived=1,version=version+1 WHERE id=?').run(c.id);
   const after=db.prepare('SELECT * FROM courses WHERE id=?').get(c.id);
   db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'archive',JSON.stringify(after),new Date().toISOString());
   recordAction(db,{actorId,action:'course.archive',targetType:'course',targetId:c.id,before:c,after,reason:'按用户要求移除本模块无对应课名的原课程；保留可恢复记录'});archived.push({id:c.id,title:c.title});
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Broken database references');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 return {courses:names,created,reused,archived,pages,pending:planned.filter(p=>!p.result.ok).map(p=>({id:p.documentId,title:p.record.title,error:p.result.error}))};
}
