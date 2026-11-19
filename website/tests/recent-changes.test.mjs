import test from 'node:test';
import assert from 'node:assert/strict';
import {start} from './helpers.mjs';

const undo=async(a,admin,change,reason='测试撤销')=>a.call('/admin/recent/'+change.source+'/'+change.eventId+'/undo',{method:'POST',user:admin,body:{reason}});

test('administrator recent feed unifies page, course and subject changes and undo appends history',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('最近更改管理员'),editor=await a.register('最近更改编辑者');
 assert.equal((await a.call('/admin/recent',{user:editor})).status,403);
 const home=(await a.call('/courses/topology')).data.home;
 const created=await a.call('/courses/topology/documents',{method:'POST',user:editor,body:{title:'待撤销页面',tex:'初始正文',position:0,parent_id:home.id}});assert.equal(created.status,201);
 const page=created.data.document;
 const edited=await a.call('/documents/'+page.id,{method:'PUT',user:editor,body:{title:page.title,tex:'新正文',type:page.type,position:page.position,parent_id:page.parent_id,preamble:'',render_mode:'web',version:page.version,summary:'测试修改'}});assert.equal(edited.status,200);
 const newCourse=await a.call('/courses',{method:'POST',user:editor,body:{title:'最近更改测试课',subject:'topology'}});assert.equal(newCourse.status,201);
 const c=newCourse.data.course,updatedCourse=await a.call('/courses/'+c.id,{method:'PATCH',user:editor,body:{title:'测试课程新名',subject:c.subject,version:c.version}});assert.equal(updatedCourse.status,200);
 assert.equal((await a.call('/subjects',{method:'POST',user:admin,body:{title:'最近更改测试板块',position:99}})).status,201);
 const subjectId=a.db.prepare("SELECT id FROM subjects WHERE title='最近更改测试板块'").get().id;
 assert.equal((await a.call('/subjects/'+subjectId,{method:'PATCH',user:admin,body:{title:'测试板块新名',position:100,version:1}})).status,200);

 await a.diffCache.ready();
 const feed=(await a.call('/admin/recent',{user:admin})).data.changes;
 const pageEdit=feed.find(x=>x.source==='page'&&x.targetId===page.id&&x.version===2),courseEdit=feed.find(x=>x.source==='course'&&x.targetId===c.id&&x.version===2),subjectEdit=feed.find(x=>x.source==='subject'&&x.targetId===subjectId&&x.version===2);
 assert.ok(pageEdit&&courseEdit&&subjectEdit);
 assert.equal(pageEdit.added,1);assert.equal(pageEdit.removed,2);assert.equal(pageEdit.exact,true);
 assert.ok(pageEdit.previousRevisionId);assert.equal(pageEdit.previousVersion,1);
 const creation=feed.find(x=>x.source==='page'&&x.targetId===page.id&&x.version===1);
 assert.equal(creation.added,4);assert.equal(creation.removed,0);assert.equal(creation.previousRevisionId,null);
 const large=(await a.call('/admin/recent?minChange=4&sort=size',{user:admin})).data.changes;
 assert.ok(large.some(x=>x.eventId===creation.eventId&&x.source==='page'));
 assert.ok(large.every(x=>x.source==='page'&&x.changed>=4));
 assert.ok(large.every((x,i)=>i===0||large[i-1].changed>=x.changed));
 assert.equal((await a.call('/admin/recent?minChange=-1',{user:admin})).status,400);
 assert.equal((await a.call('/admin/recent?sort=invalid',{user:admin})).status,400);
 assert.equal((await a.call('/documents/'+page.id+'/revisions/'+pageEdit.previousRevisionId,{user:admin})).data.revision.tex,'初始正文');
 assert.equal((await undo(a,admin,pageEdit)).status,200);
 assert.equal((await a.call('/documents/'+page.id)).data.document.tex,'初始正文');
 assert.equal((await undo(a,admin,courseEdit)).status,200);
 assert.equal((await a.call('/courses/'+c.id)).data.course.title,'最近更改测试课');
 assert.equal((await undo(a,admin,subjectEdit)).status,200);
 assert.equal(a.db.prepare('SELECT title FROM subjects WHERE id=?').get(subjectId).title,'最近更改测试板块');
 assert.ok((await a.call('/admin/recent',{user:admin})).data.changes.some(x=>x.source==='page'&&x.targetId===page.id&&x.action.startsWith('撤销页面变更')));
 assert.ok(a.db.prepare('SELECT count(*) AS n FROM course_history WHERE course_id=?').get(c.id).n>=3);
 assert.ok(a.db.prepare('SELECT count(*) AS n FROM subject_history WHERE subject_id=?').get(subjectId).n>=3);
 assert.equal((await undo(a,admin,pageEdit)).status,409,'stale page changes must not overwrite later work');
});

