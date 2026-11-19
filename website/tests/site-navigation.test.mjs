import {catalogFetch} from './catalog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {primarySection,siteNavigation} from '../dist/site-navigation.mjs';
import {createAtlasUI} from '../dist/course-atlas.js';
import {courseCollections} from '../dist/catalog.mjs';
const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
test('file collection is a plain grouped list and does not fetch the paused search index',async()=>{
 const previous=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Unexpected network request')};
 try{
  const ui=createAtlasUI({api:async()=>{throw Error('Unexpected API request')},user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
  const dom=new JSDOM(await ui.view(['guides','references']));try{
   const doc=dom.window.document;assert.equal(doc.querySelectorAll('form,input,[role=search]').length,0);assert.equal(doc.querySelectorAll('section li').length,40);assert.equal(requests,0);
   assert.deepEqual([...doc.querySelectorAll('section h2')].map(n=>n.textContent),['学校（教务处）','数学科学学院','体育教学部']);assert.ok(doc.querySelector('a[href="/course-atlas/assets/official/qiangji-2026.pdf"]'));assert.equal(doc.querySelectorAll('a[href^="#/guides"]').length,0);
  }finally{dom.window.close()}
 }finally{globalThis.fetch=previous}
});

test('all routes keep fixed materials and guide subentries under their parents',()=>{
 const make=new Function('primarySection','siteNavigation','location',source.slice(source.indexOf('function sidebar('),source.indexOf('function crumb('))+';return {sidebar,layout}');
 for(const hash of ['#/','#/materials','#/doc/page/edit','#/about','#/discussion','#/search/test','#/reviews/C1','#/guides/g1']){
  const ui=make(primarySection,siteNavigation,{hash});
  const dom=new JSDOM(ui.layout('<form id="editor-form"></form>','analysis','math'));try{
   const doc=dom.window.document,side=doc.querySelector('aside');assert.equal(doc.querySelectorAll('aside').length,1);
   assert.deepEqual([...side.querySelectorAll('.primary-section-link')].map(a=>a.textContent),['课程资料','课程评价','其他功能']);
   assert.equal(side.querySelectorAll('nav').length,1);assert.equal(side.querySelectorAll('ul').length,3);assert.equal(side.querySelectorAll('li').length,courseCollections.length+6);assert.deepEqual([...side.querySelectorAll('[data-section=materials] li a')].map(a=>[a.textContent,a.getAttribute('href')]),courseCollections.map(c=>[c.title,'#'+c.path]));assert.equal(side.querySelectorAll('[data-section=reviews] ul').length,0);assert.deepEqual([...side.querySelectorAll('[data-section=guides] li a')].map(a=>a.textContent),['文件收集','经验汇编与分享','国家体测计算器']);
   assert.equal(doc.querySelectorAll('.sidebar-tree,.primary-section-content,.section-directory').length,0);assert.ok(doc.querySelector('#editor-form'));
  }finally{dom.window.close()}
 }
 assert.doesNotMatch(siteNavigation('reviews',[{title:'<测试>',path:'/subject/test'}]),/<测试>/);
 assert.doesNotMatch(source,/toggle-reader-sidebar|atlas\.navigation\(/);
});

test('actual materials route links directly to mathematics catalogs without the removed category layer',()=>{
 const start=source.indexOf(" if(!p.length||(p[0]==='materials'&&p.length===1)){"),body=source.indexOf('{',start)+1,end=source.indexOf("}else if(['reviews','guides']",body);
 const render=new Function('p','state','button','layout','courseCollections','link','directoryList','let html;'+source.slice(body,end)+';return html');
 for(const p of [[],['materials']]){
  const link=(title,path)=>'<a href="#'+path+'">'+title+'</a>',directoryList=items=>'<nav><ul>'+items.map(c=>'<li>'+link(c.title,c.path)+'</li>').join('')+'</ul></nav>';
  const html=render(p,{user:null,courses:[{title:'不得平铺的课程'}]},()=>'',html=>'<main>'+html+'</main>',courseCollections,link,directoryList);
  const dom=new JSDOM(html);try{const doc=dom.window.document;assert.deepEqual([...doc.querySelectorAll('main li a')].map(a=>[a.textContent,a.getAttribute('href')]),courseCollections.map(c=>[c.title,'#'+c.path]));assert.equal(doc.querySelectorAll('form,input,#materials-filter,#materials-list,.atlas-course-list').length,0);assert.doesNotMatch(doc.body.textContent,/不得平铺的课程/)}finally{dom.window.close()}
 }
 assert.doesNotMatch(source,/materialsView|materialSearchRows|materials-filter|materials-list/);
});

test('only reviews search course names and teachers; guides remain articles',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),prev={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
 const course=(id,name,teacher)=>({id,name,code:id,categories:[],teachers:[teacher],terms:[],offerings:[],teacher_evidence:[]});
 const d={scope:[course('C1','数理统计','张老师'),course('C2','概率论','李老师'),course('C3','仅课评课程','王老师')],syllabi:[],reviews:[]};
 globalThis.fetch=catalogFetch(d,{}, {reviews:d.full_reviews||[],groups:d.full_review_groups||[]});
 const ui=createAtlasUI({api:async()=>({entries:[]}),user:()=>null,courses:()=>[{id:'stats',title:'数理统计'},{id:'probability',title:'概率论'}],modal(){},closeModal(){},refresh(){},markDirty(){}});
 const root=document.querySelector('#root');
 const search=(id,value)=>{const form=document.getElementById(id);form.elements.query.value=value;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))};
 try{
  root.innerHTML=await ui.view(['reviews']);ui.bind();
  for(const q of ['概率论','李老师']){search('atlas-filter',q);await new Promise(r=>setImmediate(r));assert.equal(root.querySelectorAll('#atlas-list li').length,1);assert.equal(root.querySelector('#atlas-list a').getAttribute('href'),'#/reviews/C2')}
  root.innerHTML=await ui.view(['guides']);assert.equal(root.querySelector('form'),null);assert.match(root.textContent,/文件收集/);assert.doesNotMatch(root.textContent,/经验汇编与分享/);
  root.innerHTML=await ui.view(['guides','community']);assert.match(root.textContent,/经验汇编与分享/);assert.equal(root.querySelector('#guide-sort'),null);assert.match(root.textContent,/还没有人分享经验/);
 }finally{Object.assign(globalThis,prev);dom.window.close()}
});

