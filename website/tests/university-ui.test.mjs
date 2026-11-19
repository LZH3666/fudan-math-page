import {catalogFetch} from './catalog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {prepareCatalog,courseOfferings} from '../dist/course-model.mjs';
import {createAtlasUI} from '../dist/course-atlas.js';
import {contextFields,bindContextFields,importedReviews} from '../dist/course-feedback.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {start} from './helpers.mjs';

const fall='2025-2026秋',spring='2025-2026春';
const raw={scope:[
 {id:'old-a',name:'课程甲',department:'院系甲',code:'A1',categories:[],teachers:['教师甲'],terms:[fall],offerings:[{id:'fall-a',term:fall,code:'A1.01',teachers:['教师甲'],credits:3},{id:'fall-b',term:fall,code:'A1.02',teachers:['教师甲'],credits:3},{id:'spring-a',term:spring,code:'A1.01',teachers:['教师乙'],credits:3}],direct_review_ids:[],teacher_evidence:[]},
 {id:'old-b',name:'课程甲',department:'院系甲',code:'A2',categories:[],teachers:['教师丙'],terms:[spring],offerings:[{id:'spring-b',term:spring,code:'A2.01',teachers:['教师丙']}],direct_review_ids:[],teacher_evidence:[]},
 {id:'other',name:'课程甲',department:'院系乙',code:'B1',categories:[],teachers:['教师丁'],terms:[fall],offerings:[{id:'other-a',term:fall,code:'B1.01',teachers:['教师丁']}],direct_review_ids:[],teacher_evidence:[]}
],reviews:[],syllabi:[]};
const fixture=()=>prepareCatalog(structuredClone(raw));
const mathGroup=d=>d.scope.find(g=>g.department==='院系甲');
const offer=(g,code,term)=>courseOfferings(g).find(o=>o.code===code&&o.term===term);

test('review context requires academic term then an actual class and clears stale class when term changes',()=>{
 const g=mathGroup(fixture()),dom=new JSDOM('<form>'+contextFields(g)+'</form>'),form=dom.window.document.querySelector('form');
 try{
  bindContextFields(g,form);assert.equal(form.elements.teacher.disabled,true);assert.equal(form.elements.term.required,true);assert.equal(form.elements.offeringId.required,true);assert.equal(form.checkValidity(),false);assert.equal(form.elements.offeringId.options.length,1);
  form.elements.term.value=fall;form.elements.term.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(form.elements.offeringId.options.length,3);assert.match(form.elements.offeringId.options[1].textContent,/A1\.01.*教师甲/);
  form.elements.offeringId.value=String(offer(g,'A1.01',fall).id);assert.equal(form.checkValidity(),true);
  form.elements.term.value=spring;form.elements.term.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(form.elements.offeringId.value,'');assert.equal(form.checkValidity(),false);assert.equal(form.elements.offeringId.options.length,3);
  form.elements.term.value='2022-2023秋';form.elements.term.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(form.elements.offeringId.options.length,1);assert.match(form.elements.offeringId.textContent,/暂无教学班/);assert.equal(form.elements.offeringId.disabled,true);assert.equal(form.elements.teacher.disabled,false);assert.equal(form.checkValidity(),true);
 }finally{dom.window.close()}
});

test('editing restores exact class, while ambiguous legacy teacher selection requires an explicit class',()=>{
 const g=mathGroup(fixture()),exact=offer(g,'A1.02',fall),dom=new JSDOM('<form>'+contextFields(g,{term:fall,offering_id:exact.id})+'</form>'),form=dom.window.document.querySelector('form');
 try{
  bindContextFields(g,form,{term:fall,offering_id:exact.id});assert.equal(form.elements.offeringId.value,String(exact.id));
  form.innerHTML=contextFields(g,{term:fall,teacher:'教师甲'});bindContextFields(g,form,{term:fall,teacher:'教师甲'});assert.equal(form.elements.offeringId.value,'');
  form.innerHTML=contextFields(g,{term:spring,teacher:'教师乙'});bindContextFields(g,form,{term:spring,teacher:'教师乙'});assert.equal(form.elements.offeringId.value,String(offer(g,'A1.01',spring).id));
 }finally{dom.window.close()}
});