test('recent moderation undo checks the latest version and records a new moderation event',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('更改撤销管理员'),editor=await a.register('更改撤销用户'),doc=(await a.call('/courses/topology')).data.home;
 const posted=await a.call('/documents/'+doc.id+'/comments',{method:'POST',user:editor,body:{body:'用于撤销测试的评论'}});assert.equal(posted.status,201);
 const comment=(await a.call('/admin/comments',{user:admin})).data.comments[0];
 assert.equal((await a.call('/admin/comments/'+comment.id+'/moderate',{method:'POST',user:admin,body:{hidden:true,version:comment.version,reason:'测试隐藏'}})).status,200);
 const item=(await a.call('/admin/recent',{user:admin})).data.changes.find(x=>x.source==='action'&&x.adminAction==='comment.hide');assert.ok(item);
 assert.equal((await undo(a,admin,item,'误操作撤销')).status,200);
 assert.equal((await a.call('/documents/'+doc.id+'/comments')).data.comments.length,1);
 assert.equal(a.db.prepare('SELECT count(*) AS n FROM admin_actions WHERE target_type=\'comment\'').get().n,2);
});
import {listRecent} from '../recent-changes.mjs';
test('size filter and ordering apply before pagination, including older large changes',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('分页统计管理员'),home=(await a.call('/courses/topology')).data.home;
 const insert=a.db.prepare('INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created) VALUES(?,?,?,?,?,?,?,?,?)');
 for(let i=1;i<=105;i++)insert.run(home.id,1000+i,'测试',i===1?'甲'.repeat(2000):(i%2?'乙':'丙').repeat(10),'lecture',0,admin.id,'分页测试',new Date(1700000000000+i*1000).toISOString());
 await a.diffCache.ready();
 const filtered=listRecent(a.db,0,{minChange:1000});assert.ok(filtered.changes.some(c=>c.version===1001));assert.ok(filtered.changes.every(c=>c.changed>=1000));
 const first=listRecent(a.db,0,{sort:'size'}),second=listRecent(a.db,first.nextBefore,{sort:'size'});
 assert.equal(first.changes.length,100);assert.ok(first.changes[0].changed>=2000);assert.ok(second.changes.length>0);
 const keys=new Set(first.changes.map(c=>c.source+':'+c.eventId));assert.ok(second.changes.every(c=>!keys.has(c.source+':'+c.eventId)));
});

