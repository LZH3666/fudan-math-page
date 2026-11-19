import {catalogFetch} from './catalog-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {start} from './helpers.mjs';
import {createBackup,restoreBackup} from '../backup.mjs';
import {resourceMatches,createAtlasUI} from '../dist/course-atlas.js';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {academicTerms,ratingDimensions,teacherRatingGroups} from '../dist/course-rating.mjs';
import {importedReviews,legacyTerm,scoreSection,overallRatingLine,teacherRatingTable} from '../dist/course-feedback.js';
const fixture={scope:[{id:'C0055',teachers:['某教师'],teacher_evidence:[]}]};
async function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-test-'));const file=path.join(root,'catalog.json');fs.writeFileSync(file,JSON.stringify(fixture));const a=await start(':memory:',{atlasCatalogPath:file});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});return a}
const payload={kind:'review',courseId:'C0055',teacher:'某教师',term:'2025-2026春',title:'修读体验',body:'**收获**：证明与练习。'};
const write=(a,user,b=payload,route='',method='POST')=>a.call('/atlas/entries'+route,{method,user,body:b});
test('atlas uses verified accounts, CSRF, author ownership, optimistic concurrency and moderation with public history',async t=>{
 const a=await setup(t),admin=await a.register('课评管理员'),author=await a.register('评价作者'),other=await a.register('评价读者');
 assert.equal((await write(a,null)).status,401);
 assert.equal((await a.call('/atlas/entries',{method:'POST',user:author,csrf:'wrong',body:payload})).status,403);
 a.db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(other.id);assert.equal((await write(a,other)).status,403);a.db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(new Date().toISOString(),other.id);
 assert.equal((await write(a,author,{...payload,courseId:'unknown'})).status,404);
 let out=await write(a,author);assert.equal(out.status,201);let r=out.data.entry;
 assert.equal((await a.call('/atlas/entries?kind=review&courseId=C0055')).data.entries[0].id,r.id);
 assert.equal((await write(a,other,{...payload,version:1},'/'+r.id,'PUT')).status,403);
 out=await write(a,author,{...payload,body:'修订后的正文',version:1},'/'+r.id,'PUT');assert.equal(out.status,200);r=out.data.entry;
 assert.equal((await write(a,author,{...payload,version:1},'/'+r.id,'PUT')).status,409);
 assert.equal((await a.call('/atlas/entries/'+r.id+'/history')).data.history.length,2);
 assert.equal((await write(a,other,{hidden:true,reason:'测试',version:2},'/'+r.id+'/moderate')).status,403);
 assert.equal((await write(a,admin,{hidden:true,reason:'',version:2},'/'+r.id+'/moderate')).status,400);
 assert.equal((await write(a,admin,{hidden:true,reason:'测试隐藏',version:2},'/'+r.id+'/moderate')).status,201);
 assert.equal((await a.call('/atlas/entries/'+r.id)).status,404);assert.equal((await a.call('/atlas/entries/'+r.id+'/history')).status,404);
 assert.equal((await a.call('/atlas/entries?kind=review&courseId=C0055&hidden=1',{user:author})).data.entries.length,0);
 assert.equal((await a.call('/atlas/entries?kind=review&courseId=C0055&hidden=1',{user:admin})).data.entries.length,1);
 assert.equal((await write(a,admin,{hidden:false,reason:'测试恢复',version:3},'/'+r.id+'/moderate')).status,201);
 assert.equal((await a.call('/atlas/entries/'+r.id)).data.entry.body,'修订后的正文');
 assert.equal(a.db.prepare("SELECT count(*) n FROM admin_actions WHERE target_type='atlas'").get().n,2);
 a.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(author.id);assert.equal((await write(a,author)).status,401);
});
test('experience shares are author editable, pages are bounded, and only successful writes consume rate limit',async t=>{
 const a=await setup(t),u=await a.register('指南作者'),v=await a.register('指南编辑');
 const r=(await write(a,u,{kind:'guide',title:'概率方向',body:'先修建议'})).data.entry;
 assert.equal((await write(a,v,{title:'概率方向',body:'补充建议',version:1},'/'+r.id,'PUT')).status,403);
 assert.equal((await write(a,u,{title:'概率方向',body:'补充建议',version:1},'/'+r.id,'PUT')).status,200);
 assert.equal((await write(a,v,{kind:'guide',body:'自己的分享'})).status,201);
 assert.ok((await a.call('/atlas/entries?kind=guide')).data.entries.some(e=>e.body==='补充建议'));
 assert.equal((await a.call('/atlas/entries?kind=guide&page=-1')).status,400);
 assert.equal((await a.call('/atlas/entries?kind=wrong')).status,400);
 assert.equal((await write(a,v,{kind:'guide',title:'',body:''})).status,400);
 assert.equal(a.db.prepare('SELECT n FROM auth_limits WHERE bucket=?').get('atlas:'+v.id).n,1);
 for(let i=0;i<19;i++)assert.equal((await write(a,v)).status,201);
 assert.equal((await write(a,v)).status,429);
 assert.equal((await a.call('/atlas/entries?kind=review&courseId=C0055')).data.entries.length,19);
});
test('atlas contributions and edit history survive existing consistent backup and restore',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-backup-')),dataDir=path.join(root,'live');fs.mkdirSync(dataDir);const dbPath=path.join(dataDir,'library.sqlite'),catalogPath=path.join(root,'catalog.json');fs.writeFileSync(catalogPath,JSON.stringify(fixture));
 const a=await start(dbPath,{dataDir,atlasCatalogPath:catalogPath});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const u=await a.register('备份作者');await write(a,u);await a.call('/atlas/ratings',{method:'POST',user:u,body:vote});
 const saved=await createBackup({dbPath,dataDir,backupRoot:path.join(root,'backups')}),dest=path.join(root,'restored');restoreBackup(saved.directory,dest);
 const db=new DatabaseSync(path.join(dest,'library.sqlite'));try{for(const table of ['atlas_entries','atlas_history','atlas_ratings','atlas_rating_history'])assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),a.db.prepare('SELECT * FROM '+table).all())}finally{db.close()}
});
test('resource links preserve course variants and UI escapes imported text while keeping native layout',async()=>{
 const cs=[{id:'normal',title:'泛函分析'},{id:'h',title:'泛函分析 (H)'},{id:'ii',title:'泛函分析 II'}];assert.deepEqual(resourceMatches({name:'泛函分析'},cs).map(c=>c.id),['normal']);assert.deepEqual(resourceMatches({name:'泛函分析（H）'},cs).map(c=>c.id),['h']);
 const dom=new JSDOM('<div id="root"></div>');const prev={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
 const d={scope:[{id:'C0055',name:'数理统计<script>alert(1)</script>',code:'MATH30011',categories:['数学专业'],teachers:['测试教师'],terms:['2026春'],offerings:[{term:'2025-2026春',code:'MATH30011.01',credits:3,teachers:['测试教师'],class_type:'普通班'},{term:'2023-2024春',code:'MATH30011.02',credits:3,teachers:['测试教师'],class_type:'普通班'},{term:'2024-2025秋',code:'MATH30011.03',credits:3,teachers:['测试教师'],class_type:'普通班'}],note_keys:[],teacher_evidence:[]}],syllabi:[],notes:[],reviews:[]};globalThis.fetch=catalogFetch(d);
 try{const ui=createAtlasUI({api:async()=>({entries:[],more:false}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});document.querySelector('#root').innerHTML=await ui.view(['reviews','C0055']);assert.equal(document.querySelectorAll('script').length,0);assert.match(document.body.textContent,/数理统计<script>/);assert.match(document.body.textContent,/2025-2026 春/);assert.match(document.body.textContent,/开课信息/);assert.equal(document.querySelectorAll('#atlas-offerings .atlas-table table').length,1);assert.deepEqual([...document.querySelectorAll('#atlas-offerings tbody tr td:first-child')].map(td=>td.textContent),['2025-2026 春','2024-2025 秋','2023-2024 春'],'开课信息按学期由新到旧排列');assert.equal(document.querySelectorAll('.sidebar,.hero').length,0);const h=await ui.view(['guides','references']);assert.match(h,/2024版/);assert.match(h,/2026级/)}finally{globalThis.document=prev.document;globalThis.fetch=prev.fetch;dom.window.close()}
});
test('late page responses cannot replace active editing context and a draft retains its original course',async()=>{
 const dom=new JSDOM('<div id="root"></div><div id="editor"></div>'),prev={document:globalThis.document,fetch:globalThis.fetch,location:globalThis.location};globalThis.document=dom.window.document;globalThis.location={hash:'#/reviews/C0055'};
 const course=id=>({id,name:id,code:id,categories:[],teachers:[],terms:[],offerings:[],note_keys:[],teacher_evidence:[]}),d={scope:[course('C0055'),course('C0002')],syllabi:[],notes:[],reviews:[]};globalThis.fetch=catalogFetch(d);
 let release,submit,saved,delay=true;const pending=new Promise(r=>release=r),guide={id:'guide',kind:'guide',title:'当前指南',body:'正文',teacher:'',term:'',user_id:'u',version:1};
 const ui=createAtlasUI({user:()=>({id:'u',canEdit:true}),courses:()=>[],modal:(title,html,fn)=>{document.querySelector('#editor').innerHTML=html;submit=fn},closeModal(){},refresh(){},markDirty(){},api:async(p,m,b)=>{if(m==='POST'){saved=b;return {entry:{...b,course_id:b.courseId}}}if(p==='/atlas/entries/guide')return {entry:guide};if(delay&&p.includes('C0055'))return pending;return {entries:[],more:false}}});
 const click=(action,id='')=>ui.action({target:{closest:()=>({dataset:{atlas:action,id}})}});
 try{const old=ui.view(['reviews','C0055']);await new Promise(r=>setImmediate(r));const active=await ui.view(['guides','guide']);document.querySelector('#root').innerHTML=active;release({entries:[],more:false});await old;ui.bind();await click('edit','guide');assert.equal(document.querySelector('#guide-share-form textarea').value,'正文');assert.equal(document.querySelector('#guide-share-form').shareTarget.title,'当前指南');
  delay=false;await ui.view(['reviews','C0055']);await click('new-review');await ui.view(['reviews','C0002']);await submit(new Map([['title','体验'],['body','正文']]));assert.equal(saved.courseId,'C0055');
 }finally{globalThis.document=prev.document;globalThis.fetch=prev.fetch;globalThis.location=prev.location;dom.window.close()}
});
const vote={courseId:'C0055',teacher:'某教师',term:'2025-2026春',grading:5,difficulty:4,workload:3,assessment:2,overall:5,version:0};
test('one author across two terms contributes two rating records with an accurate record label',async t=>{
 const a=await setup(t),u=await a.register('跨学期评分者');
 for(const term of ['2025-2026秋','2025-2026春'])assert.equal((await a.call('/atlas/ratings',{method:'POST',user:u,body:{...vote,term}})).status,200);
 const out=(await a.call('/atlas/ratings?courseId=C0055')).data;
 assert.equal(out.count,2);assert.deepEqual(out.dimensions[0].counts,[0,0,0,0,2]);
 const html=scoreSection(fixture.scope[0],out,false,false);assert.match(html,/2 份评分/);assert.match(html,/各档评分数/);assert.doesNotMatch(html,/人评分|各档人数/);
 assert.equal((await a.call('/atlas/ratings?courseId=C0055&term=2025-2026春')).data.count,1);
});
test('ratings require verified identity, all five levels, known teacher and bounded academic term; updates do not double count',async t=>{
 const a=await setup(t),u=await a.register('评分作者'),v=await a.register('另一评分者');const post=(user,b)=>a.call('/atlas/ratings',{method:'POST',user,body:b});
 assert.equal((await post(null,vote)).status,401);assert.equal((await a.call('/atlas/ratings',{method:'POST',user:u,csrf:'bad',body:vote})).status,403);
 for(const bad of [{...vote,grading:6},{...vote,workload:null},{...vote,term:'2021-2022秋'},{...vote,term:'2099-2100秋'}])assert.equal((await post(u,bad)).status,400);
 const r=await post(u,vote);assert.equal(r.status,200);assert.equal(r.data.rating.version,1);
 assert.equal((await post(u,vote)).status,409);
 assert.equal((await post(u,{...vote,grading:1,version:1})).status,200);
 assert.equal((await post(v,{...vote,grading:2})).status,200);
 const summary=(await a.call('/atlas/ratings?courseId=C0055')).data;assert.equal(summary.count,2);assert.deepEqual(summary.dimensions[0].counts,[1,1,0,0,0]);assert.equal(summary.mine.length,0);assert.equal(summary.records,undefined);
 const own=(await a.call('/atlas/ratings?courseId=C0055',{user:u})).data.mine;assert.equal(own.length,1);assert.equal(own[0].grading,1);assert.equal(own[0].version,2);
 assert.equal(a.db.prepare('SELECT count(*) n FROM atlas_rating_history').get().n,3);
 a.db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(v.id);assert.equal((await post(v,{...vote,version:1})).status,403);
 a.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(u.id);assert.equal((await post(u,{...vote,version:2})).status,401);
});
test('rating moderation excludes hidden votes, records reasons and checks versions',async t=>{
 const a=await setup(t),admin=await a.register('评分管理员'),u=await a.register('普通评分者');const rating=(await a.call('/atlas/ratings',{method:'POST',user:u,body:vote})).data.rating;
 const mod=(user,b)=>a.call('/atlas/ratings/'+rating.id+'/moderate',{method:'POST',user,body:b});
 assert.equal((await mod(u,{version:1,hidden:true,reason:'测试'})).status,403);
 assert.equal((await mod(admin,{version:1,hidden:true,reason:''})).status,400);
 assert.equal((await mod(admin,{version:1,hidden:true,reason:'验收'})).status,200);
 assert.equal((await a.call('/atlas/ratings?courseId=C0055')).data.count,0);
 assert.equal((await mod(admin,{version:1,hidden:false,reason:'恢复'})).status,409);
 assert.equal((await mod(admin,{version:2,hidden:false,reason:'恢复'})).status,200);
 assert.equal((await a.call('/atlas/ratings?courseId=C0055&teacher=某教师&term=2025-2026春')).data.count,1);
 assert.equal(a.db.prepare("SELECT count(*) n FROM admin_actions WHERE target_type='atlas-rating'").get().n,2);
});
test('academic term choices stop at the current Beijing term and imported reviews retain original text without AI commentary',()=>{
 assert.equal(academicTerms(new Date('2026-10-24T00:00:00Z'))[0],'2026-2027秋');assert.equal(academicTerms(new Date('2027-01-10T00:00:00Z'))[0],'2026-2027秋');assert.equal(academicTerms(new Date('2027-03-10T00:00:00Z'))[0],'2026-2027春');assert.equal(academicTerms().at(-1),'2022-2023秋');
 assert.equal(ratingDimensions.length,5);assert.ok(ratingDimensions.every(d=>d.levels.length===5));assert.equal(legacyTerm({year:2023,semester:3}),'2023-2024 春');
 const review={id:1,teacher:'老师',year:2023,semester:3,title:'原评标题',content:'原文 <script> $x$\n第二行',fully_read:true},g={direct_review_ids:[1],teacher_evidence:[{direct_review_ids:[1]}]};const html=importedReviews(g,{reviews:[review],notes:[{verdict:'不应显示的AI意见'}]});
 const dom=new JSDOM(html);try{assert.equal(dom.window.document.querySelectorAll('article').length,1);assert.equal(dom.window.document.querySelector('p').textContent,review.content);assert.equal(dom.window.document.querySelectorAll('script').length,0);assert.doesNotMatch(html,/原库|上游标记|综合整理|AI意见|fully_read/)}finally{dom.window.close()}
});
test('course-wide overall average spans terms, ignores display filters, updates existing votes and excludes hidden scores',async t=>{
 const a=await setup(t),admin=await a.register('均分管理员'),u=await a.register('均分同学甲'),v=await a.register('均分同学乙');
 const get=async suffix=>(await a.call('/atlas/ratings?courseId=C0055'+(suffix||''))).data;
 assert.deepEqual((await get()).overall,{count:0,average:null});
 const post=(user,values)=>a.call('/atlas/ratings',{method:'POST',user,body:{...vote,...values}});
 assert.equal((await post(u,{term:'2025-2026秋',overall:5})).status,200);
 assert.equal((await post(u,{term:'2025-2026春',overall:1})).status,200);
 const other=await post(v,{term:'2025-2026秋',overall:4});assert.equal(other.status,200);
 let out=await get();assert.equal(out.overall.count,3);assert.equal(out.overall.average,10/3);
 out=await get('&term=2025-2026春');assert.equal(out.count,1);assert.equal(out.overall.count,3);assert.equal(out.overall.average,10/3);
 assert.match(overallRatingLine(out.overall),/3\.33 \/ 5.*3 份评分/);
 assert.equal((await post(u,{term:'2025-2026秋',overall:2,version:1})).status,200);out=await get();assert.equal(out.overall.count,3);assert.equal(out.overall.average,7/3);
 assert.equal((await post(u,{term:'2025-2026秋',overall:5,version:1})).status,409);assert.equal((await get()).overall.average,7/3);
 const id=other.data.rating.id;assert.equal((await a.call('/atlas/ratings/'+id+'/moderate',{method:'POST',user:admin,body:{version:1,hidden:true,reason:'均分测试'}})).status,200);
 out=await get();assert.deepEqual(out.overall,{count:2,average:1.5});
 assert.equal((await a.call('/atlas/ratings/'+id+'/moderate',{method:'POST',user:admin,body:{version:2,hidden:false,reason:'恢复'}})).status,200);assert.equal((await get()).overall.average,7/3);
 assert.match(overallRatingLine({count:0,average:null}),/暂无评分/);assert.doesNotMatch(overallRatingLine({count:0,average:null}),/0\.00|NaN/);
});
test('overall average is shown under the course heading before offerings, without a decorative card',async()=>{
 const dom=new JSDOM('<main id="root"></main>'),before={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
 const d={scope:[{id:'C0055',name:'测试课程',code:'TEST',teachers:[],categories:[],offerings:[]}],syllabi:[],reviews:[]};globalThis.fetch=catalogFetch(d);
 try{const ui=createAtlasUI({api:async route=>route.includes('/ratings')?{mine:[],teacherGroups:[{teacher:'甲老师',overall:{average:4.5,count:2}}]}:{entries:[]},user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});document.querySelector('#root').innerHTML=await ui.view(['reviews','C0055']);const line=document.querySelector('.teacher-rating-table');assert.equal(line.querySelectorAll('tbody tr').length,1);assert.match(line.textContent,/甲老师4\.50 \/ 52/);assert.ok(line.compareDocumentPosition(document.querySelector('#atlas-offerings'))&dom.window.Node.DOCUMENT_POSITION_FOLLOWING)}finally{Object.assign(globalThis,before);dom.window.close()}
});
test('course mean weights verified source votes and local votes individually, excluding unrelated and absent source scores',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'overall-source-')),catalogPath=path.join(root,'catalog.json');fs.writeFileSync(catalogPath,JSON.stringify({scope:[{...fixture.scope[0],source_group_ids:[8]}],reviews:[]}));
 fs.writeFileSync(path.join(root,'full-reviews.json'),JSON.stringify({reviews:[{id:901,group_id:8,overall_score:5},{id:902,group_id:8,overall_score:1},{id:903,group_id:9,overall_score:5},{id:904,group_id:8,overall_score:0},{id:905,group_id:8,content:'只有文字，不推断分数'}]}));
 const a=await start(':memory:',{atlasCatalogPath:catalogPath});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});let out=(await a.call('/atlas/ratings?courseId=C0055')).data;assert.deepEqual(out.overall,{count:2,average:3});
 const user=await a.register('本地总体评分者');assert.equal((await a.call('/atlas/ratings',{method:'POST',user,body:{...vote,overall:4}})).status,200);out=(await a.call('/atlas/ratings?courseId=C0055&term=2025-2026秋')).data;assert.equal(out.count,0);assert.equal(out.overall.count,3);assert.equal(out.overall.average,10/3);
});

