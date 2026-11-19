import fs from 'node:fs';
import path from 'node:path';
import {hash} from './local-materials.mjs';
import {prepareJob} from './isolated-compiler.mjs';
import {jobKey} from './compile-protocol.mjs';
import {recordAction} from './governance.mjs';
const stable=(kind,key)=>'local-'+kind+'-'+hash(key).slice(0,32);
function copyImmutable(src,dest){
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 if(fs.existsSync(dest)){if(hash(fs.readFileSync(dest))!==hash(fs.readFileSync(src)))throw Error('Immutable collision: '+dest)}
 else fs.copyFileSync(src,dest,fs.constants.COPYFILE_EXCL);
}
export function importLocalMaterials({db,courses,results,sourceDir,dataDir,runtime,actorId}){
 const actor=db.prepare('SELECT role,blocked FROM users WHERE id=?').get(actorId);
 if(!actor||actor.role!=='admin'||actor.blocked)throw Error('Existing unblocked administrator required');
 if(!courses.length)throw Error('Empty import');
 const resultMap=new Map(results.map(r=>[r.id,r])),seen=new Set(),assets=new Map();
 for(const c of courses){
  if(!db.prepare('SELECT 1 FROM subjects WHERE id=? AND archived=0').get(c.subject))throw Error('Unknown active subject');
  if(hash(fs.readFileSync(path.join(sourceDir,'original',c.file)))!==c.originalHash)throw Error('Original changed');
  for(const a of c.assets)assets.set(a.name,a);
  for(const p of c.pages){
   if(seen.has(p.id)||hash(p.source)!==p.hash||hash(p.raw)!==p.rawHash)throw Error('Duplicate or changed source');seen.add(p.id);
   const r=resultMap.get(p.id);
   if(!r?.ok||r.runtime!==runtime||r.sourceHash!==p.hash||jobKey(prepareJob(p.source,'',path.join(sourceDir,'rehearsal','assets')),runtime)!==r.artifact)throw Error('Matching successful compilation required: '+p.title);
   const pdf=fs.readFileSync(path.join(sourceDir,'rehearsal','compiled',r.artifact+'.pdf'));
   const meta=JSON.parse(fs.readFileSync(path.join(sourceDir,'rehearsal','compiled',r.artifact+'.json')));
   if(pdf.subarray(0,5).toString()!=='%PDF-'||meta.key!==r.artifact||meta.runtime!==runtime)throw Error('Invalid artifact');
  }
 }
 for(const a of assets.values()){
  const src=path.join(sourceDir,'rehearsal','assets',a.name);
  if(hash(fs.readFileSync(src))!==a.hash)throw Error('Asset changed');copyImmutable(src,path.join(dataDir,'assets',a.name));
 }
 for(const c of courses)for(const p of c.pages)for(const ext of ['pdf','json']){
  const name=resultMap.get(p.id).artifact+'.'+ext;copyImmutable(path.join(sourceDir,'rehearsal','compiled',name),path.join(dataDir,'compiled',name));
 }
 const report={courses:[],pages:[],archived:[],assets:assets.size},positions=new Map(),now=new Date().toISOString();
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
 try{
  for(const a of assets.values()){
   const id=a.name.split('.')[0],existing=db.prepare('SELECT * FROM assets WHERE id=?').get(id);
   if(existing&&existing.filename!==a.name)throw Error('Asset ID conflict');
   if(!existing)db.prepare('INSERT INTO assets(id,filename,mime,size,user_id,created) VALUES(?,?,?,?,?,?)').run(id,a.name,a.name.endsWith('.pdf')?'application/pdf':a.name.endsWith('.png')?'image/png':'image/jpeg',fs.statSync(path.join(dataDir,'assets',a.name)).size,actorId,now);
  }
  for(const entry of courses){
   const position=positions.get(entry.subject)||0;positions.set(entry.subject,position+1);
   const existing=db.prepare('SELECT * FROM courses WHERE title=? AND subject=? AND archived=0').all(entry.course,entry.subject);
   if(existing.length>1)throw Error('Ambiguous course');
   let c=existing[0];
   if(!c){
    const id=stable('course',entry.subject+'\0'+entry.course),home=stable('home',id);
    db.prepare('INSERT INTO courses(id,title,subject,position,home_id) VALUES(?,?,?,?,?)').run(id,entry.course,entry.subject,position,home);
    db.prepare("INSERT INTO documents(id,course_id,type,title,tex,version,position,updated,is_course_home) VALUES(?,?,'page',?,'',0,0,?,1)").run(home,id,entry.course,now);
    c=db.prepare('SELECT * FROM courses WHERE id=?').get(id);
    db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'create',JSON.stringify(c),now);
    recordAction(db,{actorId,action:'course.import',targetType:'course',targetId:c.id,after:c,reason:'用户指定本地资料课程目录'});
   }else if(c.position!==position){
    const before=c;db.prepare('UPDATE courses SET position=?,version=version+1 WHERE id=?').run(position,c.id);c=db.prepare('SELECT * FROM courses WHERE id=?').get(c.id);
    db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'reorder',JSON.stringify(c),now);
    recordAction(db,{actorId,action:'course.reorder',targetType:'course',targetId:c.id,before,after:c,reason:'按本地资料次序排列'});
   }
   report.courses.push({id:c.id,title:c.title,subject:c.subject});
   for(const p of entry.pages){
    const exists=db.prepare('SELECT * FROM documents WHERE id=?').get(p.id);
    if(exists){
     const source=db.prepare('SELECT * FROM legacy_sources WHERE document_id=?').get(p.id);
     if(exists.course_id!==c.id||!source||source.source_hash!==p.hash)throw Error('Imported ID conflict');
     report.pages.push({id:p.id,title:p.title,skipped:true});continue;
    }
    const artifact=resultMap.get(p.id).artifact;
    db.prepare("INSERT INTO documents(id,course_id,type,title,tex,position,updated,parent_id,preamble,render_mode,artifact) VALUES(?,?,'page',?,?,?,?,?,'','latex',?)").run(p.id,c.id,p.title,p.source,p.index,now,c.home_id,artifact);
    db.prepare("INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created,parent_id,preamble,render_mode,artifact,archived) VALUES(?,1,?,?,'page',?,?,?,?,?,'','latex',?,0)").run(p.id,p.title,p.source,p.index,actorId,'本地课程资料拆章导入；原文件 '+entry.file+' SHA256 '+entry.originalHash+'；来源 '+p.url+'；CC BY-SA 4.0；原文保留，仅独立编译外壳及附件路径兼容。',now,c.home_id,artifact);
    db.prepare("INSERT INTO legacy_sources(document_id,source_title,url,source_hash,license,imported_version,compile_error) VALUES(?,?,?,?,?,1,'')").run(p.id,p.title,p.url,p.hash,'CC BY-SA 4.0');
    recordAction(db,{actorId,action:'document.import',targetType:'document',targetId:p.id,after:{sourceHash:p.hash,originalHash:entry.originalHash,rawHash:p.rawHash,artifact},reason:'本地源码拆章与隔离XeLaTeX编译'});
    report.pages.push({id:p.id,title:p.title,course:c.id,artifact});
   }
  }
  for(const subject of positions.keys()){
   const names=new Set(courses.filter(c=>c.subject===subject).map(c=>c.course));
   for(const c of db.prepare('SELECT * FROM courses WHERE subject=? AND archived=0').all(subject))if(!names.has(c.title)){
    if(db.prepare('SELECT 1 FROM documents WHERE course_id=? AND protected=1').get(c.id))throw Error('Cannot archive protected course: '+c.title);
    db.prepare('UPDATE courses SET archived=1,version=version+1 WHERE id=?').run(c.id);const after=db.prepare('SELECT * FROM courses WHERE id=?').get(c.id);
    db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'archive',JSON.stringify(after),now);
    recordAction(db,{actorId,action:'course.archive',targetType:'course',targetId:c.id,before:c,after,reason:'本模块无对应课名，保留原资料和恢复历史'});report.archived.push({id:c.id,title:c.title,subject});
   }
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key failure');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 return report;
}
