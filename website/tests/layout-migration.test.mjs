import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {applyLayoutRepair} from '../layout-migration.mjs';
import {digest} from '../layout-repair.mjs';
import {start} from './helpers.mjs';
function fixture(){
 const app=createApp({dbPath:':memory:',test:true}),db=app.db;
 db.prepare("INSERT INTO users(id,username,username_key,salt,password_hash,role,created) VALUES('admin','Admin','admin','test','test','admin','now')").run();
 const home=db.prepare('SELECT * FROM documents WHERE is_course_home=1 LIMIT 1').get();
 const child={...home,id:'child',title:'child',parent_id:home.id,is_course_home:0,version:0};
 const update={before:home,after:{...home,tex:'new'},sourceHash:digest('new'),needsCompile:false};
 const plan={newCourses:[],updates:[update,{before:null,after:child,sourceHash:digest(child.tex),needsCompile:false}]};
 return {app,db,home,plan,args:{db,plan,results:[],stage:app.storageDir,dataDir:app.storageDir,runtime:'unused',actorId:'admin'}};
}
test('layout migration inserts child revisions and retains history, aborting stale edits',async()=>{
 const f=fixture();try{
  const report=applyLayoutRepair(f.args);assert.equal(report.created,1);assert.equal(f.db.prepare('SELECT parent_id FROM documents WHERE id=?').get('child').parent_id,f.home.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM revisions WHERE document_id IN (?,?)').get('child',f.home.id).n,2);
  assert.throws(()=>applyLayoutRepair(f.args),/Concurrent/);assert.equal(f.db.prepare('SELECT tex FROM documents WHERE id=?').get(f.home.id).tex,'new');
 }finally{await f.app.close();}
});
test('layout migration rolls back whole transaction for invalid parent and protects pages',async()=>{
 const f=fixture();try{
  f.plan.updates[1].after.parent_id='missing';assert.throws(()=>applyLayoutRepair(f.args),/Missing parent/);assert.equal(f.db.prepare('SELECT tex FROM documents WHERE id=?').get(f.home.id).tex,f.home.tex);
  assert.equal(f.db.prepare('SELECT count(*) n FROM revisions').get().n,0);
  f.db.prepare('UPDATE documents SET protected=1 WHERE id=?').run(f.home.id);f.plan.updates[0].before.protected=1;assert.throws(()=>applyLayoutRepair(f.args),/Protected/);
 }finally{await f.app.close();}
});
test('migration rejects concurrent children of a page being moved to another course',async()=>{
 const f=fixture();try{
  const other=f.db.prepare('SELECT * FROM documents WHERE is_course_home=1 AND id<>? LIMIT 1').get(f.home.id);
  // A newly added descendant is deliberately absent from the prepared plan.
  f.db.prepare("INSERT INTO documents(id,course_id,type,title,tex,updated,parent_id) VALUES('new-child',?,'page','New','','now',?)").run(f.home.course_id,f.home.id);
  f.plan.updates=[{...f.plan.updates[0],after:{...f.home,course_id:other.course_id,parent_id:other.id,is_course_home:0},sourceHash:digest(f.home.tex)}];
  assert.throws(()=>applyLayoutRepair(f.args),/Concurrent child/);assert.equal(f.db.prepare('SELECT course_id FROM documents WHERE id=?').get(f.home.id).course_id,f.home.course_id);
 }finally{await f.app.close();}
});
test('historical content can be restored after maintenance moves its page to another course',async()=>{
 const a=await start();try{
  const user=await a.register('LayoutReviewer'),cs=(await a.call('/state')).data.courses;
  const d=(await a.call('/courses/'+cs[0].id+'/documents',{method:'POST',user,body:{title:'Original',tex:'original content',type:'page',position:0,parent_id:cs[0].home_id,preamble:'',render_mode:'web'}})).data.document;
  assert.ok(d);const revision=a.db.prepare('SELECT id FROM revisions WHERE document_id=?').get(d.id);
  a.db.prepare('UPDATE documents SET course_id=?,parent_id=?,version=version+1 WHERE id=?').run(cs[1].id,cs[1].home_id,d.id);
  const r=await a.call('/documents/'+d.id+'/restore',{method:'POST',user,body:{version:d.version+1,revisionId:revision.id}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.document.course_id,cs[1].id);assert.equal(r.data.document.parent_id,cs[1].home_id);assert.equal(r.data.document.tex,'original content');
 }finally{await a.close();}
});
