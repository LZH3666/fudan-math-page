import fs from 'node:fs';
import path from 'node:path';
import {digest} from './layout-repair.mjs';
import {prepareJob} from './isolated-compiler.mjs';
import {jobKey} from './compile-protocol.mjs';
import {recordAction} from './governance.mjs';
export function applyLayoutRepair({db,plan,results,stage,dataDir,runtime,actorId}){
 const actor=db.prepare('SELECT role,blocked FROM users WHERE id=?').get(actorId);
 if(!actor||actor.role!=='admin'||actor.blocked)throw Error('Maintenance administrator required');
 const result=new Map(results.map(r=>[r.id,r]));
 const columns=['id','course_id','type','title','tex','version','position','protected','archived','updated','parent_id','preamble','render_mode','artifact','is_course_home'];
 const now=new Date().toISOString(),changes=plan.updates.map(u=>({...u,after:{...u.after}}));
 for(const u of changes){const d=u.after;if(digest(d.tex)!==u.sourceHash)throw Error('Source changed');
  if(u.needsCompile){const r=result.get(d.id),key=jobKey(prepareJob(d.tex,d.preamble,path.join(stage,'assets')),runtime);
   if(!r?.ok||r.sourceHash!==u.sourceHash||r.runtime!==runtime||r.artifact!==key)throw Error('Verified compilation required: '+d.title);
   for(const ext of ['pdf','json']){const name=key+'.'+ext,bytes=fs.readFileSync(path.join(stage,'compiled',name));
    if(ext==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF');
    if(ext==='json'){const m=JSON.parse(bytes);if(m.key!==key||m.runtime!==runtime)throw Error('Invalid manifest');}
    const target=path.join(dataDir,'compiled',name);if(fs.existsSync(target)){if(digest(bytes)!==digest(fs.readFileSync(target)))throw Error('Immutable artifact collision');}else fs.copyFileSync(path.join(stage,'compiled',name),target,fs.constants.COPYFILE_EXCL);
   }d.artifact=key;
  }
 }
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
 try{
  // Compare every original field; a user edit during preparation aborts the whole batch.
  for(const u of changes){const current=db.prepare('SELECT * FROM documents WHERE id=?').get(u.after.id);
   if(u.before){if(!current||Object.keys(u.before).some(k=>current[k]!==u.before[k]))throw Error('Concurrent page change: '+u.after.title);if(current.protected)throw Error('Protected page');}
   else if(current)throw Error('New page ID conflict');
  }
  for(const c of plan.newCourses){if(db.prepare('SELECT 1 FROM courses WHERE id=? OR (title=? AND archived=0)').get(c.id,c.title))throw Error('Course conflict');
   db.prepare('INSERT INTO courses(id,title,subject,position,home_id) VALUES(?,?,?,?,?)').run(c.id,c.title,c.subject,c.position,c.home_id);
   db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,actorId,'create',JSON.stringify(c),now);
   recordAction(db,{actorId,action:'course.create',targetType:'course',targetId:c.id,after:c,reason:'按用户要求将I和II课程分开'});
  }
  // Insert parent pages first, then update existing pages and their children.
  const pending=changes.filter(u=>!u.before),insert=db.prepare('INSERT INTO documents('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
  while(pending.length){let progress=false;for(let i=pending.length-1;i>=0;i--){const u=pending[i],d=u.after;if(d.parent_id&&!db.prepare('SELECT 1 FROM documents WHERE id=?').get(d.parent_id))continue;d.version=1;d.updated=now;insert.run(...columns.map(k=>d[k]??null));pending.splice(i,1);progress=true;}if(!progress)throw Error('Missing parent or cycle');}
  for(const u of changes){const d=u.after;d.version=(u.before?.version||0)+1;d.updated=now;
   if(u.before)db.prepare('UPDATE documents SET '+columns.filter(k=>k!=='id').map(k=>k+'=?').join(',')+' WHERE id=?').run(...columns.filter(k=>k!=='id').map(k=>d[k]),d.id);
   const par=d.parent_id&&db.prepare('SELECT course_id FROM documents WHERE id=?').get(d.parent_id);if(d.parent_id&&par?.course_id!==d.course_id)throw Error('Cross-course parent');
   db.prepare('INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created,parent_id,preamble,render_mode,artifact,archived) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(d.id,d.version,d.title,d.tex,d.type,d.position,actorId,'按用户反馈修正排版、章节层级及试卷年份学期；历史正文和PDF保留。',now,d.parent_id,d.preamble,d.render_mode,d.artifact,d.archived);
   if(!u.before){const parentSource=db.prepare('SELECT * FROM legacy_sources WHERE document_id=?').get(d.parent_id);if(parentSource)db.prepare('INSERT INTO legacy_sources(document_id,source_title,url,source_hash,license,imported_version,compile_error) VALUES(?,?,?,?,?,1,?)').run(d.id,d.title,parentSource.url,digest(d.tex),parentSource.license,'');}
   recordAction(db,{actorId,action:'document.layout',targetType:'document',targetId:d.id,before:u.before?{version:u.before.version,course:u.before.course_id,parent:u.before.parent_id,hash:digest(u.before.tex)}:null,after:{version:d.version,course:d.course_id,parent:d.parent_id,hash:digest(d.tex)},reason:'用户授权排版及页面层级整理'});
  }
  const all=db.prepare('SELECT id,parent_id,course_id FROM documents WHERE archived=0').all(),map=new Map(all.map(d=>[d.id,d]));
  for(const d of all){if(d.parent_id&&map.get(d.parent_id)?.course_id!==d.course_id)throw Error('Concurrent child or cross-course parent');const seen=new Set([d.id]);let p=d.parent_id;while(p){if(seen.has(p))throw Error('Page cycle');seen.add(p);p=map.get(p)?.parent_id;}}
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key failure');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return {updated:changes.filter(u=>u.before).length,created:changes.filter(u=>!u.before).length,courses:plan.newCourses.length};
}
