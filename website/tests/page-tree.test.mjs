import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {orderedPageSubtree,currentPageDirectory} from '../dist/page-tree.mjs';
import {siteNavigation} from '../dist/site-navigation.mjs';

test('page-local tree includes its root and only ordered descendants',()=>{
 const docs=[
  {id:'course',title:'课程',is_course_home:true,parent_id:null},
  {id:'sibling',title:'旁支',parent_id:'course'},
  {id:'parent',title:'当前父页',parent_id:'course'},
  {id:'child-b',title:'子页乙',parent_id:'parent'},
  {id:'grandchild',title:'孙页',parent_id:'child-b'},
  {id:'child-a',title:'子页甲',parent_id:'parent'},
  {id:'sibling-child',title:'旁支后代',parent_id:'sibling'}
 ];
 assert.deepEqual(orderedPageSubtree(docs,docs[2]).map(({id,depth})=>[id,depth]),[
  ['parent',0],['child-b',1],['grandchild',2],['child-a',1]
 ]);
 assert.deepEqual(orderedPageSubtree(docs,docs[0]).map(({id,depth})=>[id,depth]),[
  ['course',0],['sibling',1],['sibling-child',2],['parent',1],['child-b',2],['grandchild',3],['child-a',2]
 ]);
 assert.deepEqual(orderedPageSubtree(docs,docs[2]).filter(x=>x.id==='parent').map(x=>x.depth),[0]);
 assert.deepEqual(orderedPageSubtree(docs,{id:'leaf',title:'叶页'}).map(({id,depth})=>[id,depth]),[['leaf',0]]);
});
test('reader sidebar retains the current directory and direct pages without unrelated branches',()=>{
 const docs=[{id:'home',is_course_home:1,parent_id:null},{id:'notes',parent_id:'home'},{id:'exams',parent_id:'home'},{id:'n1',parent_id:'notes'},{id:'n2',parent_id:'notes'},{id:'deep',parent_id:'n1'},{id:'exam1',parent_id:'exams'}];
 const root=currentPageDirectory(docs,docs[0]);assert.deepEqual(root.pages.map(p=>p.id),['notes','exams']);
 const leaf=currentPageDirectory(docs,docs[4]);assert.equal(leaf.directory.id,'notes');assert.deepEqual(leaf.pages.map(p=>p.id),['n1','n2']);assert.equal(leaf.parent.id,'home');
 const parent=currentPageDirectory(docs,docs[3]);assert.equal(parent.directory.id,'n1');assert.deepEqual(parent.pages.map(p=>p.id),['deep']);assert.equal(parent.parent.id,'notes');
 const deep=currentPageDirectory(docs,docs[5]);assert.equal(deep.directory.id,'n1');assert.deepEqual(deep.pages.map(p=>p.id),['deep']);
 assert.deepEqual(currentPageDirectory([],null).pages,[]);
});
test('reader shows only direct children in the sidebar and preserves body and parent navigation',()=>{
 const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),start=source.indexOf('function pageShell('),end=source.indexOf('function fitParentReaderFrames(',start);
 const make=new Function('currentPageDirectory','orderedPageSubtree','link','pagePath','crumb','button','e','state','siteNavigation','directoryList',source.slice(start,end)+';return pageShell');
 const link=(t,p)=>'<a href="#'+p+'">'+t+'</a>',pagePath=(c,d)=>'/doc/'+d.id;
 const directoryList=items=>'<nav class="directory-list">'+items.map(x=>link(x.title,x.path)).join('')+'</nav>';
 const render=make(currentPageDirectory,orderedPageSubtree,link,pagePath,()=>'',()=>'',String,{user:null},siteNavigation,directoryList),home={id:'home',title:'课程',is_course_home:1,parent_id:null},folder={id:'folder',title:'当前讲义',parent_id:'home'},child={id:'child',title:'章节',parent_id:'folder'},other={id:'other',title:'无关试卷',parent_id:'home'};
 const dom=new JSDOM(render({id:'course',title:'课程',home_id:'home'},[home,folder,child,other],child,'read','<p>原正文</p>',[]));try{const doc=dom.window.document,side=doc.querySelector('#reader-sidebar');assert.equal(side.querySelectorAll('.primary-section-link').length,3);assert.equal(side.querySelectorAll('nav').length,1);assert.doesNotMatch(side.textContent,/当前讲义|章节|无关试卷/);assert.equal(doc.querySelector('.reader-parent a').getAttribute('href'),'#/doc/folder');assert.equal(doc.querySelector('.page-body').textContent,'原正文');assert.equal(doc.querySelector('main .page-tree'),null)}finally{dom.window.close()}
 const section={id:'section',title:'第一节',parent_id:'child'},deep={id:'deep',title:'深层页面',parent_id:'section'};
 const parentDom=new JSDOM(render({id:'course',title:'课程',home_id:'home'},[home,folder,child,section,deep,other],child,'read','<p>父页原正文</p>',[]));
 try{const doc=parentDom.window.document;
  assert.equal(doc.querySelector('.reader-parent a').getAttribute('href'),'#/doc/folder');
  assert.deepEqual([...doc.querySelectorAll('aside [data-section=materials] li a')].map(a=>a.textContent),['第一节']);
  assert.equal(doc.querySelector('main .page-tree'),null);
  assert.deepEqual([...doc.querySelectorAll('main .directory-list a')].map(a=>a.textContent),['第一节']);
  assert.doesNotMatch(doc.querySelector('main .directory-list').textContent,/深层页面|无关试卷/);
  assert.equal(doc.querySelector('.page-body').textContent,'父页原正文');assert.equal(doc.querySelectorAll('aside .primary-section-link').length,3);
  assert.doesNotMatch(doc.querySelector('aside').textContent,/章节|当前讲义|无关试卷|深层页面/);
 }finally{parentDom.window.close()}
 const discussion=new JSDOM(render({id:'course',title:'课程'},[home,folder,child,section],child,'discussion','<p>讨论</p>',[]));
 try{assert.equal(discussion.window.document.querySelector('main .directory-list'),null)}finally{discussion.window.close()}
});
