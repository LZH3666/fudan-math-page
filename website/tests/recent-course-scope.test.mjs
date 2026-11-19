import {catalogFetch} from './catalog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {prepareCatalog,catalogCourses,catalogOfferings,findCourse,courseOfferings} from '../dist/course-model.mjs';
import {createAtlasUI} from '../dist/course-atlas.js';
const terms=['2025-2026秋','2025-2026寒假','2025-2026春','2025-2026暑假','2026-2027秋'];
const base={scope:[{id:'retained-old',name:'以前的课程',department:'学院甲',code:'OLD',offerings:[{id:'old',term:'2023-2024秋',code:'OLD.01',teachers:['旧教师']}]}],reviews:[{id:901,group_id:90,teacher:'历史教师',year:2023,semester:1,content:'完整历史修读体验'}],syllabi:[]};
const extra={coverage:{catalog_terms:terms},courses:[{name:'当前课程',department:'学院甲',code:'NOW',danxi_group_ids:[90],direct_review_ids:[901],offerings:[{id:'official:1',term:'2025-2026秋',code:'NOW.01',teachers:['教师甲']},{id:'official:2',term:'2026-2027秋',code:'NOW.02',teachers:['教师乙']}]}]};
test('recent directory narrows courses and offerings but retains historical reviews, class selection and old links',()=>{
 const d=prepareCatalog(base,extra),g=catalogCourses(d)[0];assert.equal(catalogCourses(d).length,1);assert.equal(g.name,'当前课程');assert.equal(catalogOfferings(g,d).length,2);assert.ok(courseOfferings(g).some(o=>o.term==='2023-2024秋'));assert.ok(findCourse(d,'retained-old'));assert.equal(findCourse(d,'retained-old').in_catalog,false);
});
test('course list exposes recent terms only, while the course page keeps older student experience',async()=>{
 const dom=new JSDOM('<main id="root"></main>'),before={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;
 globalThis.fetch=catalogFetch(base,extra);
 try{const ui=createAtlasUI({api:async()=>({entries:[],mine:[],count:0}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
  document.querySelector('#root').innerHTML=await ui.view(['reviews']);assert.equal(document.querySelectorAll('.atlas-course-list li').length,1);assert.doesNotMatch(document.querySelector('.atlas-course-list').textContent,/以前的课程/);assert.doesNotMatch(document.querySelector('#atlas-filter select[name=term]').textContent,/2023-2024/);
  const g=catalogCourses(prepareCatalog(base,extra))[0];document.querySelector('#root').innerHTML=await ui.view(['reviews',g.id]);assert.doesNotMatch(document.querySelector('#atlas-offerings').textContent,/2023-2024/);assert.match(document.querySelector('#atlas-experiences').textContent,/完整历史修读体验/);assert.match(document.querySelector('#atlas-experiences').textContent,/2023-2024/);
 }finally{Object.assign(globalThis,before);dom.window.close()}
});
