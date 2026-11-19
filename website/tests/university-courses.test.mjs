import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {prepareCatalog,findCourse,canonicalTerm} from '../dist/course-model.mjs';
import {initializeRatingSchema} from '../course-rating-schema.mjs';
import {start} from './helpers.mjs';
const offer=(id,term,teacher='甲老师')=>({id,term,code:id,teachers:[teacher]});
const base={scope:[{id:'old-a',name:'全校测试课',department:'学院甲',code:'TEST1',teachers:['甲老师'],offerings:[],categories:[],direct_review_ids:[]}],reviews:[]};
const extra={courses:[{name:'全校测试课',department:'学院甲',code:'TEST1',offerings:[offer('a1','2025-2026秋'),offer('a2','2025-2026秋'),offer('a3','2025-2026春','乙老师')]},{name:'全校测试课',department:'学院甲',code:'TEST2',offerings:[offer('a4','2024-2025春')]},{name:'全校测试课',department:'学院乙',code:'TEST3',offerings:[offer('b1','2025-2026秋')]}]};
test('course identity uses name and department across codes and terms without merging unknown departments',()=>{
 const d=prepareCatalog(base,extra),g=findCourse(d,'old-a');assert.equal(d.scope.length,2);assert.equal(g.department,'学院甲');assert.deepEqual(g.codes,['TEST1','TEST2']);assert.equal(g.offerings.length,4);assert.equal(new Set(g.offerings.map(o=>o.id)).size,4);assert.equal(canonicalTerm('2026春'),'2025-2026春');
 const unknown=prepareCatalog({scope:[{id:'u1',name:'同名课'},{id:'u2',name:'同名课'}],reviews:[]});assert.equal(unknown.scope.length,2);
 assert.notEqual(d.scope[0].id,d.scope[1].id);assert.equal(prepareCatalog(d).scope.length,2);
});
test('server loads the same full-review class IDs as the browser and invalidates them when metadata changes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'history-class-')),catalogPath=path.join(root,'catalog.json'),fullPath=path.join(root,'full-reviews.json');
 const review={id:101,group_id:10,year:2023,semester:3,teacher:'历史教师',content:'旧摘录'},data={scope:[{id:'old-history',name:'历史课程',teachers:['历史教师'],direct_review_ids:[101],offerings:[]}],reviews:[review]};fs.writeFileSync(catalogPath,JSON.stringify(data));fs.writeFileSync(fullPath,JSON.stringify({reviews:[{...review,course_id:700}]}));
 const a=await start(':memory:',{atlasCatalogPath:catalogPath});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const u=await a.register('历史班评价者');
 const write=offeringId=>a.call('/atlas/entries',{method:'POST',user:u,body:{kind:'review',courseId:'old-history',term:'2023-2024春',offeringId,title:'体验',body:'历史班原文体验'}});
 assert.equal((await write('danxi:700')).status,201);fs.writeFileSync(fullPath,JSON.stringify({reviews:[{...review,course_id:701}]}));fs.utimesSync(fullPath,new Date(),new Date(Date.now()+1000));assert.equal((await write('danxi:701')).status,201);assert.equal((await write('danxi:700')).status,400);
});
test('rating schema migration preserves IDs, hidden records and exact history with foreign keys',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('u'); CREATE TABLE atlas_ratings(id TEXT PRIMARY KEY,course_id TEXT NOT NULL,teacher TEXT NOT NULL,term TEXT NOT NULL,user_id TEXT REFERENCES users(id),grading INTEGER,difficulty INTEGER,workload INTEGER,assessment INTEGER,overall INTEGER,version INTEGER,hidden INTEGER,created TEXT,updated TEXT,UNIQUE(course_id,teacher,term,user_id)); CREATE TABLE atlas_rating_history(id INTEGER PRIMARY KEY,rating_id TEXT REFERENCES atlas_ratings(id),version INTEGER,actor_id TEXT REFERENCES users(id),snapshot TEXT,created TEXT,UNIQUE(rating_id,version)); INSERT INTO atlas_ratings VALUES('r','old-a','甲老师','2025-2026秋','u',1,2,3,4,5,2,1,'created','updated'); INSERT INTO atlas_rating_history VALUES(1,'r',2,'u','original snapshot','stamp');");
  const before=db.prepare('SELECT * FROM atlas_ratings').get(),history=db.prepare('SELECT * FROM atlas_rating_history').all();initializeRatingSchema(db);const after=db.prepare('SELECT * FROM atlas_ratings').get();assert.equal(after.offering_id,'');delete after.offering_id;assert.deepEqual(after,before);assert.deepEqual(db.prepare('SELECT * FROM atlas_rating_history').all(),history);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);initializeRatingSchema(db);
 }finally{db.close()}
});
test('every official course accepts class-specific contributions, rejects other classes, and aggregates terms and aliases',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'university-test-')),catalogPath=path.join(root,'catalog.json');fs.writeFileSync(catalogPath,JSON.stringify(base));fs.writeFileSync(path.join(root,'university-courses.json'),JSON.stringify(extra));
 const a=await start(':memory:',{atlasCatalogPath:catalogPath});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const user=await a.register('全校课评者'),g=findCourse(prepareCatalog(base,extra),'old-a'),other=prepareCatalog(base,extra).scope.find(x=>x.department==='学院乙');
 const vote={courseId:'old-a',term:'2025-2026秋',offeringId:'a1',grading:5,difficulty:4,workload:3,assessment:2,overall:5,version:0};
 const rate=b=>a.call('/atlas/ratings',{method:'POST',user,body:b});
 for(const bad of [{...vote,offeringId:''},{...vote,offeringId:'b1'},{...vote,term:'2025-2026春'},{...vote,term:'2099-2100秋'}])assert.equal((await rate(bad)).status,400);
 const first=await rate({...vote,teacher:'伪造教师'});assert.equal(first.status,200);assert.equal(first.data.rating.teacher,'甲老师');assert.equal(first.data.rating.course_id,g.id);
 assert.equal((await rate({...vote,offeringId:'a2'})).status,200);assert.equal((await rate({...vote,offeringId:'a3',term:'2025-2026春'})).status,200);
 assert.equal((await rate({...vote,version:1,overall:1})).status,200);assert.equal((await rate(vote)).status,409);
 assert.equal((await a.call('/atlas/ratings?courseId='+encodeURIComponent(g.id))).data.count,3);assert.equal((await a.call('/atlas/ratings?courseId=old-a&term=2025-2026秋')).data.count,2);assert.equal((await a.call('/atlas/ratings?courseId='+encodeURIComponent(other.id))).data.count,0);
 const write=(courseId,term,offeringId)=>a.call('/atlas/entries',{method:'POST',user,body:{kind:'review',courseId,term,offeringId,title:'评价',body:'我的实际修读体验'}});
 assert.equal((await write('old-a','2025-2026秋','b1')).status,400);assert.equal((await write('old-a','2025-2026秋','a1')).status,201);assert.equal((await write(g.id,'2025-2026春','a3')).status,201);assert.equal((await write(other.id,'2025-2026秋','b1')).status,201);
 assert.equal((await a.call('/atlas/entries?kind=review&courseId=old-a')).data.entries.length,2);assert.equal((await a.call('/atlas/entries?kind=review&courseId='+encodeURIComponent(other.id))).data.entries.length,1);
 // Existing contributions stay visible under their original IDs after grouping.
 a.db.prepare("UPDATE atlas_entries SET course_id='old-a' WHERE offering_id='a1'").run();assert.equal((await a.call('/atlas/entries?kind=review&courseId='+encodeURIComponent(g.id))).data.entries.length,2);
});
