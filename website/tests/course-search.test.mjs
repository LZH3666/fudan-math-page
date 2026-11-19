import {catalogFetch} from './catalog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {createCourseMatcher,createTitleMatcher,searchTokens} from '../dist/course-search.mjs';
import {createAtlasUI} from '../dist/course-atlas.js';

const course=(name,teachers,code='MATH10010')=>({name,teachers,codes:[code]});
test('initials cover names, polyphonic surnames and courses beyond the original atlas',()=>{
 const examples=[
  [course('数学分析 AI(H)',['严金海']),'sxfx YJH'],
  [course('数理统计',['杨新']),'杨 sltj'],
  [course('银行经营管理',['单明','曾明','解明','区明']),'yhjygl sm'],
  [course('银行经营管理',['单明','曾明','解明','区明']),'zm xm om'],
  [course('口腔颌面外科学',['翟明']),'kqhmwkx zm']
 ];
 for(const [g,q] of examples)assert.equal(createCourseMatcher(q)(g),true,q);
});

test('all tokens must match, independently of order, fullwidth case and whitespace',()=>{
 const g=course('数理统计',['杨新'],'MATH20010');
 for(const q of ['数理统计 杨','杨 数理统计','ＳＬＴＪ　ＹＸ','MATH20010\t杨\n统计','  ',''])assert.equal(createCourseMatcher(q)(g),true,q);
 for(const q of ['数理统计 王','sltj zz','MATH20011 杨','.*','[','<script>','\\'])assert.equal(createCourseMatcher(q)(g),false,q);
 assert.deepEqual(searchTokens(' ＡＢＣ　杨\n统计 '),['abc','杨','统计']);
});

test('field boundaries, course identity, source bodies and hidden metadata stay out of search',()=>{
 const g={...course('数学分析',['张三'],'MATH10010'),id:'secret-id',department:'隐藏学院',body:'秘密正文'};
 for(const q of ['析张','xzs','secret-id','隐藏学院','秘密正文'])assert.equal(createCourseMatcher(q)(g),false,q);
 assert.equal(createCourseMatcher('分析II')(g),false);
 assert.equal(createTitleMatcher('SX FX')('数学分析'),true);
 assert.equal(createTitleMatcher('sx 杨')('数学分析'),false);
});

const raw={scope:[
 {...course('数理统计',['杨新']),id:'math',department:'数学科学学院',categories:['数学'],offerings:[{id:'math-fall',term:'2026-2027秋',code:'MATH10010.01',teachers:['杨新']}]},
 {...course('数理统计',['王明'],'STAT10001'),id:'other',department:'其他学院',categories:['统计'],offerings:[{id:'other-spring',term:'2025-2026春',code:'STAT10001.01',teachers:['王明']}]},
 {...course('数学分析',['杨新'],'MATH10011'),id:'analysis',department:'数学科学学院',categories:['数学'],offerings:[{id:'analysis-fall',term:'2026-2027秋',code:'MATH10011.01',teachers:['杨新']}]}
],reviews:[],syllabi:[]};
function mount(t){
 const dom=new JSDOM('<main id="root"></main>'),before={document:globalThis.document,fetch:globalThis.fetch};
 globalThis.document=dom.window.document;
 globalThis.fetch=catalogFetch(raw);
 t.after(()=>{Object.assign(globalThis,before);dom.window.close()});
 return createAtlasUI({api:async()=>({entries:[],more:false}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
}
test('directory applies initials plus keyword AND alongside department, term and category filters',async t=>{
 const ui=mount(t);document.querySelector('#root').innerHTML=await ui.view(['reviews']);ui.bind();
 const form=document.querySelector('#atlas-filter'),submit=()=>form.onsubmit({preventDefault(){}}),rows=()=>[...document.querySelectorAll('.atlas-course-list li')];
 form.elements.query.value='ＳＬＴＪ　杨';await submit();assert.equal(rows().length,1);assert.match(rows()[0].textContent,/数学科学学院/);
 form.elements.query.value='统计';form.elements.department.value='其他学院';await submit();assert.equal(rows().length,1);assert.match(rows()[0].textContent,/王明/);
 form.elements.term.value='2026-2027秋';await submit();assert.equal(rows().length,0);
 form.elements.department.value='all';form.elements.term.value='all';form.elements.category.value='数学';form.elements.query.value='sltj';await submit();assert.equal(rows().length,1);
 form.elements.query.value='王 sltj';await submit();assert.equal(rows().length,0);
 form.elements.category.value='all';form.elements.query.value='';await submit();assert.equal(rows().length,3);
});
test('top search course links share the same matcher and return none for an empty query',async t=>{
 const ui=mount(t);
 for(const q of ['数理统计 杨','杨 sltj','ＳＬＴＪ　ＹＸ']){
  const html=await ui.searchLinks(q),dom=new JSDOM('<ul>'+html+'</ul>');
  try{assert.equal(dom.window.document.querySelectorAll('li').length,1);assert.match(dom.window.document.body.textContent,/数理统计.*数学科学学院/)}finally{dom.window.close()}
 }
 assert.equal(await ui.searchLinks('sltj 不存在'),'');assert.equal(await ui.searchLinks('　 '),'');
});
