import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {attachSourceReviews,chooseSnapshot} from '../scripts/install-university-courses.mjs';
import {prepareCatalog} from '../dist/course-model.mjs';
const content='原始全文'.repeat(400),catalog={scope:[],reviews:[]},official={schema_version:1,coverage:{complete:true},courses:[{name:'测试课(H)',department:'学院甲',codes:['CODE1'],code:'CODE1',offerings:[]},{name:'测试课（H）',department:'学院甲',codes:['CODE2'],code:'CODE2',offerings:[]},{name:'测试课(H)',department:'学院乙',code:'CODE3',offerings:[]}]};
const raw=()=>({id:10,name:'测试课(H)',department:'学院甲',review_count:1,export_metadata:{source_review_count:1,exported_reviews:1,count_matches:true,fetched_at_utc:'2026-10-24T01:00:00Z'},course_list:[{id:100,teachers:'教师',year:2025,semester:1,code_id:'CODE1.01',review_list:[{id:1000,title:'标题',content,content_sha256:createHash('sha256').update(content).digest('hex')}]}]});
test('official import associates full-only source groups by name and department and retains equivalent code variants',()=>{
 const result=attachSourceReviews(catalog,official,[raw()]);assert.equal(result.directory.courses.length,2);assert.deepEqual(result.directory.courses[0].codes,['CODE1','CODE2']);assert.deepEqual(result.directory.courses[0].danxi_group_ids,[10]);assert.equal(result.directory.courses[1].danxi_group_ids,undefined);assert.equal(result.full.reviews[0].content,content);const g=prepareCatalog(catalog,result.directory).scope[0];assert.deepEqual(g.source_group_ids,[10]);assert.equal(g.offerings[0].id,'danxi:100');
 const changed=raw();changed.department='未知院系';assert.throws(()=>attachSourceReviews(catalog,official,[changed]),/对应/);const tampered=raw();tampered.course_list[0].review_list[0].content+='篡改';assert.throws(()=>attachSourceReviews(catalog,official,[tampered]),/review/);
});
test('multiple saved versions retain newest source timestamp while ambiguous versions stop',()=>{
 const previous=raw(),next=raw();next.export_metadata.fetched_at_utc='2026-10-24T02:00:00Z';next.review_count=2;assert.equal(chooseSnapshot(previous,next),next);assert.equal(chooseSnapshot(next,previous),next);next.export_metadata.fetched_at_utc=previous.export_metadata.fetched_at_utc;assert.throws(()=>chooseSnapshot(previous,next),/快照/);
});
test('verified legacy source departments constrain old reviews even when name and code equal a new department course',()=>{
 for(const name of ['模式识别与机器学习','计算机网络']){
  const source=raw();source.name=name;source.code='COMP1';source.department='计算机科学技术学院';const old={scope:[{id:'old',name,code:'COMP1',offerings:[{syllabus:101,term:'2025-2026秋',code:'COMP1.01',teachers:['教师']}],direct_review_ids:[1000]}],reviews:[{id:1000,group_id:10,teacher:'教师',year:2025,semester:1}]};
  const current={schema_version:1,courses:[{name,code:'COMP1',department:'计算与智能创新学院',offerings:[{id:'official:101',code:'COMP1.01',term:'2025-2026秋',teachers:['教师']}]}]};
  const result=attachSourceReviews(old,current,[source]),d=prepareCatalog({...old,full_reviews:result.full.reviews},result.directory),newGroup=d.scope.find(g=>g.department==='计算与智能创新学院'),oldGroup=d.scope.find(g=>g.department==='计算机科学技术学院');assert.deepEqual(newGroup.source_group_ids,[]);assert.deepEqual(newGroup.direct_review_ids,[]);assert.deepEqual(oldGroup.source_group_ids,[10]);assert.deepEqual(oldGroup.direct_review_ids,[1000]);
 }
});