test('teacher summaries merge parallel classes and manual historical names while separating other and unknown teachers',async t=>{
 const a=await setup(t),u=await a.register('教师分组验收');
 for(const value of [{term:'2023-2024秋',teacher:'某教师',overall:1},{term:'2025-2026春',teacher:'某教师',overall:5},{term:'2024-2025秋',teacher:'另一教师',overall:2},{term:'2024-2025春',teacher:'',overall:3}])assert.equal((await a.call('/atlas/ratings',{method:'POST',user:u,body:{...vote,...value}})).status,200);
 const out=(await a.call('/atlas/ratings?courseId=C0055')).data;
 assert.equal(out.teacherGroups.length,3);assert.deepEqual(out.teacherGroups.find(g=>g.teacher==='某教师').overall,{count:2,average:3});assert.deepEqual(out.teacherGroups.find(g=>g.teacher==='另一教师').overall,{count:1,average:2});assert.equal(out.teacherGroups.find(g=>g.teacher==='').overall.average,3);
 const filtered=(await a.call('/atlas/ratings?courseId=C0055&teacher='+encodeURIComponent('某教师')+'&term=2023-2024秋')).data;assert.equal(filtered.groups.length,1);assert.equal(filtered.groups[0].count,1);assert.equal(filtered.teacherGroups.find(g=>g.teacher==='某教师').overall.average,3);
});

