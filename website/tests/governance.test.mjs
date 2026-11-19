import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {start} from './helpers.mjs';
import {migrateGovernance,recordAction,recordGovernanceAction} from '../governance.mjs';

test('operation feed keeps legacy governance and paginates around private maintenance',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('操作记录管理员'),editor=await a.register('操作记录编辑者');
 const event={actorId:admin.id,action:'course.archive',targetType:'course',targetId:'topology',reason:'按站长要求'};
 a.db.exec('ALTER TABLE admin_actions DROP COLUMN source');
 recordAction(a.db,event);
 recordAction(a.db,{...event,action:'document.rename',targetType:'document'});
 recordAction(a.db,{...event,reason:'按站长要求整理数学分析课程目录（服务器维护）'});
 migrateGovernance(a.db);
 for(let i=0;i<100;i++){
  recordAction(a.db,event);
  recordGovernanceAction(a.db,event);
 }
 recordAction(a.db,event);
 migrateGovernance(a.db);
 const visible=a.db.prepare("SELECT id FROM admin_actions WHERE source='governance' ORDER BY id DESC").all().map(x=>x.id);
 assert.equal(a.db.prepare('SELECT count(*) AS n FROM admin_actions').get().n,204);
 assert.equal(visible.length,101);
 assert.equal(visible.at(-1),1);
 assert.equal((await a.call('/admin/actions',{user:editor})).status,403);
 const first=(await a.call('/admin/actions',{user:admin})).data;
 assert.deepEqual(first.actions.map(x=>x.id),visible.slice(0,100));
 assert.equal(first.nextBefore,visible[99]);
 const second=(await a.call('/admin/actions?before='+first.nextBefore,{user:admin})).data;
 assert.deepEqual(second.actions.map(x=>x.id),[1]);
 assert.equal(second.nextBefore,null);
 assert.equal(second.actions[0].reason,event.reason);
});

test('verified administrators block/unblock with reasons, stale-write protection and permanent session/token revocation',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('治理管理员'),editor=await a.register('普通编辑者');
 assert.equal((await a.call('/admin/users')).status,401);assert.equal((await a.call('/admin/users',{user:editor})).status,403);
 const before=a.db.prepare('SELECT * FROM users WHERE id=?').get(editor.id);migrateGovernance(a.db);assert.deepEqual(a.db.prepare('SELECT * FROM users WHERE id=?').get(editor.id),before);
 const users=await a.call('/admin/users',{user:admin});assert.equal(users.status,200);assert.ok(!JSON.stringify(users.data).includes('password_hash'));assert.ok(!JSON.stringify(users.data).includes(editor.email));
 const route='/admin/users/'+editor.id+'/block',payload={blocked:true,version:0,reason:'清理垃圾内容'};
 assert.equal((await a.call(route,{method:'POST',user:editor,body:payload})).status,403);
 assert.equal((await a.call(route,{method:'POST',user:admin,csrf:'wrong',body:payload})).status,403);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:{...payload,reason:''}})).status,400);
 assert.equal((await a.call('/admin/users/'+admin.id+'/block',{method:'POST',user:admin,body:payload})).status,409);
 a.db.prepare('INSERT INTO auth_tokens VALUES(?,?,?,?,?)').run('synthetic-token',editor.id,'reset',editor.email,Date.now()+100000);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:payload})).status,200);
 assert.equal((await a.call('/state',{user:editor})).data.user,null);assert.equal(a.db.prepare('SELECT count(*) AS n FROM auth_tokens WHERE user_id=?').get(editor.id).n,0);
 assert.equal((await a.call('/auth/login',{method:'POST',body:{username:editor.username,password:'test-only-password-123'}})).status,401);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:{...payload,blocked:false}})).status,409);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:{blocked:false,version:1,reason:'处理完成'}})).status,200);
 assert.equal((await a.call('/state',{user:editor})).data.user,null);
 assert.equal((await a.call('/auth/login',{method:'POST',body:{username:editor.username,password:'test-only-password-123'}})).status,200);
 const actions=(await a.call('/admin/actions',{user:admin})).data.actions;assert.deepEqual(actions.map(x=>x.action),['user.unblock','user.block']);assert.ok(actions.every(x=>x.actor_id===admin.id&&x.reason));
});