test('course list shows review count and average, and filters to courses that have reviews',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),prev={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
 const course=(id,name,extra={})=>({id,name,code:id,department:'数学科学学院',categories:[],teachers:['张老师'],terms:[],offerings:[],teacher_evidence:[],direct_review_ids:[],source_group_ids:[],...extra});
 const reviews=[{id:11,group_id:'g1',teacher:'张老师',overall_score:5,content:'好课',title:'很好'},{id:12,group_id:'g1',teacher:'李老师',overall_score:3,content:'一般',title:'一般'}];
 const d={scope:[course('C1','数理统计',{source_group_ids:['g1']}),course('C2','概率论')],syllabi:[],reviews,full_reviews:reviews,full_review_groups:['g1']};
 globalThis.fetch=catalogFetch(d,{}, {reviews:d.full_reviews||[],groups:d.full_review_groups||[]});
 const ui=createAtlasUI({api:async()=>({entries:[]}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
 const root=document.querySelector('#root');
 try{
  root.innerHTML=await ui.view(['reviews']);ui.bind();
  const statOf=name=>[...root.querySelectorAll('#atlas-list li')].find(li=>li.querySelector('a').textContent===name).querySelector('.atlas-course-stat').textContent;
  assert.equal(root.querySelectorAll('#atlas-list li').length,2);
  assert.equal(statOf('数理统计'),'课评 2 条 · 均分 4.00');
  assert.equal(statOf('概率论'),'暂无课评');
  const form=root.querySelector('#atlas-filter');form.elements.ratingsOnly.checked=true;form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setImmediate(r));
  assert.deepEqual([...root.querySelectorAll('#atlas-list li a')].map(a=>a.textContent),['数理统计']);
  assert.match(root.querySelector('.atlas-results').textContent,/共 1 门有课评的课程/);
 }finally{Object.assign(globalThis,prev);dom.window.close()}
});

test('header contains only utility links; desktop sidebar is spaced vertically and mobile is compact',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'));try{
  assert.deepEqual([...dom.window.document.querySelectorAll('header a')].map(a=>a.textContent),['复旦数学资源库','讨论室','网站介绍']);assert.ok(dom.window.document.querySelector('header .search'));assert.ok(dom.window.document.querySelector('header .account'));
 }finally{dom.window.close()}
 const css=fs.readFileSync(new URL('../dist/style.css',import.meta.url),'utf8');
 assert.match(css,/min-height:calc\(100vh - 156px\);display:flex;flex-direction:column;justify-content:space-evenly/);
 assert.match(css,/\.primary-navigation>ul\{min-height:0;display:flex;flex-direction:row;justify-content:space-between/);
 assert.match(css,/\.subject-sidebar \.primary-navigation,\.reader-sidebar \.primary-navigation\{display:block;overflow:visible;max-height:none\}/);
 assert.doesNotMatch(source,/link\('课程资料','\/'\)/);
});