test('parallel offerings weight each vote once and source scores stay in the matching teacher group',()=>{
 const make=(teacher,overall,offering_id,term)=>({teacher,overall,offering_id,term,grading:overall,difficulty:3,workload:3,assessment:3});
 const groups=teacherRatingGroups([make('教师甲',5,'a','2025-2026秋'),make('教师甲',1,'b','2025-2026秋'),make(' 教师甲 ',3,'','2023-2024秋'),make('教师乙',2,'c','2025-2026春')],[{teacher:'教师甲',overall_score:3},{teacher:'教师乙',overall_score:4},{teacher:'',overall_score:5}]);
 assert.deepEqual(groups.find(g=>g.teacher==='教师甲').overall,{count:4,average:3});assert.equal(groups.find(g=>g.teacher==='教师甲').count,3);assert.deepEqual(groups.find(g=>g.teacher==='教师甲').dimensions[0].counts,[1,0,1,0,1]);assert.deepEqual(groups.find(g=>g.teacher==='教师乙').overall,{count:2,average:3});assert.deepEqual(groups.find(g=>g.teacher==='').overall,{count:1,average:5});
 const html=overallRatingLine(groups);assert.match(html,/教师甲/);assert.match(html,/教师乙/);assert.match(html,/教师未注明/);assert.equal((html.match(/<tr><th scope="row">/g)||[]).length,3);
});

