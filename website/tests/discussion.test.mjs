import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import katex from 'katex';
import {start} from './helpers.mjs';
import {loadConfig} from '../config.mjs';
import {createBackup,restoreBackup} from '../backup.mjs';
import {discussionMarkdown} from '../dist/discussion-markdown.js';
import {createDiscussionUI} from '../dist/discussion.js';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
const payload={title:'积分讨论',body:'**思路**：$x^2$\n\n1. 代入\n2. 积分'};
const write=(a,route,user,body,method='POST')=>a.call('/discussion'+route,{method,user,body});
test('discussion publication, ownership, conflicts, hidden topics/replies, private history and moderation audit',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('讨论管理员'),author=await a.register('讨论作者'),other=await a.register('其他用户');
 assert.equal((await write(a,'',null,payload)).status,401);
 assert.equal((await a.call('/discussion',{method:'POST',user:author,csrf:'bad',body:payload})).status,403);
 a.db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(other.id);assert.equal((await write(a,'',other,payload)).status,403);
 a.db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(new Date().toISOString(),other.id);
 let r=await write(a,'',author,payload);assert.equal(r.status,201);let post=r.data.post;
 assert.equal((await a.call('/discussion')).data.topics[0].id,post.id);
 const reply=(await write(a,'/'+post.id+'/replies',other,{body:'答案 $1/3$'})).data.post;
 assert.equal((await write(a,'/'+reply.id+'/replies',author,{body:'不支持嵌套回复'})).status,409);
 assert.equal((await write(a,'/'+post.id,other,{...payload,version:1},'PUT')).status,403);
 r=await write(a,'/'+post.id,author,{...payload,body:'改后',version:1},'PUT');assert.equal(r.status,200);post=r.data.post;
 assert.equal((await write(a,'/'+post.id,author,{...payload,version:1},'PUT')).status,409);
 assert.equal((await a.call('/discussion/'+post.id+'/history')).status,403);
 assert.equal((await a.call('/discussion/'+post.id+'/history',{user:other})).status,403);
 assert.equal((await a.call('/discussion/'+post.id+'/history',{user:author})).data.history.length,2);
 assert.equal((await write(a,'/'+reply.id+'/moderate',other,{hidden:true,reason:'测试',version:1})).status,403);
 assert.equal((await write(a,'/'+reply.id+'/moderate',admin,{hidden:true,reason:'',version:1})).status,400);
 assert.equal((await write(a,'/'+reply.id+'/moderate',admin,{hidden:true,reason:'测试隐藏',version:1})).status,201);
 assert.equal((await a.call('/discussion/'+post.id)).data.replies.length,0);
 assert.equal((await a.call('/discussion/'+reply.id+'/history',{user:other})).status,404);
 assert.equal((await a.call('/discussion/'+post.id,{user:admin})).data.replies.length,1);
 assert.equal((await write(a,'/'+post.id+'/moderate',admin,{hidden:true,reason:'隐藏主题',version:2})).status,201);
 assert.equal((await a.call('/discussion?hidden=1',{user:author})).data.topics.length,0);
 assert.equal((await a.call('/discussion?hidden=1',{user:admin})).data.topics.length,1);
 assert.equal((await a.call('/discussion/'+post.id)).status,404);
 assert.equal((await write(a,'/'+post.id+'/replies',author,{body:'越过隐藏'})).status,404);
 assert.equal((await a.call('/discussion/'+reply.id+'/history',{user:other})).status,404);
 assert.equal((await write(a,'/'+post.id+'/moderate',admin,{hidden:false,reason:'恢复主题',version:3})).status,201);
 assert.equal((await write(a,'/'+reply.id+'/moderate',admin,{hidden:false,reason:'恢复回复',version:2})).status,201);
 assert.equal((await a.call('/discussion/'+post.id)).data.replies[0].body,'答案 $1/3$');
 const actions=(await a.call('/admin/actions',{user:admin})).data.actions;assert.equal(actions.filter(x=>x.target_type==='discussion').length,4);
 a.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(author.id);assert.equal((await write(a,'',author,payload)).status,401);
 assert.equal((await a.call('/discussion?page=NaN')).status,400);
 assert.equal((await write(a,'',other,{...payload,body:'x'.repeat(20001)})).status,400);
});
test('discussion rate limits and pagination are bounded, local edit switch is honored',async t=>{
 const a=await start(':memory:',{config:loadConfig({FUDAN_LOCAL_EDIT:'1'})});t.after(()=>a.close());const u=await a.register('限速作者');
 a.db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(u.id);
 for(let i=0;i<20;i++)assert.equal((await write(a,'',u,{...payload,title:'主题'+i})).status,201);
 assert.equal((await write(a,'',u,payload)).status,429);
 a.db.prepare("DELETE FROM auth_limits WHERE bucket LIKE 'discussion:%'").run();
 for(let i=0;i<11;i++)assert.equal((await write(a,'',u,payload)).status,201);
 assert.equal((await a.call('/discussion')).data.topics.length,30);assert.equal((await a.call('/discussion')).data.more,true);
 assert.equal((await a.call('/discussion?page=2')).data.topics.length,1);
});
test('Markdown escapes HTML, refuses script links and trusted TeX, keeps code literal and renders math',()=>{
 const html=discussionMarkdown('# 标题\n\n<script>alert(1)</script> [坏](javascript:alert) [链接](https://example.com)\n\n`$literal$`\n\n$$\n\\int_0^1 x^2 dx\n$$\n\n**粗体**\n\n- 一\n- 二',katex);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('class="katex'));assert.ok(html.includes('<code>$literal$</code>'));assert.ok(html.includes('<ul><li>一</li><li>二</li></ul>'));
 const malicious=discussionMarkdown('$\\href{javascript:alert(1)}{click}$',katex);assert.ok(!malicious.includes('href="javascript:'));
});
test('pending publication freezes draft controls; failure preserves draft and retry saves it',async()=>{
 const dom=new JSDOM('<button data-forum="new">新主题</button><div id="modal"></div>',{url:'http://localhost/#/discussion'});
 const oldDocument=globalThis.document,oldLocation=globalThis.location;globalThis.document=dom.window.document;globalThis.location=dom.window.location;
 let submit,resolve,reject,dirty=false,closed=false,sent;
 const ui=createDiscussionUI({user:()=>({id:'author',canEdit:true}),api:async(route,method,b)=>{sent=b;return new Promise((yes,no)=>{resolve=yes;reject=no})},modal:(title,html,fn)=>{document.querySelector('#modal').innerHTML=html;submit=fn},closeModal:()=>{closed=true},markDirty:v=>{dirty=v},refresh:async()=>{}});
 try{
  await ui.action({target:document.querySelector('button')});const form=document.querySelector('#forum-compose');form.elements.title.value='标题';form.elements.body.value='提交时的文字';form.oninput();
  const pending=submit(new dom.window.FormData(form));assert.equal(form.dataset.pending,'true');assert.ok([...form.querySelectorAll('input,textarea,button')].every(c=>c.disabled));assert.equal(dirty,true);
  reject(Error('测试网络失败'));await assert.rejects(pending,/测试网络失败/);assert.equal(closed,false);assert.equal(form.elements.body.value,'提交时的文字');assert.equal(dirty,true);assert.ok([...form.querySelectorAll('input,textarea,button')].every(c=>!c.disabled));
  form.elements.body.value='重试补充文字';const retry=submit(new dom.window.FormData(form));resolve({post:{id:'saved'}});await retry;assert.equal(sent.body,'重试补充文字');assert.equal(dirty,false);assert.equal(closed,true);assert.equal(location.hash,'#/discussion/saved');
 }finally{globalThis.document=oldDocument;globalThis.location=oldLocation;dom.window.close()}
});
test('discussion data, edit history and governance survive consistent backup and restore',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-discussion-')),dataDir=path.join(root,'live');fs.mkdirSync(dataDir);const dbPath=path.join(dataDir,'library.sqlite');
 const a=await start(dbPath,{dataDir});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const u=await a.register('持久作者');
 const p=(await write(a,'',u,payload)).data.post;await write(a,'/'+p.id,u,{...payload,body:'新版',version:1},'PUT');await write(a,'/'+p.id+'/moderate',u,{hidden:true,version:2,reason:'恢复测试'});
 const saved=await createBackup({dbPath,dataDir,backupRoot:path.join(root,'backups')});const restored=path.join(root,'restored');restoreBackup(saved.directory,restored);
 const db=new DatabaseSync(path.join(restored,'library.sqlite'));try{for(const table of ['discussion_posts','discussion_history','admin_actions'])assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),a.db.prepare('SELECT * FROM '+table).all())}finally{db.close()}
});