test('comment moderation is reversible, unavailable to ordinary users and does not expose hidden text publicly',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('评论管理员'),editor=await a.register('讨论用户');
 const id=(await a.call('/courses/topology')).data.home.id;
 assert.equal((await a.call('/documents/'+id+'/comments',{method:'POST',user:editor,body:{body:'需要处理的讨论'}})).status,201);
 const c=(await a.call('/admin/comments',{user:admin})).data.comments[0],route='/admin/comments/'+c.id+'/moderate';
 assert.equal((await a.call(route,{method:'POST',user:editor,body:{hidden:true,version:1,reason:'测试'}})).status,403);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:{hidden:true,version:1,reason:'重复广告'}})).status,200);
 assert.deepEqual((await a.call('/documents/'+id+'/comments')).data.comments,[]);
 assert.equal(a.db.prepare('SELECT body FROM comments WHERE id=?').get(c.id).body,'需要处理的讨论');
 assert.equal((await a.call('/admin/comments',{user:editor})).status,403);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:{hidden:false,version:1,reason:'撤销'}})).status,409);
 assert.equal((await a.call(route,{method:'POST',user:admin,body:{hidden:false,version:2,reason:'误处理恢复'}})).status,200);
 assert.equal((await a.call('/documents/'+id+'/comments')).data.comments[0].body,c.body);
});

test('protection and rollback retain governance evidence, descendants cannot bypass protection; ordinary edits still publish immediately',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('保护管理员'),editor=await a.register('页面编辑者');
 const make=async(title,parent_id)=>(await a.call('/courses/topology/documents',{method:'POST',user:editor,body:{title,tex:'原始正文',position:0,parent_id}})).data.document;
 let parent=await make('自由父页'),child=await make('受保护子页',parent.id);
 const first=(await a.call('/documents/'+child.id+'/history')).data.revisions[0];
 child=(await a.call('/documents/'+child.id+'/protect',{method:'POST',user:admin,body:{protected:true,version:1,reason:'暂时保护'}})).data.document;
 assert.equal((await a.call('/documents/'+parent.id+'/archive',{method:'POST',user:editor,body:{version:1}})).status,403);
 assert.equal((await a.call('/documents/'+child.id,{method:'PUT',user:editor,body:{...child,tex:'不可修改'}})).status,403);
 child=(await a.call('/documents/'+child.id,{method:'PUT',user:admin,body:{...child,tex:'管理员改动'}})).data.document;
 const restored=await a.call('/documents/'+child.id+'/restore',{method:'POST',user:admin,body:{version:child.version,revisionId:first.id}});assert.equal(restored.status,200);assert.equal(restored.data.document.protected,1);assert.equal(restored.data.document.tex,'原始正文');
 const saved=await a.call('/documents/'+parent.id,{method:'PUT',user:editor,body:{...parent,tex:'直接公开的新正文'}});assert.equal(saved.status,200);assert.equal((await a.call('/documents/'+parent.id)).data.document.tex,'直接公开的新正文');
 const actions=(await a.call('/admin/actions',{user:admin})).data.actions;assert.ok(actions.some(x=>x.action==='document.protect'&&JSON.parse(x.after_json).protected));assert.ok(actions.some(x=>x.action==='document.restore'));
});

test('blocking an editor while compilation is pending prevents publication',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-governance-'));let finish,begin;const begun=new Promise(r=>begin=r);
 const compiler={assets:path.join(dir,'assets'),output:path.join(dir,'compiled'),compile:async()=>{begin();await new Promise(r=>finish=r);return {artifact:'a'.repeat(64)}}};
 for(const p of [compiler.assets,compiler.output])fs.mkdirSync(p);
 const a=await start(':memory:',{dataDir:dir,compiler});t.after(async()=>{await a.close();fs.rmSync(dir,{recursive:true,force:true})});const admin=await a.register('异步管理员'),editor=await a.register('异步编辑者');
 const home=(await a.call('/courses/topology')).data.home;
 const pending=a.call('/documents/'+home.id,{method:'PUT',user:editor,body:{...home,tex:'不会发布',render_mode:'latex'}});await begun;
 assert.equal((await a.call('/admin/users/'+editor.id+'/block',{method:'POST',user:admin,body:{blocked:true,version:0,reason:'阻止破坏'}})).status,200);finish();assert.equal((await pending).status,401);
 assert.equal((await a.call('/documents/'+home.id)).data.document.tex,home.tex);
});