test('compact teacher table includes unrated and joint teachers without attributing joint scores to individuals',()=>{
 const g={teachers:['甲','乙','丙','丁'],offerings:[{teachers:['甲','乙']},{teachers:['丙']}],teacher_evidence:[]};
 const html=teacherRatingTable(g,[{teacher:'乙,甲',overall:{count:2,average:4}},{teacher:'甲、乙',overall:{count:1,average:1}},{teacher:'历史教师',overall:{count:1,average:5}}]);
 const dom=new JSDOM(html),rows=[...dom.window.document.querySelectorAll('tbody tr')].map(r=>r.textContent);assert.equal(rows.length,4);assert.ok(rows.some(r=>r.includes('甲、乙')&&r.includes('3.00 / 5')&&r.endsWith('3')));assert.ok(rows.includes('丙暂无0'));assert.ok(rows.includes('丁暂无0'));assert.ok(rows.includes('历史教师5.00 / 51'));assert.ok(!rows.some(r=>/^甲(?:暂无|\d)/.test(r)));assert.doesNotMatch(teacherRatingTable({teachers:['<script>']},[]),/<script>/);dom.window.close();
});

test('joint-only teacher evidence does not generate standalone rows, while solo offerings and personal scores remain',()=>{
 const g={teachers:['董映笃','楼红卫','杜恺','刘裕德'],teacher_evidence:['董映笃','楼红卫','杜恺','刘裕德'].map(teacher=>({teacher})),offerings:[{teachers:['楼红卫','董映笃']},{teachers:['杜恺','刘裕德']}]};
 const rows=html=>{const dom=new JSDOM(html),names=[...dom.window.document.querySelectorAll('tbody th')].map(r=>r.textContent);dom.window.close();return names};
 assert.deepEqual(rows(teacherRatingTable(g)),['董映笃、楼红卫','杜恺、刘裕德']);
 assert.ok(rows(teacherRatingTable({...g,offerings:[...g.offerings,{teachers:['楼红卫']}]})).includes('楼红卫'));
 assert.ok(rows(teacherRatingTable(g,[{teacher:'杜恺',overall:{count:1,average:4}}])).includes('杜恺'));
});

