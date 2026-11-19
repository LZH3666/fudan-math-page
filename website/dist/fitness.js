import {escapeHtml as e} from './tex.js';
import {fitnessResult} from './fitness-score.mjs';
const fields=['height','weight','lung','sprint','reach','jump','strength','run'];
const labelsFor=sex=>({bmi:'体重指数 BMI',lung:'肺活量',sprint:'50米跑',reach:'坐位体前屈',jump:'立定跳远',strength:sex==='male'?'引体向上':'1分钟仰卧起坐',run:sex==='male'?'1000米跑':'800米跑'});
const timeText=n=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
export function createFitnessUI(){
 let dataPromise,data;
 async function view(){
  data=await (dataPromise??=fetch('/course-atlas/data/fitness.json').then(r=>{if(!r.ok)throw Error('体测评分表暂不可用');return r.json()}).catch(err=>{dataPromise=null;throw err}));
  if(!Object.keys(data?.groups??{}).length)return '<h1>国家体测计算器</h1><p class="empty-state">体测评分表暂不可用。</p>';
  const input=(id,label,attrs='')=>'<label for="fit-'+id+'"><span'+(['strength','run'].includes(id)?' id="fit-'+id+'-label"':'')+'>'+label+'</span><input id="fit-'+id+'" name="'+id+'" '+attrs+' required></label>';
  return '<h1>国家体测计算器</h1><p class="atlas-page-lead">大学生组：按性别和年级计算七项标准分与两项附加分。</p><div class="fitness-layout"><div class="fitness-panel"><form id="fitness-form"><div class="fitness-fields"><label for="fit-sex">性别<select id="fit-sex" name="sex"><option value="male">男生</option><option value="female">女生</option></select></label><label for="fit-year">年级组<select id="fit-year" name="year"><option value="12">大一 / 大二</option><option value="34">大三 / 大四</option></select></label>'+input('height','身高（厘米）','type="number" min="0.1" step="any" placeholder="如170"')+input('weight','体重（千克）','type="number" min="0.1" step="any" placeholder="如60"')+input('lung','肺活量（毫升）','type="number" min="0" step="1" placeholder="如4000"')+input('sprint','50米跑（秒）','type="number" min="0.01" step="any" placeholder="如7.5"')+input('reach','坐位体前屈（厘米，可为负数）','type="number" step="any" placeholder="如15"')+input('jump','立定跳远（厘米）','type="number" min="0" step="any" placeholder="如230"')+input('strength','引体向上（次）','type="number" min="0" step="1" placeholder="整数次数"')+input('run','1000米跑（分:秒或整数秒）','type="text" placeholder="如3:17或197秒"')+'</div><div class="form-actions"><button type="submit" class="primary-button">计算</button><button type="button" class="outline-button" id="fit-example">填入本组满分档示例</button><button type="reset" class="outline-button">清空</button></div></form></div><div class="fitness-panel fitness-result-panel"><div id="fitness-result" aria-live="polite"><p class="fitness-placeholder">填完各项成绩后，这里显示总分、等级与单项得分。</p></div></div></div><details class="fitness-note-fold"><summary>计算规则与说明</summary><p class="fitness-note">按达到的最高列示档位试算，不作线性插值；低于最低档按0分试算。BMI保留一位小数后分档。长跑3:17表示3分17秒。力量和长跑各最多加10分。</p><p class="fitness-note">国家体测成绩与体育课程总评分别计算。<a href="https://fdty.fudan.edu.cn/b0/31/c29222a307249/page.htm" target="_blank" rel="noopener">查看体教部评分标准</a></p></details><details class="fitness-standards"><summary>查看本组评分表</summary><div id="fitness-standards"></div></details>';
 }
 function bind(){
  const form=document.querySelector('#fitness-form');if(!form)return;
  const result=document.querySelector('#fitness-result');
  const values=()=>Object.fromEntries(['sex','year',...fields].map(k=>[k,form.elements[k].value]));
  const calculate=()=>{
   if(fields.some(k=>!form.elements[k].value.trim())){result.textContent='填完各项成绩后显示结果。';return}
   try{
    const input=values(),r=fitnessResult(input,data),labels=labelsFor(input.sex);
    result.innerHTML='<p class="fitness-total">'+r.total.toFixed(1)+' <small>/ 120 · '+r.level+'</small></p><p>标准分 '+r.base.toFixed(1)+' ＋ 力量加分 '+r.strengthBonus+' ＋ 长跑加分 '+r.runBonus+'</p><p>BMI '+r.bmi.toFixed(1)+'，单项 '+r.points.bmi+' 分。</p><div class="atlas-table"><table><thead><tr><th>指标</th><th>单项分</th><th>权重</th><th>计入标准分</th></tr></thead><tbody>'+Object.entries(data.weights).map(([k,w])=>'<tr><td>'+labels[k]+'</td><td>'+r.points[k]+'</td><td>'+w+'%</td><td>'+(r.points[k]*w/100).toFixed(1)+'</td></tr>').join('')+'</tbody></table></div>';
   }catch(err){result.innerHTML='<p class="form-error" role="alert">'+e(err.message)+'</p>'}
  };
  const update=()=>{
   const sex=form.elements.sex.value,group=data.groups[sex+'_'+form.elements.year.value],labels=labelsFor(sex);
   document.querySelector('#fit-strength-label').textContent=labels.strength+'（次）';document.querySelector('#fit-run-label').textContent=labels.run+'（分:秒或整数秒）';
   document.querySelector('#fitness-standards').innerHTML='<div class="atlas-table"><table><thead><tr><th>单项分</th>'+['lung','sprint','reach','jump','strength','run'].map(k=>'<th>'+labels[k]+'</th>').join('')+'</tr></thead><tbody>'+group.rows.map(row=>'<tr><td>'+row.points+'</td>'+['lung','sprint','reach','jump','strength','run'].map(k=>'<td>'+(row[k]===null?'—':k==='run'?timeText(row[k]):row[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
   calculate();
  };
  form.onsubmit=ev=>{ev.preventDefault();calculate()};form.oninput=calculate;
  form.elements.sex.onchange=update;form.elements.year.onchange=update;
  form.onreset=()=>queueMicrotask(update);
  document.querySelector('#fit-example').onclick=()=>{const row=data.groups[form.elements.sex.value+'_'+form.elements.year.value].rows[0];form.elements.height.value=170;form.elements.weight.value=60;for(const k of ['lung','sprint','reach','jump','strength'])form.elements[k].value=row[k];form.elements.run.value=timeText(row.run);calculate()};
  update();
 }
 return {view,bind};
}
