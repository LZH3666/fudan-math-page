import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {prepareDocumentSearch,searchDocuments,documentSnippet,documentMatchRanges} from '../dist/document-search.mjs';
import {createDocumentSearchUI} from '../dist/document-search-ui.js';
import {officialDocuments} from '../dist/official-documents.mjs';
const index=JSON.parse(fs.readFileSync(new URL('../dist/course-atlas/data/document-search.json',import.meta.url),'utf8'));
test('actual official PDF bodies are searchable across line wraps and return the original page',()=>{
 const rows=prepareDocumentSearch(officialDocuments,index),query='每位学生一学期免听课程总数不得超过三门';
 const result=searchDocuments(rows,query).find(r=>r.document.title.includes('教学管理规定'));
 assert.ok(result);assert.ok(!result.document.metadata.includes('免听'));assert.ok(result.matches.some(p=>p.page===50));assert.match(result.matches[0].snippet.text,/免听/);
 assert.equal(rows.filter(d=>d.indexed).length,35);assert.equal(rows.length,40);
});
test('all keywords must match the same file; metadata, multiple pages, width and case normalize together',()=>{
 const docs=[{href:'/a.pdf',title:'数学手册',group:'数学科学学院'},{href:'/b.pdf',title:'体育须知',group:'体育'}];
 const rows=prepareDocumentSearch(docs,{documents:[{href:'/a.pdf',pages:[{page:1,text:'ＧＰＡ 与 数学\n分析'},{page:2,text:'补考申请'}]},{href:'/b.pdf',pages:[{page:1,text:'GPA'}]}]});
 assert.deepEqual(searchDocuments(rows,'gpa 数学分析 补考').map(r=>r.document.href),['/a.pdf']);assert.equal(searchDocuments(rows,'gpa 不存在').length,0);assert.equal(searchDocuments(rows,'   ').length,2);
 assert.equal(searchDocuments(rows,'数学科学学院').length,1);assert.deepEqual(documentMatchRanges('数 学\n分析',['数学分析']),[[0,6]]);
 const text='前文'.repeat(100)+'免听'+'后文'.repeat(100),snippet=documentSnippet(text,['免听']);assert.ok(snippet.before&&snippet.after);assert.match(snippet.text,/免听/);assert.ok(snippet.text.length<200);
});
test('recognized image, Word bodies and embedded formula text are indexed alongside the original Qiangji PDF',()=>{
 const rows=prepareDocumentSearch(officialDocuments,index);
 const contains=(query,title)=>searchDocuments(rows,query).some(r=>r.document.title.includes(title)&&r.matches.length);
 assert.ok(contains('1994秋季学期之前','本科生成绩制度说明'));
 assert.ok(contains('所有专业课程平均绩点 学业综合成绩','推免工作细则附件'));
 assert.ok(contains('Journal of Machine Learning Research','推免工作细则附件'));
 assert.ok(contains('2025年6月以后三级甲等医院','测试申请表'));
 const q=searchDocuments(rows,'单独编班').find(r=>r.document.title.includes('强基计划培养方案'));
 assert.ok(q);assert.ok(q.document.href.endsWith('/qiangji-2026.pdf'));assert.ok(q.matches.some(p=>p.page===1));
});
test('files without extracted body remain title-searchable without claiming full-text coverage',()=>{
 const rows=prepareDocumentSearch([{href:'https://example.test/login',title:'选课通知',access:'login'}],{documents:[{href:'https://example.test/login',reason:'需学校登录，未收录正文',pages:[]}]});
 assert.equal(searchDocuments(rows,'选课').length,1);assert.equal(searchDocuments(rows,'免听').length,0);assert.equal(rows[0].indexed,false);assert.match(rows[0].reason,/未收录正文/);
});
test('search UI shows body snippets and PDF page links, escapes text, clears and handles unavailable index',async()=>{
 const prior={document:globalThis.document,fetch:globalThis.fetch},dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 globalThis.fetch=async()=>({ok:true,json:async()=>index});
 try{
  const ui=createDocumentSearchUI();document.querySelector('main').innerHTML=await ui.view();ui.bind();
  const form=document.querySelector('form');assert.equal(document.querySelector('[role=status]'),null);form.elements.query.value='免听 超过三门';form.elements.query.oninput();
  assert.ok(document.querySelector('mark'));assert.ok(document.querySelector('a[href$="teaching-regulations-2026.pdf#page=50"]'));assert.match(document.body.textContent,/三门/);
  form.elements.query.value='必定不存在的关键词xyz123';form.onsubmit({preventDefault(){}});assert.match(document.body.textContent,/没有找到/);form.onreset();assert.equal(form.elements.query.value,'');assert.equal(document.querySelector('[role=status]'),null);
  const bad={documents:[{href:officialDocuments[0].href,pages:[{page:1,text:'恶意<img src=x onerror=alert(1)>文本'}]}]};globalThis.fetch=async()=>({ok:true,json:async()=>bad});const safe=createDocumentSearchUI();document.querySelector('main').innerHTML=await safe.view();safe.bind();document.querySelector('input').value='恶意';document.querySelector('input').oninput();assert.equal(document.querySelectorAll('img,script').length,0);assert.match(document.body.textContent,/<img/);
  globalThis.fetch=async()=>{throw Error('offline')};const offline=createDocumentSearchUI();document.querySelector('main').innerHTML=await offline.view();offline.bind();assert.match(document.body.textContent,/正文搜索暂不可用/);document.querySelector('input').value='本科生教学管理';document.querySelector('input').oninput();assert.match(document.body.textContent,/找到 1 项文件/);
 }finally{Object.assign(globalThis,prior);dom.window.close()}
});