test('all review renderers place metadata above a bold-ready title followed by unchanged content',async()=>{
 const imported=importedReviews({source_group_ids:[1]}, {reviews:[]},[{id:1,group_id:1,teacher:'甲',year:2023,semester:3,title:'标题<script>',content:'正文\n第二行'}]);
 const dom=new JSDOM('<main id="root"></main>'+imported),before={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
 const check=article=>{assert.equal(article.children[0].tagName,'SMALL');assert.equal(article.children[1].tagName,'H3');assert.ok(article.children[1].classList.contains('atlas-review-title'));assert.match(article.children[0].textContent,/2023-2024 春/);assert.equal(article.children[1].textContent,'标题<script>');assert.equal(article.querySelectorAll('script').length,0)};
 check(document.querySelector('article'));assert.equal(document.querySelector('.atlas-source-text').textContent,'正文\n第二行');
 const data={scope:[{id:'C0055',name:'测试课',categories:[],teachers:[],offerings:[]}],reviews:[]};globalThis.fetch=catalogFetch(data);
 try{const ui=createAtlasUI({api:async route=>route.includes('/ratings')?{}:{entries:[{id:'local',kind:'review',teacher:'甲',term:'2023-2024春',title:'标题<script>',body:'正文',username:'同学'}]},user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});document.querySelector('#root').innerHTML=await ui.view(['reviews','C0055']);check(document.querySelector('#share-local'));assert.equal(document.querySelector('#share-local .forum-markdown').textContent.trim(),'正文')}finally{Object.assign(globalThis,before);dom.window.close()}
});
