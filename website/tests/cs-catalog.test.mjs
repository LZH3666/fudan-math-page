import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {courseCollections,universityMathSubjectId,isCourseCollectionSubject,collectionForSubject} from '../dist/catalog.mjs';
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const link=(t,p)=>`<a href="#${p}">${t}</a>`;
test('CS课程面包屑独立于数学科学学院且没有中间板块',()=>{
 const crumb=new Function('link','e','subjectName','isCourseCollectionSubject',source.slice(source.indexOf('function crumb('),source.indexOf('function section('))+';return crumb')(link,x=>x,id=>courseCollections.find(c=>c.path==='/subject/'+id)?.title||'分析',isCourseCollectionSubject);
 const dom=new JSDOM(crumb({id:'cs-os',title:'操作系统',subject:'cs'},'期末'));
 try{
  assert.deepEqual([...dom.window.document.querySelectorAll('a')].map(a=>a.textContent),['课程资料','CS','操作系统']);
  assert.equal(dom.window.document.querySelector('a[href="#/subject/cs"]').textContent,'CS');
  assert.doesNotMatch(dom.window.document.body.textContent,/数学科学学院|分析/);
 }finally{dom.window.close()}
 assert.match(crumb({id:'calc',title:'微积分',subject:universityMathSubjectId}),/大学数学/);
 assert.match(crumb({id:'ana',title:'数学分析',subject:'analysis'}),/数学科学学院/);
 for(const c of courseCollections.filter(c=>c.id!=='major')){
  const html=crumb({id:'course',title:'示例课程',subject:c.path.split('/').at(-1)});
  assert.ok(html.includes(c.title));assert.doesNotMatch(html,/数学科学学院/);
 }
});
test('实际CS目录只直接列出所属课程并复用普通课程列表',()=>{
 const begin=source.indexOf("}else if(p[0]==='subject'){")+"}else if(p[0]==='subject'){".length,end=source.indexOf("}else if(p[0]==='new'){",begin);
 const render=new Function('p','state','isCourseCollectionSubject','collectionForSubject','link','e','layout','button','let html;'+source.slice(begin,end)+';return html');
 for(const c of courseCollections.filter(c=>c.id!=='major')){
 const sid=c.path.split('/').at(-1);
 const html=render(['subject',sid],{subjects:[{id:sid,title:c.title}],courses:[{id:'os',title:'操作系统',subject:sid},{id:'ml',title:'机器学习',subject:sid},{id:'calculus',title:'数学分析',subject:'analysis'}]},isCourseCollectionSubject,collectionForSubject,link,x=>x,x=>x,()=>'<button>添加课程</button>');
 const dom=new JSDOM(html);try{
  const d=dom.window.document;
  assert.equal(d.querySelector('h1').textContent,c.title);
  assert.deepEqual([...d.querySelectorAll('.large-course-list a')].map(a=>a.textContent),['操作系统','机器学习']);
  assert.equal(d.querySelectorAll('h2,.subject-section,.subject-grid').length,0);
  assert.doesNotMatch(d.body.textContent,/数学科学学院|数学分析/);
 }finally{dom.window.close()}
 }
});
