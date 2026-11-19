import test from 'node:test';
import assert from 'node:assert/strict';
import {start} from './helpers.mjs';
import {createAtlasUI} from '../dist/course-atlas.js';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
const uiOptions={courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}};
test('sharing opens on demand, cancellation protects drafts, clears all editor fields and closes preview',async()=>{
 const dom=new JSDOM('<main></main>'),previous={document:globalThis.document,confirm:globalThis.confirm};globalThis.document=dom.window.document;
 const original={id:'own',kind:'guide',user_id:'u',username:'作者',title:'原题目',body:'已有经验',links:['https://example.com/old'],attachments:[{id:'old-file',name:'原附件.md'}],version:3};let dirty=false;
 const ui=createAtlasUI({...uiOptions,user:()=>({id:'u',canEdit:true}),markDirty:value=>dirty=value,api:async()=>({entries:[original],entry:original,more:false})});
 const click=selector=>ui.action({target:document.querySelector(selector)});
 try{
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();
  const form=document.querySelector('#guide-share-form'),trigger=document.querySelector('[data-atlas=start-share]');
  assert.equal(form.hidden,true);assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.ok(form.querySelector('#guide-share-preview').closest('[hidden]'));
  await click('[data-atlas=start-share]');assert.equal(form.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');assert.equal(document.activeElement,form.elements.body);
  form.elements.body.value='未发布草稿';form.elements.links.value='https://example.com/new';form.dispatchEvent(new dom.window.Event('input'));form.querySelector('details').open=true;
  await click('[data-atlas=start-share]');assert.equal(form.elements.body.value,'未发布草稿');assert.equal(dirty,true);
  globalThis.confirm=()=>false;await click('[data-atlas=cancel-share]');assert.equal(form.hidden,false);assert.equal(form.elements.body.value,'未发布草稿');assert.equal(dirty,true);
  form.dataset.pending='true';globalThis.confirm=()=>{throw Error('pending operations cannot be discarded')};await click('[data-atlas=cancel-share]');assert.equal(form.hidden,false);assert.equal(form.elements.links.value,'https://example.com/new');form.dataset.pending='false';
  globalThis.confirm=()=>true;await click('[data-atlas=cancel-share]');assert.equal(form.hidden,true);assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(form.elements.body.value,'');assert.equal(form.elements.links.value,'');assert.equal(form.querySelector('#guide-share-preview').textContent,'');assert.equal(form.querySelector('details').open,false);assert.equal(dirty,false);assert.equal(document.activeElement,trigger);
  await click('#share-own [data-atlas=edit]');assert.equal(form.hidden,false);assert.equal(form.shareTarget.id,'own');assert.equal(form.shareFiles.length,1);assert.equal(form.elements.links.value,'https://example.com/old');
  await click('[data-atlas=start-share]');assert.equal(form.shareTarget.id,'own');assert.equal(form.elements.body.value,'已有经验');
  await click('[data-atlas=cancel-share]');await click('[data-atlas=start-share]');assert.equal(form.shareTarget,null);assert.deepEqual(form.shareFiles,[]);assert.equal(form.elements.body.value,'');assert.equal(form.querySelector('[type=submit]').textContent,'发表分享');
  document.querySelector('main').innerHTML=await ui.view(['guides','own']);ui.bind();assert.equal(document.querySelector('#guide-share-form').hidden,true);await click('#share-own [data-atlas=edit]');assert.equal(document.querySelector('#guide-share-form').hidden,false);
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);assert.equal(document.querySelector('#guide-share-form').hidden,true);
 }finally{Object.assign(globalThis,previous);dom.window.close()}
});
test('experience comments require verified identity and CSRF; only the author edits and moderation preserves history',async t=>{
 const app=await start();t.after(()=>app.close());const admin=await app.register('分享管理员'),author=await app.register('分享作者'),other=await app.register('分享读者');
 const post=(user,body,route='',method='POST',extra={})=>app.call('/atlas/entries'+route,{user,method,body,...extra});
 assert.equal((await post(null,{kind:'guide',body:'经验'})).status,401);
 assert.equal((await post(author,{kind:'guide',body:'经验'},'','POST',{csrf:'bad'})).status,403);
 app.db.prepare('UPDATE users SET email_verified_at=NULL WHERE id=?').run(other.id);assert.equal((await post(other,{kind:'guide',body:'经验'})).status,403);
 app.db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(new Date().toISOString(),other.id);
 const created=await post(author,{kind:'guide',body:'先修建议 **原文**'});assert.equal(created.status,201);const r=created.data.entry;assert.equal(r.title,'选课经验分享');
 for(const who of [other,admin])assert.equal((await post(who,{body:'改他人',version:1},'/'+r.id,'PUT')).status,403);
 assert.equal((await post(author,{body:'更新',version:0},'/'+r.id,'PUT')).status,409);
 assert.equal((await post(author,{body:'自己的更新',version:1},'/'+r.id,'PUT')).status,200);
 assert.equal((await post(author,{body:'',version:2},'/'+r.id,'PUT')).status,400);
 assert.equal((await post(other,{hidden:true,reason:'测试',version:2},'/'+r.id+'/moderate')).status,403);
 assert.equal((await post(admin,{hidden:true,reason:'',version:2},'/'+r.id+'/moderate')).status,400);
 assert.equal((await post(admin,{hidden:true,reason:'测试隐藏',version:2},'/'+r.id+'/moderate')).status,201);
 assert.equal((await app.call('/atlas/entries/'+r.id)).status,404);assert.equal((await app.call('/atlas/entries/'+r.id+'/history')).status,404);
 assert.equal((await app.call('/atlas/entries?kind=guide')).data.entries.length,0);
 assert.equal((await post(admin,{hidden:false,reason:'恢复',version:3},'/'+r.id+'/moderate')).status,201);
 assert.equal((await app.call('/atlas/entries/'+r.id)).data.entry.body,'自己的更新');
 const history=(await app.call('/atlas/entries/'+r.id+'/history')).data.history;assert.equal(history.length,4);assert.match(history.at(-1).snapshot,/原文/);
 app.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(author.id);assert.equal((await post(author,{kind:'guide',body:'封禁不能发布'})).status,401);
});
test('reference and experience boundaries, inline own controls, imported PDF and old guide records are preserved',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 const records=[{id:'own',user_id:'u',username:'本人',title:'原指南标题',body:'原有正文',kind:'guide',version:1},{id:'other',user_id:'v',username:'他人<script>',title:'选课经验分享',body:'<script>alert(1)</script>',kind:'guide',version:1}];
 try{
  const ui=createAtlasUI({...uiOptions,api:async()=>({entries:records,more:false}),user:()=>({id:'u',canEdit:true})});document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();
  assert.equal(document.querySelectorAll('#guide-shares article').length,2);assert.equal(document.querySelectorAll('#guide-share-form textarea[name=body]').length,1);assert.equal(document.querySelectorAll('#guide-share-form input[name=title]').length,1);assert.equal(document.querySelector('#guide-share-form').hidden,true);assert.equal(document.querySelector('.page-heading [data-atlas=start-share]').textContent,'参与分享');
  assert.equal(document.querySelectorAll('#share-own [data-atlas=edit]').length,1);assert.equal(document.querySelectorAll('#share-other [data-atlas=edit]').length,0);assert.equal(document.querySelectorAll('script').length,0);
  assert.match(document.querySelector('main').textContent,/原指南标题|原有正文/);assert.match(document.querySelector('a[href="#\/discussion"]').textContent,/讨论室/);assert.equal(document.querySelector('a[href="/course-atlas/assets/guide-202605.pdf"]'),null);
  const refs=await ui.view(['guides','references']);assert.match(refs,/文件收集/);assert.doesNotMatch(refs,/guide-202605.pdf/);assert.match(refs,/math-handbook-2024.pdf/);
  for(const account of [null,{id:'unverified',canEdit:false}]){const anonymous=createAtlasUI({...uiOptions,api:async()=>({entries:[],more:false}),user:()=>account});document.querySelector('main').innerHTML=await anonymous.view(['guides','community']);assert.equal(document.querySelector('#guide-share-form'),null);assert.equal(document.querySelector('.page-heading [data-action=account]').textContent,'参与分享');}
 }finally{globalThis.document=previous;dom.window.close()}
});
test('inline share submits once, keeps text on conflict, and editing preserves legacy title and version',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 const original={id:'legacy',kind:'guide',user_id:'u',username:'作者',title:'原有指南题目',body:'原有正文',version:7};let release,writes=[],refreshes=0,dirty=false,conflict=false;
 const pending=new Promise(r=>release=r),ui=createAtlasUI({...uiOptions,user:()=>({id:'u',canEdit:true}),markDirty:v=>dirty=v,refresh:async()=>{refreshes++},api:async(path,method,body)=>{if(!method)return {entries:[original],more:false};writes.push({path,method,body});if(conflict)throw Error('内容已有新版本');await pending;return {entry:{id:'new',...body}}}});
 const event={preventDefault(){}};
 try{
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();await ui.action({target:document.querySelector('[data-atlas=start-share]')});let form=document.querySelector('#guide-share-form');assert.equal(form.hidden,false);form.elements.body.value='新的选课经验';form.dispatchEvent(new dom.window.Event('input'));assert.equal(dirty,true);
  const saving=form.onsubmit(event);await new Promise(r=>setImmediate(r));assert.equal(form.dataset.pending,'true');assert.equal(form.elements.body.disabled,true);await form.onsubmit(event);assert.equal(writes.length,1);release();await saving;assert.equal(dirty,false);assert.equal(refreshes,1);assert.equal(writes[0].body.kind,'guide');
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();form=document.querySelector('#guide-share-form');await ui.action({target:{closest:()=>({dataset:{atlas:'edit',id:'legacy'}})}});assert.equal(form.hidden,false);assert.equal(form.elements.body.value,'原有正文');
  form.elements.body.value='保留的修改';form.dispatchEvent(new dom.window.Event('input'));conflict=true;await form.onsubmit(event);assert.equal(form.elements.body.value,'保留的修改');assert.equal(dirty,true);assert.match(form.querySelector('.form-error').textContent,/新版本/);assert.equal(writes.at(-1).body.title,'原有指南题目');assert.equal(writes.at(-1).body.version,7);
  assert.equal(writes.at(-1).method,'PUT');assert.equal(writes.at(-1).path,'/atlas/entries/legacy');
 }finally{globalThis.document=previous;dom.window.close()}
});
test('moderation cannot refresh away a pending share or discard a draft without confirmation',async()=>{
 const dom=new JSDOM('<main></main>'),previous={document:globalThis.document,confirm:globalThis.confirm};globalThis.document=dom.window.document;
 let confirmations=0,modals=0,writes=0,release,moderateSubmit;
 const pending=new Promise(r=>release=r),record={id:'share',kind:'guide',user_id:'v',username:'其他作者',title:'选课经验分享',body:'其他经验',version:1};
 const ui=createAtlasUI({...uiOptions,user:()=>({id:'u',canEdit:true,role:'admin'}),modal:(title,html,submit)=>{modals++;moderateSubmit=submit},api:async(path,method)=>{if(!method)return {entries:[record],more:false};writes++;await pending;return {entry:record}}});
 const moderate=()=>ui.action({target:{closest:()=>({dataset:{atlas:'moderate',id:'share'}})}});
 try{
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();await ui.action({target:document.querySelector('[data-atlas=start-share]')});const form=document.querySelector('#guide-share-form');form.elements.body.value='未发表草稿';form.dispatchEvent(new dom.window.Event('input'));
  globalThis.confirm=()=>{confirmations++;return false};await moderate();assert.equal(modals,0);assert.equal(form.elements.body.value,'未发表草稿');assert.equal(confirmations,1);
  const saving=form.onsubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));await moderate();assert.equal(modals,0);assert.equal(writes,1);assert.equal(form.dataset.pending,'true');assert.ok(form.isConnected);release();await saving;
  form.elements.body.value='新草稿';form.dispatchEvent(new dom.window.Event('input'));globalThis.confirm=()=>{confirmations++;return true};await moderate();assert.equal(modals,1);assert.equal(form.elements.body.value,'');assert.equal(form.dataset.dirty,'false');assert.equal(confirmations,2);
  form.dataset.pending='true';await assert.rejects(()=>moderateSubmit(new Map([['reason','治理测试']])),/正在保存/);assert.equal(writes,1);
 }finally{Object.assign(globalThis,previous);dom.window.close()}
});
