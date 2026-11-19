import {escapeHtml as e} from './tex.js';
import {academicTerms,termLabel,ratingDimensions,teacherKey} from './course-rating.mjs';
import {courseOfferings} from './course-model.mjs';
export const teachersFor=g=>[...new Set([...(g.teachers||[]),...(g.teacher_evidence||[]).map(t=>t.teacher)])].filter(Boolean);
const offeringLabel=o=>[o.code,(o.teachers||[]).join('、')].filter(Boolean).join(' · ');
const offeringValue=(g,value)=>{
 const offers=courseOfferings(g).filter(o=>o.term===value.term),explicit=value.offeringId||value.offering_id;
 if(explicit)return offers.some(o=>String(o.id)===String(explicit))?String(explicit):'';
 const matches=offers.filter(o=>value.teacher&&((o.teachers||[]).join('、')===value.teacher||(o.teachers||[]).includes(value.teacher)));
 return matches.length===1?String(matches[0].id):'';
};
function offeringOptions(g,term,selected=''){
 const offers=courseOfferings(g).filter(o=>o.term===term);
 return '<option value="">'+(!term?'请先选择修读学期':offers.length?'请选择教学班':'该学期暂无教学班信息')+'</option>'+offers.map(o=>'<option value="'+e(o.id)+'"'+(String(o.id)===String(selected)?' selected':'')+'>'+e(offeringLabel(o)||o.id)+'</option>').join('');
}
export function contextFields(g,value={}){return '<div class="atlas-form-row"><label>修读学期<select name="term" required><option value="">请选择</option>'+academicTerms().map(t=>'<option value="'+t+'"'+(t===value.term?' selected':'')+'>'+e(termLabel(t))+'</option>').join('')+'</select></label><label data-class-context>具体教学班<select name="offeringId" required>'+offeringOptions(g,value.term,offeringValue(g,value))+'</select></label><label data-manual-teacher hidden>任课教师（选填）<input name="teacher" maxlength="100" value="'+e(value.teacher||'')+'" placeholder="可填写当时的任课教师"></label></div><p data-missing-class-note hidden>该学期暂未收录教学班信息，仍可评分和写评价；任课教师可选填。</p>'}
export function bindContextFields(g,form,value={}){
 const term=form.elements.term,offering=form.elements.offeringId,teacher=form.elements.teacher;
 const update=selected=>{const missing=!!term.value&&!courseOfferings(g).some(o=>o.term===term.value);offering.innerHTML=offeringOptions(g,term.value,selected);offering.required=!missing;offering.disabled=missing;form.querySelector('[data-class-context]').hidden=missing;teacher.disabled=!missing;form.querySelector('[data-manual-teacher]').hidden=!missing;form.querySelector('[data-missing-class-note]').hidden=!missing;};
 update(offeringValue(g,{...value,term:term.value}));
 term.addEventListener('change',()=>{teacher.value='';update('')});
}
export function scoreFields(){return ratingDimensions.map(d=>'<label>'+d.label+'<select name="'+d.key+'" required><option value="">请选择</option>'+d.levels.map((label,i)=>'<option value="'+(i+1)+'">'+label+'</option>').join('')+'</select></label>').join('')}
export function teacherRatingTable(g,summaries=[]){
 const offers=courseOfferings(g),members=new Set(offers.flatMap(o=>o.teachers||[]).map(teacherKey));
 const names=[...offers.map(o=>(o.teachers||[]).join('、')),...(g.teacher_evidence||[]).map(t=>t.teacher).filter(t=>!members.has(teacherKey(t))),...(g.teachers||[]).filter(t=>!members.has(teacherKey(t)))];
 const rows=new Map(names.filter(Boolean).map(name=>[teacherKey(name),{teacher:teacherKey(name),count:0,total:0}]));
 for(const group of summaries){const key=teacherKey(group.teacher);if(!rows.has(key))rows.set(key,{teacher:key,count:0,total:0});const row=rows.get(key),count=Number(group.overall?.count||0),average=group.overall?.average;if(count>0&&Number.isFinite(average)){row.count+=count;row.total+=count*average}}
 if(!rows.size)rows.set('',{teacher:'',count:0,total:0});
 return '<div class="atlas-table teacher-rating-table"><table aria-label="教师评分"><thead><tr><th scope="col">任课教师</th><th scope="col">总体评分</th><th scope="col">评分数</th></tr></thead><tbody>'+[...rows.values()].sort((a,b)=>a.teacher.localeCompare(b.teacher,'zh-CN')).map(row=>'<tr><th scope="row">'+e(row.teacher||'教师未注明')+'</th><td>'+(row.count?'<strong>'+(row.total/row.count).toFixed(2)+' / 5</strong>':'<span class="rating-unavailable">暂无</span>')+'</td><td>'+row.count+'</td></tr>').join('')+'</tbody></table></div>';
}
export function overallRatingLine(summary){if(Array.isArray(summary))return teacherRatingTable({},summary);const count=Number(summary?.count||0),average=summary?.average;return '<p class="atlas-overall-rating">总体评价平均分：'+(count>0&&Number.isFinite(average)?'<strong>'+average.toFixed(2)+' / 5</strong>（'+count+' 份评分）':'暂无评分')+'</p>'}
export function scoreSection(g,out,canEdit,admin,selection={}){
 const dimensions=out.dimensions||ratingDimensions.map(d=>({...d,counts:[0,0,0,0,0]}));
 return '<section id="course-scores"><div class="section-heading"><h2>课程评分</h2>'+(canEdit?'<button class="outline-button" data-atlas="rate">评分 / 修改评分</button>':'<button class="outline-button" data-action="account">登录后评分</button>')+'</div><form id="rating-filter" class="atlas-filter"><label>任课教师<select name="teacher"><option value="">全部教师</option>'+[...new Set([...teachersFor(g),...(out.teachers||[])])].map(t=>'<option'+(selection.teacher===t?' selected':'')+'>'+e(t)+'</option>').join('')+'</select></label><label>修读学期<select name="term"><option value="">全部学期</option>'+academicTerms().map(t=>'<option value="'+t+'"'+(selection.term===t?' selected':'')+'>'+e(termLabel(t))+'</option>').join('')+'</select></label><button class="outline-button" type="submit">查看</button></form>'+(out.groups||[]).map(group=>'<h3>'+e(group.teacher||'教师未注明')+'</h3><p>'+Number(group.count)+' 份评分</p><div class="atlas-table"><table class="rating-summary"><thead><tr><th>维度</th><th colspan="5">各档评分数</th></tr></thead><tbody>'+group.dimensions.map(d=>'<tr><th scope="row">'+e(d.label)+'</th>'+d.levels.map((label,i)=>'<td>'+e(label)+'<br><b>'+Number(d.counts[i]||0)+'</b></td>').join('')+'</tr>').join('')+'</tbody></table></div>').join('')+''+(admin&&out.records?.length?'<details><summary>管理评分</summary>'+out.records.map(r=>'<div class="atlas-entry"><p>'+e(r.username+' · '+r.teacher+' · '+termLabel(r.term))+'</p><button class="outline-button" data-atlas="rating-moderate" data-id="'+e(r.id)+'">'+(r.hidden?'恢复':'隐藏')+'</button></div>').join('')+'</details>':'')+'</section>';
}
export function legacyTerm(r){if(!Number.isInteger(r.year))return '';const labels={1:'秋',2:'寒假',3:'春',4:'暑假'};return labels[r.semester]?r.year+'-'+(r.year+1)+' '+labels[r.semester]:''}
export function importedReviewRows(g,d,full=[]){
 const refs=[...new Set([...(g.direct_review_ids||[]),...(g.teacher_evidence||[]).flatMap(t=>t.direct_review_ids||[])])],all=new Map(d.reviews.map(r=>[r.id,r])),groups=new Set([...(g.source_group_ids||[]),...refs.map(id=>all.get(id)?.group_id).filter(Boolean)]),completeGroups=new Set(d.full_review_groups||[]);
 const complete=new Map(full.filter(r=>groups.has(r.group_id)).map(r=>[r.id,r]));
 const ids=[...new Set([...refs,...complete.keys()])];
 return ids.map(id=>{const old=all.get(id),value=complete.get(id);if(!value&&completeGroups.has(old?.group_id))return null;return value||old}).filter(Boolean);
}
export function importedReviews(g,d,full=[]){
 return importedReviewRows(g,d,full).map(r=>'<article class="atlas-entry atlas-danxi-review" data-source-id="'+e(r.id)+'"><small><span class="atlas-review-source">来自旦夕</span>'+e([r.teacher,legacyTerm(r)].filter(Boolean).join(' · '))+'</small>'+(r.title?'<h3 class="atlas-review-title">'+e(r.title)+'</h3>':'')+'<p class="atlas-source-text">'+e(r.content)+'</p></article>').join('');
}