test('daily page edits omit empty saves and identify directory moves across editors and Beijing midnight',async t=>{
 const a=await start();t.after(()=>a.close());
 const admin=await a.register('历史管理员'),editor=await a.register('历史编辑者');
 const create=async title=>(await a.call('/courses/topology/documents',{method:'POST',user:admin,body:{title,tex:'正文',type:'lecture',position:2}})).data.document;
 const parent=await create('试卷'),page=await create('待移动页'),route='/documents/'+page.id;
 const save=(user,fields)=>a.call(route,{method:'PUT',user,body:{...page,...fields}});
 const empty=await save(admin,{type:undefined,summary:'空保存'});
 assert.equal(empty.data.document.version,page.version);
 assert.equal(empty.data.document.updated,page.updated);
 const moved=await save(editor,{parent_id:parent.id,position:5,summary:'保护页面'});
 assert.equal(moved.data.document.version,page.version+1);
 assert.equal((await save(admin,{})).status,409);
 const edit=await save(admin,{...moved.data.document,tex:'新正文'});
 assert.equal(edit.status,200);
 const stamp=a.db.prepare('UPDATE revisions SET created=? WHERE document_id=? AND version=?');
 ['2026-11-18T15:59:59Z','2026-11-18T16:00:00Z','2026-11-19T01:00:00Z'].forEach((dt,i)=>stamp.run(dt,page.id,i+1));
 // Simulate an old client/server that recorded an identical snapshot.
 a.db.prepare(`INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created,parent_id,preamble,render_mode,artifact,archived)
 SELECT document_id,version+1,title,tex,type,position,user_id,'取消保护',created,parent_id,preamble,render_mode,artifact,archived FROM revisions WHERE document_id=? AND version=3`).run(page.id);
 const history=(await a.call(route+'/history?daily=1')).data.groups;
 assert.deepEqual(history.map(g=>[g.day,g.entries.map(r=>r.version)]),[['2026-11-19',[3,2]],['2026-11-18',[1]]]);
 assert.match(history[0].entries[1].movement,/上级页面从「.+」移至「试卷」，目录顺序从 2 改为 5/);
 assert.deepEqual(history[0].entries.map(r=>r.username),[admin.username,editor.username]);
 assert.equal((await a.call(route+'/history')).data.revisions.length,4);
 const feed=(await a.call('/admin/recent?daily=1',{user:admin})).data.groups;
 const groups=feed.filter(g=>g.entries[0].targetId===page.id);
 assert.deepEqual(groups.map(g=>g.entries.map(r=>r.version)),[[3,2],[1]]);
 assert.equal(groups[0].entries[1].movement,history[0].entries[1].movement);
});

test('unchanged LaTeX save repairs missing output without appending a revision',async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'page-history-output-'));
 const artifact='a'.repeat(64),pdf=path.join(output,artifact+'.pdf');
 let compiled=0;
 const compiler={output,async compile(){compiled++;await fs.writeFile(pdf,'%PDF-1.7');return {artifact}}};
 const a=await start(':memory:',{compiler});
 t.after(async()=>{await a.close();await fs.rm(output,{recursive:true,force:true})});
 const user=await a.register('修复排版测试');
 const page=(await a.call('/courses/topology/documents',{method:'POST',user,body:{title:'排版页',tex:'正文',position:0,render_mode:'latex'}})).data.document;
 const save=()=>a.call('/documents/'+page.id,{method:'PUT',user,body:page});
 assert.equal((await save()).data.document.version,page.version);
 assert.equal(compiled,1);
 await fs.unlink(pdf);
 assert.equal((await save()).data.document.version,page.version);
 assert.equal(compiled,2);
 assert.equal(await fs.readFile(pdf,'utf8'),'%PDF-1.7');
});

test('zero-character revisions count only for parent or order moves, before daily grouping',async t=>{
 const a=await start();t.after(()=>a.close());
 const user=await a.register('零字数测试');
 const create=async title=>(await a.call('/courses/topology/documents',{method:'POST',user,body:{title,position:0,tex:''}})).data.document;
 const parent=await create('新上级');
 let page=await create('空试卷');
 const path='/documents/'+page.id;
 const update=async fields=>{
  const r=await a.call(path,{method:'PUT',user,body:{...page,...fields}});
  assert.equal(r.status,200);page=r.data.document;
 };
 await update({title:'改名'});                // v2: title only
 await update({parent_id:parent.id});         // v3: move an empty page
 await update({position:2});                  // v4: reorder
 await update({tex:'题目'});                  // v5: add text
 await update({preamble:'% 说明'});           // v6: preamble only
 await update({tex:''});                      // v7: remove text
 await a.diffCache.ready();
 const history=(await a.call(path+'/history?daily=1')).data.groups;
 const feed=(await a.call('/admin/recent?daily=1',{user})).data.groups.filter(g=>g.entries[0].targetId===page.id);
 for(const groups of [history,feed])assert.deepEqual(groups.flatMap(g=>g.entries.map(r=>r.version)),[7,5,4,3]);
 assert.equal((await a.call(path+'/history')).data.revisions.length,7);
});
