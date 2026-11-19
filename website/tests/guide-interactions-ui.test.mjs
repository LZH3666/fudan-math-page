import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {createAtlasUI} from '../dist/course-atlas.js';
test('votes, feature and comments update locally without clearing a share draft; sorting keeps query state',async()=>{
 const dom=new JSDOM('<main></main>'),prev={document:globalThis.document,location:globalThis.location};globalThis.document=dom.window.document;globalThis.location={hash:''};
 let modalSubmit,refreshes=0,savedComment;const r={id:'share',kind:'guide',title:'选课经验分享',body:'经验正文',user_id:'u',username:'作者',version:1,my_vote:0,likes:0,dislikes:0,comment_count:0},comments=[];
 const ui=createAtlasUI({user:()=>({id:'u',canEdit:true,role:'admin'}),courses:()=>[],modal:(t,h,fn)=>{modalSubmit=fn},closeModal(){},markDirty(){},refresh(){refreshes++},api:async(p,m,b)=>{
  if(!m)return p.includes('/comments?')?{comments,more:false}:{entries:[r],more:true};
  if(p.endsWith('/vote'))return {entry:{...r,my_vote:b.value,likes:b.value===1?1:0,dislikes:b.value===-1?1:0}};
  if(p.endsWith('/feature'))return {entry:{...r,featured:b.featured,version:r.version+1}};
  if(p.endsWith('/comments')){savedComment=b;comments.push({id:'comment',user_id:'u',username:'作者',body:b.body,version:1,updated:new Date().toISOString()});return {comment:comments[0]};}
 }});
 const click=selector=>ui.action({target:document.querySelector(selector)});
 try{
  const parts=['guides','community'];parts.query='sort=time&page=2';document.querySelector('main').innerHTML=await ui.view(parts);ui.bind();await click('[data-atlas=start-share]');const form=document.querySelector('#guide-share-form');form.elements.body.value='未发表的分享';form.dispatchEvent(new dom.window.Event('input'));
  await click('[data-guide=up]');assert.equal(document.querySelector('[data-guide=up]').getAttribute('aria-pressed'),'true');assert.equal(form.elements.body.value,'未发表的分享');
  await click('[data-guide=down]');assert.equal(document.querySelector('[data-guide=down]').getAttribute('aria-pressed'),'true');await click('[data-guide=down]');assert.equal(document.querySelector('[data-guide=down]').getAttribute('aria-pressed'),'false');
  await click('[data-guide=feature]');await modalSubmit(new Map([['reason','加精华']]));assert.ok(!document.querySelector('.guide-feature').hidden);assert.equal(form.elements.body.value,'未发表的分享');assert.equal(refreshes,0);
  await click('[data-guide=write-comment]');const reply=document.querySelector('[data-guide-comment-form]');assert.equal(document.activeElement,reply.elements.body);reply.elements.body.value='我的评论';reply.dispatchEvent(new dom.window.Event('input'));await reply.onsubmit({preventDefault(){}});assert.equal(savedComment.body,'我的评论');assert.equal(document.querySelectorAll('.guide-comment').length,1);assert.equal(form.elements.body.value,'未发表的分享');assert.equal(refreshes,0);
  assert.equal(document.querySelector('#guide-sort select').value,'time');assert.match(document.querySelector('nav[aria-label=内容分页] a').getAttribute('href'),/sort=time&page=1/);
  document.querySelector('#guide-sort').onsubmit({preventDefault(){}});assert.equal(globalThis.location.hash,'/guides/community?sort=time');
 }finally{Object.assign(globalThis,prev);dom.window.close()}
});
test('file picker uploads a Markdown attachment and attachment-only sharing preserves URL fields',async()=>{
 const dom=new JSDOM('<main></main>'),prev={document:globalThis.document,FileReader:globalThis.FileReader};globalThis.document=dom.window.document;
 globalThis.FileReader=class{readAsDataURL(){this.result='data:text/markdown;base64,IyDnu4/pqow=';this.onload()}};
 let uploaded,submitted;const ui=createAtlasUI({user:()=>({id:'u',canEdit:true}),courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){},api:async(p,m,b)=>{if(!m)return {entries:[],more:false};if(p.endsWith('/uploads')){uploaded=b;return {file:{id:'file',name:b.name,mime:'text/markdown; charset=utf-8',url:'/api/atlas/files/file'}}}submitted=b;return {entry:{id:'new'}}}});
 try{
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();await ui.action({target:document.querySelector('[data-atlas=start-share]')});const form=document.querySelector('#guide-share-form'),picker=document.querySelector('#guide-file-input');assert.match(form.textContent,/正文、网页链接和附件会一起发布为同一条分享/);Object.defineProperty(picker,'files',{value:[new dom.window.File(['# 经验'],'经验.md')]});await picker.onchange();assert.equal(uploaded.name,'经验.md');assert.ok(uploaded.data);assert.equal(form.shareFiles.length,1);assert.match(form.querySelector('[data-guide-files]').textContent,/经验.md/);assert.equal(form.dataset.pending,'false');
  form.elements.links.value='https://example.com/reference';await form.onsubmit({preventDefault(){}});assert.equal(submitted.body,'');assert.deepEqual(submitted.attachments,['file']);assert.deepEqual(submitted.links,['https://example.com/reference']);
 }finally{Object.assign(globalThis,prev);dom.window.close()}
});
test('hidden shares have no write-comment entry or comment composer',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 const r={id:'hidden',kind:'guide',title:'选课经验分享',body:'已隐藏',user_id:'u',hidden:1,version:2};
 const ui=createAtlasUI({user:()=>({id:'u',canEdit:true,role:'admin'}),courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){},api:async p=>p.includes('/comments?')?{comments:[],more:false}:{entries:[r],more:false}});
 try{document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();assert.equal(document.querySelector('[data-guide=write-comment]'),null);await ui.action({target:document.querySelector('[data-guide=comments]')});assert.equal(document.querySelector('[data-guide-comment-form]'),null);assert.match(document.querySelector('.guide-comments').textContent,/已隐藏，不能新增或修改评论/)}finally{globalThis.document=previous;dom.window.close()}
});
test('delayed comment pagination preserves newly typed drafts and only the newest request may render',async()=>{
 const dom=new JSDOM('<main></main>'),previous=globalThis.document;globalThis.document=dom.window.document;
 const record={id:'race',kind:'guide',title:'选课经验分享',body:'分享',user_id:'u',version:1},c=body=>({id:body,body,user_id:'v',username:'读者',updated:new Date().toISOString(),version:1});let calls=0;const releases=[];
 const ui=createAtlasUI({user:()=>({id:'u',canEdit:true}),courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){},api:async p=>{if(!p.includes('/comments?'))return {entries:[record],more:false};if(++calls===1)return {comments:[c('第一页')],more:true};return new Promise(resolve=>releases.push(resolve));}});
 const action=selector=>ui.action({target:document.querySelector(selector)});
 try{
  document.querySelector('main').innerHTML=await ui.view(['guides','community']);ui.bind();await action('[data-guide=comments]');const form=document.querySelector('[data-guide-comment-form]');
  const delayed=action('[data-guide=comment-next]');await new Promise(r=>setImmediate(r));form.elements.body.value='等待响应时的新草稿';form.dispatchEvent(new dom.window.Event('input'));releases[0]({comments:[c('不应覆盖草稿')],more:true});await delayed;
  assert.ok(form.isConnected);assert.equal(form.elements.body.value,'等待响应时的新草稿');assert.doesNotMatch(document.querySelector('.guide-comments').textContent,/不应覆盖草稿/);
  await action('[data-guide=comment-cancel]');const older=action('[data-guide=comment-next]'),newer=action('[data-guide=comment-next]');await new Promise(r=>setImmediate(r));releases[2]({comments:[c('最新请求内容')],more:true});await newer;releases[1]({comments:[c('过期请求内容')],more:true});await older;
  assert.match(document.querySelector('.guide-comments').textContent,/最新请求内容/);assert.doesNotMatch(document.querySelector('.guide-comments').textContent,/过期请求内容/);
 }finally{globalThis.document=previous;dom.window.close()}
});