function mount(t,d=raw){
 const dom=new JSDOM('<main id="root"></main><div id="editor"></div>'),before={document:globalThis.document,fetch:globalThis.fetch,location:globalThis.location};
 globalThis.document=dom.window.document;globalThis.location={hash:'#/reviews'};globalThis.fetch=catalogFetch(d);
 t.after(()=>{Object.assign(globalThis,before);dom.window.close()});return dom;
}

test('directory merges same name and department, searches parallel teachers, and keeps different departments separate',async t=>{
 const dom=mount(t),ui=createAtlasUI({api:async()=>({entries:[],more:false}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
 document.querySelector('#root').innerHTML=await ui.view(['reviews']);ui.bind();assert.equal(document.querySelectorAll('.atlas-course-list li').length,2);
 const form=document.querySelector('#atlas-filter');assert.deepEqual([...form.elements.department.options].map(o=>o.value),['all','院系甲','院系乙']);assert.ok([...form.elements.term.options].some(o=>o.value===fall));assert.ok([...form.elements.term.options].some(o=>o.value===spring));
 form.elements.query.value='教师丙';await form.onsubmit({preventDefault(){}});assert.equal(document.querySelectorAll('.atlas-course-list li').length,1);assert.match(document.querySelector('.atlas-course-list').textContent,/院系甲/);
 form.elements.query.value='';form.elements.department.value='院系乙';await form.onsubmit({preventDefault(){}});assert.equal(document.querySelectorAll('.atlas-course-list li').length,1);assert.match(document.querySelector('.atlas-course-list').textContent,/教师丁/);assert.equal(dom.window.document.querySelectorAll('script').length,0);
});

test('generated directory includes the optional university source when available',async t=>{
 mount(t);let extraExists=true;
 globalThis.fetch=(...args)=>catalogFetch({...structuredClone(raw),scope:[structuredClone(raw.scope[0])]},extraExists?{courses:[structuredClone(raw.scope[2])]}:{})(...args);
 const create=()=>createAtlasUI({api:async()=>({entries:[],more:false}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
 document.querySelector('#root').innerHTML=await create().view(['reviews']);assert.equal(document.querySelectorAll('.atlas-course-list li').length,2);assert.match(document.querySelector('.atlas-course-list').textContent,/院系乙/);
 extraExists=false;document.querySelector('#root').innerHTML=await create().view(['reviews']);assert.equal(document.querySelectorAll('.atlas-course-list li').length,1);assert.doesNotMatch(document.querySelector('.atlas-course-list').textContent,/院系乙/);
});

test('alias course page displays cross-term comments and scores; rating edit selects the exact parallel class',async t=>{
 mount(t);const d=fixture(),g=mathGroup(d),fallA=offer(g,'A1.01',fall),fallB=offer(g,'A1.02',fall),requests=[];let submit,saved;
 const mine=[{id:'r-a',offering_id:fallA.id,teacher:'教师甲',term:fall,version:2,grading:1,difficulty:2,workload:3,assessment:4,overall:5},{id:'r-b',offering_id:fallB.id,teacher:'教师甲',term:fall,version:4,grading:5,difficulty:4,workload:3,assessment:2,overall:1}];
 const ui=createAtlasUI({user:()=>({id:'u',canEdit:true}),courses:()=>[],modal:(title,html,fn)=>{document.querySelector('#editor').innerHTML=html;submit=fn},closeModal(){},refresh(){},markDirty(){},api:async(p,m,b)=>{requests.push(p);if(m==='POST'){saved=b;return {rating:{}}}return p.includes('/ratings')?{mine,count:2,groups:[{teacher:'教师甲',count:2,dimensions:[]}]}: {entries:[{id:'one',kind:'review',username:'同学甲',teacher:'教师甲',term:fall,body:'秋季评价',user_id:'x'},{id:'two',kind:'review',username:'同学乙',teacher:'教师乙',term:spring,body:'春季评价',user_id:'y'}],more:false}}});
 document.querySelector('#root').innerHTML=await ui.view(['reviews','old-b']);assert.match(document.body.textContent,/秋季评价/);assert.match(document.body.textContent,/春季评价/);assert.match(document.body.textContent,/2 份评分/);assert.ok(requests.some(p=>p.includes('courseId='+encodeURIComponent(g.id))));assert.ok(requests.filter(p=>p.includes('/ratings')).every(p=>new URLSearchParams(p.split('?')[1]).get('term')===''));
 await ui.action({target:{closest:()=>({dataset:{atlas:'rate'}})}});const form=document.querySelector('#atlas-compose');form.elements.term.value=fall;form.elements.term.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));form.elements.offeringId.value=String(fallB.id);form.elements.offeringId.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));assert.equal(form.elements.grading.value,'5');
 await submit(new Map([['term',fall],['offeringId',String(fallB.id)],['grading','5'],['difficulty','4'],['workload','3'],['assessment','2'],['overall','1']]));assert.equal(saved.offeringId,String(fallB.id));assert.equal(saved.version,4);assert.equal(saved.teacher,undefined);
});

test('full-only source groups display original reviews without unrelated groups or executable markup',()=>{
 const html=importedReviews({source_group_ids:[72],teacher_evidence:[]},{reviews:[],full_review_groups:[72]},[{id:1,group_id:72,title:'原文',teacher:'老师',year:2025,semester:1,content:'<script>原评</script>'},{id:2,group_id:73,content:'另一院系'}]),dom=new JSDOM(html);
 try{assert.equal(dom.window.document.querySelectorAll('article').length,1);assert.equal(dom.window.document.querySelector('p').textContent,'<script>原评</script>');assert.equal(dom.window.document.querySelectorAll('script').length,0)}finally{dom.window.close()}
});
test('an explicitly selected parallel class can claim one legacy teacher-term rating and update it through the real API',async t=>{
 mount(t);const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-class-ui-')),file=path.join(root,'catalog.json');fs.writeFileSync(file,JSON.stringify(raw));const a=await start(':memory:',{atlasCatalogPath:file});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const user=await a.register('旧评分迁移者'),g=mathGroup(fixture());
 const vote={courseId:g.id,term:fall,offeringId:'fall-a',grading:4,difficulty:3,workload:2,assessment:3,overall:4,version:0};const original=await a.call('/atlas/ratings',{method:'POST',user,body:vote});assert.equal(original.status,200);a.db.prepare("UPDATE atlas_ratings SET offering_id='' WHERE id=?").run(original.data.rating.id);
 let submit,sent;
 const ui=createAtlasUI({user:()=>user,courses:()=>[],modal:(title,html,fn)=>{document.querySelector('#editor').innerHTML=html;submit=fn},closeModal(){},refresh(){},markDirty(){},api:async(p,method='GET',body)=>{if(method==='POST')sent=body;const response=await a.call(p,{method,user,body});if(response.status>=400)throw Error(response.data.error);return response.data}});
 await ui.view(['reviews','old-a']);await ui.action({target:{closest:()=>({dataset:{atlas:'rate'}})}});const form=document.querySelector('#atlas-compose');assert.equal(form.elements.offeringId.value,'');form.elements.term.value=fall;form.elements.term.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));form.elements.offeringId.value='fall-b';form.elements.offeringId.dispatchEvent(new document.defaultView.Event('change',{bubbles:true}));assert.equal(form.elements.overall.value,'4');await submit(new Map([['term',fall],['offeringId','fall-b'],['grading','4'],['difficulty','3'],['workload','2'],['assessment','3'],['overall','5']]));assert.equal(sent.version,1);const rows=(await a.call('/atlas/ratings?courseId='+encodeURIComponent(g.id),{user})).data.mine;assert.equal(rows.length,1);assert.equal(rows[0].id,original.data.rating.id);assert.equal(rows[0].offering_id,'fall-b');assert.equal(rows[0].version,2);assert.equal(a.db.prepare('SELECT count(*) n FROM atlas_rating_history').get().n,2);
});
