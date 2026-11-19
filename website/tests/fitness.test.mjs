import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {fitnessResult,thresholdScore,parseRun} from '../dist/fitness-score.mjs';
import {createFitnessUI} from '../dist/fitness.js';
import {createAtlasUI} from '../dist/course-atlas.js';
const data=JSON.parse(fs.readFileSync(new URL('../dist/course-atlas/data/fitness.json',import.meta.url),'utf8'));
const inputFor=(sex,year)=>({sex,year,height:170,weight:60,...data.groups[sex+'_'+year].rows[0]});
test('四组标准满分100及两项附加分满分120，权重总和100',()=>{
 assert.equal(Object.values(data.weights).reduce((a,b)=>a+b),100);
 for(const sex of ['male','female'])for(const year of ['12','34']){
  const group=data.groups[sex+'_'+year],input=inputFor(sex,year);
  assert.equal(fitnessResult(input,data).total,100);
  assert.equal(fitnessResult({...input,strength:input.strength+group.bonus[0].strength_extra,run:input.run-group.bonus[0].run_seconds_faster},data).total,120);
  assert.equal(fitnessResult({...input,...group.rows.find(r=>r.points===60)},data).base,66);
 }
});
test('全部列示档位及其相邻成绩按高优或低优指标判定，力量空档不插值',()=>{
 for(const group of Object.values(data.groups))for(const row of group.rows)for(const key of ['lung','sprint','reach','jump','strength','run']){
  if(row[key]===null)continue;
  assert.equal(thresholdScore(group,key,row[key]),row.points);
  const worse=row[key]+(['run','sprint'].includes(key)?0.01:-0.01);
  assert.ok(thresholdScore(group,key,worse)<row.points);
 }
 assert.equal(thresholdScore(data.groups.male_12,'strength',14),76);
 assert.equal(thresholdScore(data.groups.male_12,'strength',4),0);
 assert.equal(thresholdScore(data.groups.male_12,'run',200),95);
});
test('四组附加分每个边界都正确且每项不超过10',()=>{
 for(const sex of ['male','female'])for(const year of ['12','34']){
  const g=data.groups[sex+'_'+year],input=inputFor(sex,year);
  for(const row of g.bonus){
   assert.equal(fitnessResult({...input,strength:input.strength+row.strength_extra,run:input.run-row.run_seconds_faster},data).strengthBonus,row.points);
   assert.equal(fitnessResult({...input,strength:input.strength+row.strength_extra,run:input.run-row.run_seconds_faster},data).runBonus,row.points);
  }
  assert.equal(fitnessResult({...input,strength:input.strength+100,run:1},data).total,120);
 }
});
test('时间格式、BMI男女边界及无效输入校验',()=>{
 for(const v of ['3:17','3分17秒','197秒',197])assert.equal(parseRun(v),197);
 for(const v of ['3.17','3:60','-1','',Infinity])assert.throws(()=>parseRun(v));
 const input={...inputFor('male','12'),height:100};
 for(const [sex,weight,expected] of [['male',17.8,80],['male',17.9,100],['female',17.1,80],['female',17.2,100],['male',23.9,100],['male',24,80],['female',27.9,80],['female',28,60]])assert.equal(fitnessResult({...input,sex,weight},data).points.bmi,expected);
 for(const bad of [{height:''},{weight:0},{sprint:0},{run:0},{strength:1.5},{strength:-1},{lung:-1},{jump:-1},{reach:NaN},{sex:'other'},{year:'5'}])assert.throws(()=>fitnessResult({...input,...bad},data));
 assert.doesNotThrow(()=>fitnessResult({...input,reach:-5},data));
});
test('计算器切换分组、示例、清空和错误显示；只读取评分表',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),previous={document:globalThis.document,fetch:globalThis.fetch},requests=[];
 globalThis.document=dom.window.document;globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>data}};
 try{
  const ui=createFitnessUI();document.querySelector('#root').innerHTML=await ui.view();ui.bind();
  const form=document.querySelector('form'),result=document.querySelector('#fitness-result');
  assert.equal(form.querySelectorAll('input[required]').length,8);assert.doesNotMatch(result.textContent,/100\.0/);
  for(const sex of ['male','female'])for(const year of ['12','34']){
   form.elements.sex.value=sex;form.elements.year.value=year;form.elements.sex.dispatchEvent(new dom.window.Event('change'));document.querySelector('#fit-example').click();
   assert.match(result.textContent,/100\.0/);assert.equal(result.querySelectorAll('tbody tr').length,7);
   assert.match(document.querySelector('#fit-run-label').textContent,sex==='male'?/1000米/:/800米/);
   assert.equal(document.querySelectorAll('#fitness-standards tbody tr').length,20);
  }
  form.elements.run.value='3:99';form.dispatchEvent(new dom.window.Event('input'));assert.match(result.textContent,/秒数须小于60/);
  form.reset();await new Promise(r=>queueMicrotask(r));assert.equal(form.elements.run.value,'');assert.match(result.textContent,/填完/);
  assert.deepEqual(requests,['/course-atlas/data/fitness.json']);
 }finally{Object.assign(globalThis,previous);dom.window.close()}
});
test('其他功能直接落到文件收集，参考资料独立，指南分页和旧详情链接保留',async()=>{
 const calls=[],guide={id:'old-guide',kind:'guide',title:'原指南',body:'原正文',username:'同学',version:1,attachments:[{name:'guide-202605.pdf'}]};
 const ui=createAtlasUI({api:async path=>{calls.push(path);return path.endsWith('old-guide')?{entry:guide}:{entries:[guide],more:true}},user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
 const root=await ui.view(['guides']);assert.match(root,/文件收集/);assert.equal(calls.length,0);assert.doesNotMatch(root,/经验汇编与分享/);assert.doesNotMatch(root,/#\/guides/);
 const references=await ui.view(['guides','references']);assert.equal(references,root);assert.match(references,/math-handbook-2024.pdf/);assert.match(references,/honors-2026.pdf/);assert.doesNotMatch(references,/guide-202605.pdf/);assert.equal(calls.length,0);
 const page=['guides','community'];page.query='page=2';const content=await ui.view(page);assert.match(calls.at(-1),/kind=guide&page=2/);assert.match(content,/#\/guides\/community\?sort=hot&page=3/);assert.match(content,/原正文/);assert.match(content,/guide-202605.pdf/);assert.match(content,/#\/discussion/);
 const detail=await ui.view(['guides','old-guide']);assert.match(detail,/原正文/);assert.match(detail,/#\/guides\/community/);
});
