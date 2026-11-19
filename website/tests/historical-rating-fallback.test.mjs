import {catalogFetch} from './catalog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {start} from './helpers.mjs';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {academicTerms} from '../dist/course-rating.mjs';
import {prepareCatalog} from '../dist/course-model.mjs';
import {contextFields,bindContextFields,scoreFields} from '../dist/course-feedback.js';
import {createAtlasUI} from '../dist/course-atlas.js';
const knownTerm='2025-2026秋',oldTerm='2023-2024秋';
const raw={scope:[{id:'historical',name:'历史评分测试课',department:'测试学院',code:'T1',teachers:['当前教师'],categories:[],teacher_evidence:[],offerings:[{id:'known-class',term:knownTerm,code:'T1.01',teachers:['当前教师']}]}],reviews:[],syllabi:[]};
const vote={courseId:'historical',grading:5,difficulty:3,workload:2,assessment:3,overall:4,version:0};
async function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'historical-rating-'));const file=path.join(root,'catalog.json');fs.writeFileSync(file,JSON.stringify(raw));const a=await start(':memory:',{atlasCatalogPath:file});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const user=await a.register('历史评分作者');return {a,user};}
test('every allowed semester without a class accepts a rating without fabricating a class',async t=>{
 const {a,user}=await setup(t),terms=academicTerms().filter(term=>term!==knownTerm);
 for(const term of terms){const response=await a.call('/atlas/ratings',{method:'POST',user,body:{...vote,term,teacher:'历史教师'}});assert.equal(response.status,200,term+': '+JSON.stringify(response.data));assert.equal(response.data.rating.offering_id,'');assert.equal(response.data.rating.teacher,'历史教师');}
 assert.equal((await a.call('/atlas/ratings?courseId=historical')).data.count,terms.length);
});
test('manual and unknown teachers can update without duplicate counts, while known classes and time bounds remain strict',async t=>{
 const {a,user}=await setup(t),post=body=>a.call('/atlas/ratings',{method:'POST',user,body:{...vote,...body}});
 const first=await post({term:oldTerm});assert.equal(first.status,200);assert.equal(first.data.rating.teacher,'');assert.equal(first.data.rating.offering_id,'');
 assert.equal((await post({term:oldTerm})).status,409);const edited=await post({term:oldTerm,version:1,overall:5});assert.equal(edited.status,200);assert.equal(edited.data.rating.id,first.data.rating.id);
 const named=await post({term:oldTerm,teacher:'往年授课教师'});assert.equal(named.status,200);const namedEdited=await post({term:oldTerm,teacher:'往年授课教师',version:1,grading:1});assert.equal(namedEdited.status,200);assert.equal(namedEdited.data.rating.id,named.data.rating.id);
 const summary=(await a.call('/atlas/ratings?courseId=historical')).data;assert.equal(summary.count,2);assert.ok(summary.teachers.includes('往年授课教师'));
 for(const bad of [{term:'2021-2022秋'},{term:'2099-2100秋'},{term:knownTerm,teacher:'手填不能绕过选班'},{term:oldTerm,offeringId:'known-class'},{term:oldTerm,teacher:'x'.repeat(101)}])assert.equal((await post(bad)).status,400);
 const normal=await post({term:knownTerm,offeringId:'known-class',teacher:'忽略这个手填名'});assert.equal(normal.status,200);assert.equal(normal.data.rating.teacher,'当前教师');
 const review=await a.call('/atlas/entries',{method:'POST',user,body:{kind:'review',courseId:'historical',term:oldTerm,teacher:'老教师',title:'历史体验',body:'当年的实际修读体验'}});assert.equal(review.status,201);assert.equal(review.data.entry.offering_id,'');assert.equal(review.data.entry.teacher,'老教师');
 assert.equal(a.db.prepare('SELECT count(*) n FROM atlas_rating_history WHERE rating_id=?').get(named.data.rating.id).n,2);
});
test('missing class semester switches to optional teacher; returning to known semester clears stale teacher',()=>{
 const g=prepareCatalog(structuredClone(raw)).scope[0],dom=new JSDOM('<form>'+contextFields(g)+scoreFields()+'</form>'),form=dom.window.document.querySelector('form');
 try{bindContextFields(g,form);form.elements.term.value=oldTerm;form.elements.term.dispatchEvent(new dom.window.Event('change'));assert.equal(form.elements.offeringId.disabled,true);assert.equal(form.elements.teacher.disabled,false);assert.equal(form.querySelector('[data-missing-class-note]').hidden,false);for(const key of ['grading','difficulty','workload','assessment','overall'])form.elements[key].value='4';assert.equal(form.checkValidity(),true);
  form.elements.teacher.value='老教师';const fields=new dom.window.FormData(form);assert.equal(fields.get('teacher'),'老教师');assert.equal(fields.get('offeringId'),null);
  form.elements.term.value=knownTerm;form.elements.term.dispatchEvent(new dom.window.Event('change'));assert.equal(form.elements.teacher.disabled,true);assert.equal(form.elements.teacher.value,'');assert.equal(form.elements.offeringId.required,true);assert.equal(form.checkValidity(),false);
 }finally{dom.window.close()}
});
test('manual historical rating is refilled and saved with its existing version',async()=>{
 const dom=new JSDOM('<main></main><div id="editor"></div>'),prev={document:globalThis.document,fetch:globalThis.fetch};globalThis.document=dom.window.document;globalThis.fetch=catalogFetch(raw);
 const mine={id:'old-rating',term:oldTerm,teacher:'老教师',offering_id:'',version:3,grading:1,difficulty:2,workload:3,assessment:4,overall:5};let submit,saved;
 const ui=createAtlasUI({user:()=>({id:'u',canEdit:true}),courses:()=>[],modal:(title,html,fn)=>{document.querySelector('#editor').innerHTML=html;submit=fn},closeModal(){},refresh(){},markDirty(){},api:async(p,m,b)=>{if(m){saved=b;return {rating:{}}}return p.includes('/ratings')?{mine:[mine]}:{entries:[],more:false}}});
 try{document.querySelector('main').innerHTML=await ui.view(['reviews','historical']);await ui.action({target:{closest:selector=>selector==='[data-atlas]'?{dataset:{atlas:'rate'}}:null}});const form=document.querySelector('#atlas-compose');form.elements.term.value=oldTerm;form.elements.term.dispatchEvent(new dom.window.Event('change',{bubbles:true}));form.elements.teacher.value='老教师';form.elements.teacher.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(form.elements.overall.value,'5');assert.equal(form.elements.grading.value,'1');
  await submit(new dom.window.FormData(form));assert.equal(saved.version,3);assert.equal(saved.teacher,'老教师');assert.equal(saved.offeringId,undefined);assert.equal(saved.term,oldTerm);
 }finally{Object.assign(globalThis,prev);dom.window.close()}
});
