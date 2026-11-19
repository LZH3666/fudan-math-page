import {createCatalogLoader} from './course-loader.mjs';
import {escapeHtml as e} from './tex.js';
import {discussionMarkdown} from './discussion-markdown.js';
import {contextFields,bindContextFields,scoreFields,scoreSection,importedReviews,teacherRatingTable} from './course-feedback.js';
import {courseOfferings,catalogCourses,catalogOfferings} from './course-model.mjs';
import {termLabel} from './course-rating.mjs';
// 学期降序：越新的学期越靠前；无法识别的学期排在最后且保持原相对次序。
export const termOrder=term=>{const match=String(term??'').match(/^(\d{4})(?:-\d{4})?(秋|寒假|春|暑假)$/);return match?Number(match[1])*10+{秋:1,寒假:2,春:3,暑假:4}[match[2]]:-1};
export const latestTermFirst=offers=>[...offers].sort((a,b)=>termOrder(b?.term)-termOrder(a?.term));
import {officialDocuments} from './official-documents.mjs';
import {createFitnessUI} from './fitness.js';
import {createGuideInteractions,shareResources} from './guide-interactions.js';
import {createCourseMatcher,searchTokens} from './course-search.mjs';
const base='/course-atlas/';
export const normalizedCourseName=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// Only identical names are linked automatically: I/II, H and old/new codes stay distinct.
export function resourceMatches(g,courses){return courses.filter(c=>normalizedCourseName(c.title)===normalizedCourseName(g.name))}
export const atlasLink=id=>'#/reviews/'+encodeURIComponent(id);
const link=(label,href)=>'<a href="'+e(href)+'">'+e(label)+'</a>';
const asset=href=>{const value=String(href??'');return /^(?:assets|syllabi)\/[a-zA-Z0-9_./-]+(?:#page=\d+)?$/.test(value)&&!value.includes('..')?base+value:''};
const officialSyllabus=href=>/^https:\/\/fdjwgl\.fudan\.edu\.cn\/student\/for-all\/lesson-search\/teachingSyllabusInfo\/\d+$/.test(String(href||''))?href:'';
function ownScore(g,rows,offeringId,term,teacher=''){
 if(!term)return;
 if(!offeringId){if(courseOfferings(g).some(o=>o.term===term))return;const manual=rows.filter(r=>!r.offering_id&&r.term===term&&r.teacher===String(teacher).trim());return manual.length===1?manual[0]:undefined;}
 const exact=rows.find(r=>String(r.offering_id||'')===String(offeringId)&&r.term===term);if(exact)return exact;
 const offerings=courseOfferings(g),selected=offerings.find(o=>String(o.id)===String(offeringId)&&o.term===term);if(!selected)return;
 const legacy=rows.filter(r=>!r.offering_id&&r.term===term&&(selected.teachers||[]).join('、')===r.teacher);return legacy.length===1?legacy[0]:undefined;
}
export function createAtlasUI({api,user,courses,modal,closeModal,refresh,markDirty}){
 const fitnessUI=createFitnessUI();
 let records=[],currentCourse=null,query='',term='all',category='all',department='all',page=0,ratingsOnly=false,viewVersion=0,scores={mine:[]},scoreFilter={teacher:'',term:''},scoreCourse='';
 const guideUI=createGuideInteractions({api,user,markdown:body=>discussionMarkdown(body,globalThis.katex),modal,closeModal,markDirty,records:()=>records});
 const loader=createCatalogLoader(),data=()=>loader.index();
 const listTerms=(g,d)=>g.catalog_terms||catalogOfferings(g,d).map(o=>o.term);
 const btn=(label,action,id='')=>'<button type="button" class="outline-button" data-atlas="'+action+'" data-id="'+e(id)+'">'+label+'</button>';
 const isAdmin=()=>user()?.canEdit&&user()?.role==='admin';
 const markdown=body=>discussionMarkdown(body,globalThis.katex);
 const paging=(route,n,more)=>'<nav class="form-actions" aria-label="内容分页">'+(n>1?link('上一页',route+'?page='+(n-1)):'')+(more?link('下一页',route+'?page='+(n+1)):'')+'</nav>';
 function entry(r,compact=false){
  const guide=r.kind==='guide',offering=currentCourse&&r.offering_id?courseOfferings(currentCourse).find(o=>String(o.id)===String(r.offering_id)):null;
  const redundant=guide&&(r.attachments||[]).some(f=>f.name.replace(/\.pdf$/i,'')===r.title)&&r.body.replace(/\s+/g,'')===('经验汇编：'+r.title+'（PDF）。原PDF见附件。').replace(/\s+/g,'');
  const content=redundant?'':compact&&guide&&r.body.length>300?markdown(r.body.split(/\n\s*\n/)[0].slice(0,300))+link('阅读全文','#/guides/'+encodeURIComponent(r.id)):markdown(r.body);
  const management='<div class="form-actions">'+(user()?.canEdit&&!r.hidden&&r.user_id===user().id?btn('编辑','edit',r.id):'')+btn('历史版本','history',r.id)+(isAdmin()?btn(r.hidden?'恢复':'隐藏','moderate',r.id):'')+'</div>';
  return '<article class="atlas-entry'+(guide?' guide-post':'')+'" id="share-'+e(r.id)+'">'+(guide&&r.title!=='选课经验分享'?'<h3>'+link(r.title,'#/guides/'+encodeURIComponent(r.id))+'</h3>':'')+'<small>'+e([r.username,offering?.code,r.teacher,termLabel(r.term),guide&&r.updated?new Date(r.updated).toLocaleString('zh-CN',{hour12:false}):'',r.hidden?'已隐藏':''].filter(Boolean).join(' · '))+'</small>'+(r.kind==='review'&&r.title?'<h3 class="atlas-review-title">'+e(r.title)+'</h3>':'')+(content?'<div class="forum-markdown">'+content+'</div>':'')+(guide?guideUI.render(r):management)+'</article>';
 }
 function shareEntry(){return user()?.canEdit?'<button type="button" class="primary" data-atlas="start-share" aria-controls="guide-share-form" aria-expanded="false">参与分享</button>':'<button type="button" data-action="account" class="primary">参与分享</button>'}
 function shareForm(){return user()?.canEdit?'<form id="guide-share-form" hidden><p class="guide-publish-help">正文、网页链接和附件会一起发布为同一条分享，至少填写其中一项。选中文件只会上传暂存，点击“发表分享”后才公开。</p><label>标题（选填）<input name="title" maxlength="120" placeholder="分享标题"></label><label for="guide-share-body" id="guide-share-label">经验正文（选填）</label><textarea id="guide-share-body" name="body" maxlength="20000" rows="5" placeholder="可以写先修课顺序、课程搭配或跨专业选课经验，并注明适用年级或学年。"></textarea>'+guideUI.editorFields()+'<details><summary>预览</summary><div id="guide-share-preview" class="forum-markdown"></div></details><div class="form-actions"><button type="submit" class="outline-button">发表分享</button><button type="button" class="outline-button" data-atlas="cancel-share">取消</button></div><p class="form-error" role="alert"></p></form>':''}
 function editShare(target,show=true){
  const form=document.querySelector('#guide-share-form');if(!form||form.dataset.pending==='true')return;
  if(form.dataset.dirty==='true'&&!confirm('有尚未保存的分享，确定放弃吗？'))return;
  form.shareTarget=target;form.elements.title.value=target?.title||'';form.elements.body.value=target?.body||'';form.elements.links.value=(target?.links||[]).join('\n');guideUI.setEditorFiles(form,target?.attachments||[]);form.dataset.dirty='false';markDirty(false);guideUI.syncDirty();
  form.querySelector('#guide-share-label').textContent=target?'编辑自己的分享':'经验正文（选填）';form.querySelector('[type=submit]').textContent=target?'保存修改':'发表分享';
  form.querySelector('.form-error').textContent='';form.querySelector('[data-guide-upload-status]').textContent='';form.querySelector('details').open=false;form.querySelector('#guide-share-preview').innerHTML=markdown(form.elements.body.value);form.hidden=!show;
  const trigger=document.querySelector('[data-atlas=start-share]');trigger?.setAttribute('aria-expanded',String(show));if(show)form.elements.body.focus();else trigger?.focus();
 }
 const hiddenQuery=()=>isAdmin()?'&hidden=1':'';
 async function searchLinks(q){try{if(!searchTokens(q).length)return '';const d=await data();return catalogCourses(d).filter(createCourseMatcher(q)).slice(0,50).map(g=>'<li>'+link(g.name,atlasLink(g.id))+'<span>'+e(['课程评价',g.department,g.code].filter(Boolean).join(' · '))+'</span></li>').join('')}catch{return ''}}
 const reviewStatsFor=g=>g.review_stats||{count:0,average:null};
 function list(d){
  const matches=createCourseMatcher(query),rows=catalogCourses(d).filter(g=>matches(g)&&(term==='all'||listTerms(g,d).includes(term))&&(department==='all'||g.department===department)&&(category==='all'||g.categories.includes(category))&&(!ratingsOnly||reviewStatsFor(g,d).count>0)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||String(a.department||'').localeCompare(String(b.department||''),'zh-CN')||a.code.localeCompare(b.code));
  page=Math.max(0,Math.min(page,Math.ceil(rows.length/30)-1));
  return '<div class="atlas-results" role="status">共 '+rows.length+(ratingsOnly?' 门有课评的课程':' 门课程')+'</div><ul class="atlas-course-list">'+rows.slice(page*30,(page+1)*30).map(g=>{const stats=reviewStatsFor(g,d);return '<li>'+link(g.name,atlasLink(g.id))+'<small>'+e([g.department,(g.codes||[g.code]).join('、'),listTerms(g,d).map(termLabel).join('、')].filter(Boolean).join(' · '))+'</small><span>'+e(g.teachers.join('、'))+'</span><span class="atlas-course-stat">'+(stats.count?'课评 '+stats.count+' 条'+(stats.average!==null?' · 均分 '+stats.average.toFixed(2):''):'暂无课评')+'</span></li>'}).join('')+'</ul>'+(rows.length?'':'<p>没有符合条件的课程。</p>')+'<nav class="form-actions" aria-label="课程分页">'+(page?btn('上一页','prev'):'')+'<span>第 '+(page+1)+' / '+Math.max(1,Math.ceil(rows.length/30))+' 页</span>'+((page+1)*30<rows.length?btn('下一页','next'):'')+'</nav>';
 }
 const documentGroups=[['学校（教务处）','学校'],['数学科学学院','数学科学学院'],['体育教学部','体育']];
 const versionText=value=>{const text=String(value??'').trim();if(!text)return '';if(/^\d{4}-\d{2}-\d{2}$/.test(text))return '发布 '+text;if(/^\d{4}级$/.test(text))return '适用 '+text;return text};
 function officialDetail(d){
  const local=String(d.href||'').startsWith('/'),meta=[versionText(d.version),local?'本站快照':'官方网页'].filter(Boolean).map(e).join(' · ');
  const origin=d.source?link('官方来源',d.source):d.provenance?link('快照出处',d.provenance):'';
  return link(d.title,d.href)+' <small>'+meta+'</small>'+(origin?' · '+origin:'')
 }
 // 文件多的一组再按用途分栏，避免 27 条培养方案里夹着通知。
 const subOrder=['培养方案','通知与规定','学习指导'];
 const subOf=title=>/培养方案|项目方案|方案（/.test(title)?'培养方案':/手册|指导|指南/.test(title)?'学习指导':'通知与规定';
 function documentList(items){
  const list=rows=>'<ul class="atlas-guide-list">'+rows.map(d=>'<li>'+officialDetail(d)+'</li>').join('')+'</ul>';
  if(items.length<12)return list(items);
  const buckets=new Map(subOrder.map(k=>[k,[]]));
  for(const d of items)buckets.get(subOf(d.title)).push(d);
  return subOrder.filter(k=>buckets.get(k).length).map(k=>'<h3 class="atlas-subheading">'+e(k)+'</h3>'+list(buckets.get(k))).join('')
 }
 // “其他功能”没有中间层：入口直接落到文件收集。
 function referencesPage(){
  return '<h1>文件收集</h1><p class="atlas-page-lead">学校、数学科学学院与体育教学部发布的官方文件，按发布单位分组。</p>'+documentGroups.map(([title,group])=>'<section><h2>'+e(title)+'</h2>'+documentList(officialDocuments.filter(d=>d.group===group))+'</section>').join('')
 }
 async function view(parts){
  const activeVersion=++viewVersion;records=[];currentCourse=null;
  if(parts[0]==='guides'){
   if(parts[1]==='fitness')return await fitnessUI.view();
   if(parts[1]==='references')return referencesPage();
   if(!parts[1]&&!new URLSearchParams(parts.query).has('page'))return referencesPage();
   if(parts[1]&&parts[1]!=='community'){const out=await api('/atlas/entries/'+encodeURIComponent(parts[1]));if(out.entry.kind!=='guide')throw Error('分享不存在');if(activeVersion!==viewVersion)return '';records=[out.entry];return link('返回经验汇编与分享','#/guides/community')+'<div class="form-actions">'+shareEntry()+'</div>'+shareForm()+entry(out.entry)}
   const queryParams=new URLSearchParams(parts.query),n=Number(queryParams.get('page')||1),sort=queryParams.get('sort')||'hot',out=await api('/atlas/entries?kind=guide&page='+n+'&sort='+encodeURIComponent(sort)+hiddenQuery());if(activeVersion!==viewVersion)return '';records=out.entries;
   return '<div class="page-heading"><h1>经验汇编与分享</h1>'+shareEntry()+'</div><p class="guide-description">分享先修课顺序、方向规划、课程搭配和跨专业选课经验。具体课程与教师的修读体验请写在'+link('课程评价','#/reviews')+'。大家有问题可以前往'+link('讨论室','#/discussion')+'交流。</p>'+shareForm()+(records.length?'<form id="guide-sort" class="guide-sort"><label>排序 <select name="sort"><option value="hot"'+(sort==='hot'?' selected':'')+'>热度排序</option><option value="time"'+(sort==='time'?' selected':'')+'>时间排序（最新在前）</option></select></label><button type="submit" class="outline-button">应用</button></form>':'')+'<div id="guide-shares">'+records.map(r=>entry(r,true)).join('')+'</div>'+(records.length?'':'<div class="empty-state"><p>还没有人分享经验。</p></div>')+paging('#/guides/community',n,out.more).replace(/\?page=(\d+)/g,'?sort='+encodeURIComponent(sort)+'&page=$1');
  }
  const d=await (parts[1]?loader.course(parts[1]):data());if(activeVersion!==viewVersion)return '';
  if(!parts[1]){
   const cats=[...new Set(catalogCourses(d).flatMap(g=>g.categories))].sort((a,b)=>a.localeCompare(b,'zh-CN')),departments=[...new Set(catalogCourses(d).map(g=>g.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')),terms=[...new Set(catalogCourses(d).flatMap(g=>listTerms(g,d)))].sort().reverse();
   return '<h1>课程评价</h1><div id="atlas-search"></div><form id="atlas-filter" class="atlas-filter"><label>课程、教师或课程代码<input name="query" type="search" value="'+e(query)+'" placeholder="课程、教师或首字母，空格分隔"></label><label>开课院系<select name="department"><option value="all">全部院系</option>'+departments.map(c=>'<option value="'+e(c)+'"'+(department===c?' selected':'')+'>'+e(c)+'</option>').join('')+'</select></label><label>学期<select name="term">'+[['all','全部学期'],...terms.map(t=>[t,termLabel(t)])].map(([v,t])=>'<option value="'+e(v)+'"'+(term===v?' selected':'')+'>'+e(t)+'</option>').join('')+'</select></label><details><summary>更多筛选</summary><label>课程类别<select name="category"><option value="all">全部类别</option>'+cats.map(c=>'<option'+(category===c?' selected':'')+'>'+e(c)+'</option>').join('')+'</select></label></details><label class="atlas-toggle"><input type="checkbox" name="ratingsOnly"'+(ratingsOnly?' checked':'')+'>只看有课评的课程</label><button class="outline-button" type="submit">查找</button></form><div id="atlas-list">'+list(d)+'</div>';
  }
  const g=d.scope.find(g=>g.id===parts[1]||(g.legacy_ids||[]).includes(parts[1]));if(!g)throw Error('课程不存在');currentCourse=g;
  const n=Number(new URLSearchParams(parts.query).get('page')||1),out=await api('/atlas/entries?kind=review&courseId='+encodeURIComponent(g.id)+'&page='+n+hiddenQuery());if(activeVersion!==viewVersion)return '';records=out.entries;
  const materials=resourceMatches(g,courses()),syllabi=new Map((d.syllabi||[]).map(s=>[s.lesson_id,s]));
  const offers=latestTermFirst(catalogOfferings(g,d)).map(o=>{const s=syllabi.get(o.syllabus),official=officialSyllabus(o.source);return '<tr><td>'+e(termLabel(o.term))+'</td><td>'+e(o.code||'')+'<small>'+e(o.class_type||'')+'</small></td><td>'+e(o.teachers.join('、'))+'</td><td>'+e(o.credits??'')+'</td><td>'+(s?link('查看大纲',asset(s.href)):official?link('官方大纲',official):'暂无大纲')+'</td></tr>'}).join('');
  if(scoreCourse!==g.id){scoreFilter={teacher:'',term:''};scoreCourse=g.id}
  const ratingData=await api('/atlas/ratings?'+new URLSearchParams({courseId:g.id,...scoreFilter}));if(activeVersion!==viewVersion)return '';scores=ratingData;
  const imported=importedReviews(g,d,d.full_reviews||[]);
  return link('返回课程评价','#/reviews')+'<div class="page-heading"><h1>'+e(g.name)+'</h1><div class="actions">'+materials.map(c=>link('查看课程资料','#/course/'+c.id)).join('　')+'</div></div><p class="atlas-course-meta">'+e([g.department,(g.codes||[g.code]).join('、'),g.categories.join('、')].filter(Boolean).join(' · '))+(reviewStatsFor(g,d).count?' · 课评 '+reviewStatsFor(g,d).count+' 条':'')+'</p>'+'<details id="atlas-teacher-ratings" class="atlas-course-details"><summary>教师评分</summary>'+teacherRatingTable(g,scores.teacherGroups||[])+'</details><details id="atlas-offerings" class="atlas-course-details"><summary>开课信息</summary><div class="atlas-table"><table><thead><tr><th>学期</th><th>教学班</th><th>教师</th><th>学分</th><th>大纲</th></tr></thead><tbody>'+offers+'</tbody></table></div></details>'+'<div id="atlas-ratings">'+scoreSection(g,scores,user()?.canEdit,isAdmin(),scoreFilter)+'</div><section id="atlas-experiences"><div class="section-heading"><h2>同学评价'+(reviewStatsFor(g,d).count?'<small class="atlas-count">'+reviewStatsFor(g,d).count+' 条</small>':'')+'</h2>'+(user()?.canEdit?btn('写课程评价','new-review'):'<button data-action="account" class="outline-button">登录后写课程评价</button>')+'</div>'+records.map(entry).join('')+paging(atlasLink(g.id),n,out.more)+imported+(!records.length&&!imported?'<div class="empty-state"><p>本课程还没有同学评价。</p><p>如果你上过这门课，欢迎写下第一条：给分、作业量、考试形式、是否推荐。</p></div>':'')+'</section>';

 }
 function bind(){
  fitnessUI.bind();
  const sortForm=document.querySelector('#guide-sort');if(sortForm)sortForm.onsubmit=ev=>{ev.preventDefault();location.hash='/guides/community?sort='+encodeURIComponent(sortForm.elements.sort.value)};
  const share=document.querySelector('#guide-share-form');if(share){guideUI.bindEditor(share);
   share.oninput=()=>{share.dataset.dirty='true';markDirty(true);share.querySelector('#guide-share-preview').innerHTML=markdown(share.elements.body.value)};
   share.onsubmit=async ev=>{ev.preventDefault();if(share.dataset.pending==='true'||!user()?.canEdit)return;const target=share.shareTarget,content=share.elements.body.value;const links=share.elements.links.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!content.trim()&&!links.length&&!share.shareFiles?.length){share.querySelector('.form-error').textContent='请填写正文或添加附件、链接';return}if(!guideUI.canRefresh(share))return;const controls=[...share.querySelectorAll('input,textarea,button')];share.dataset.pending='true';controls.forEach(c=>c.disabled=true);let saved=false;
    try{await api('/atlas/entries'+(target?'/'+target.id:''),target?'PUT':'POST',{kind:'guide',title:share.elements.title.value.trim()||target?.title||'经验分享',body:content,attachments:(share.shareFiles||[]).map(f=>f.id),links,...(target?{version:target.version}:{})});saved=true;markDirty(false);share.dataset.dirty='false';share.elements.body.value='';share.shareTarget=null;await refresh()}catch(err){share.querySelector('.form-error').textContent=(saved?'分享已保存，但页面刷新失败：':'')+err.message}finally{share.dataset.pending='false';controls.forEach(c=>c.disabled=false)}
   };
  }
  const form=document.querySelector('#atlas-filter');if(form)form.onsubmit=async ev=>{ev.preventDefault();query=form.elements.query.value;term=form.elements.term.value;department=form.elements.department.value;category=form.elements.category.value;ratingsOnly=Boolean(form.elements.ratingsOnly&&form.elements.ratingsOnly.checked);page=0;document.querySelector('#atlas-list').innerHTML=list(await data())};
  const filter=document.querySelector('#rating-filter');if(filter)filter.onsubmit=async ev=>{ev.preventDefault();scoreFilter={teacher:filter.elements.teacher.value,term:filter.elements.term.value};await refresh()};
 }
 function compose(target,kind){
  if(!user()?.canEdit)return;
  const reviewCourse=currentCourse,reviewCourseId=target?.course_id||reviewCourse?.id;
  const isReview=(target?.kind||kind)==='review';
  modal(target?'编辑'+(isReview?'评价':'指南'):isReview?'写课程评价':'新增指南','<form id="atlas-compose">'+(isReview?contextFields(reviewCourse,target||{}):'<label>标题<input name="title" required maxlength="120" value="'+e(target?.title||'')+'"></label>')+'<label>正文（支持Markdown和数学公式）<textarea name="body" required maxlength="20000" rows="12">'+e(target?.body||'')+'</textarea></label><details><summary>预览</summary><div id="atlas-preview" class="forum-markdown"></div></details><button type="submit" class="primary">保存并发布</button></form>',async f=>{
   const element=document.querySelector('#atlas-compose'),controls=[...element.querySelectorAll('input,select,textarea,button')];element.dataset.pending='true';controls.forEach(c=>c.disabled=true);
   let result;try{result=await api('/atlas/entries'+(target?'/'+target.id:''),target?'PUT':'POST',{...Object.fromEntries(f),...(isReview?{title:target?.title||'课程评价'}:{}),...(target?{version:target.version}:{kind,courseId:reviewCourseId})})}finally{element.dataset.pending='false';controls.forEach(c=>c.disabled=false)}
   markDirty(false);closeModal();const hash=result.entry.kind==='guide'?'#/guides/'+result.entry.id:atlasLink(result.entry.course_id);if(location.hash===hash)await refresh();else location.hash=hash;
  });
  const form=document.querySelector('#atlas-compose');if(isReview)bindContextFields(reviewCourse,form,target||{});form.oninput=()=>{markDirty(true);document.querySelector('#atlas-preview').innerHTML=markdown(form.elements.body.value)};document.querySelector('#atlas-preview').innerHTML=markdown(form.elements.body.value);
 }
 async function composeScore(){
  if(!user()?.canEdit||!currentCourse)return;const g=currentCourse,out=await api('/atlas/ratings?courseId='+encodeURIComponent(g.id));if(currentCourse?.id!==g.id)return;
  modal('课程评分','<form id="atlas-compose">'+contextFields(g,scoreFilter)+scoreFields()+'<button type="submit" class="primary">保存评分</button></form>',async f=>{
   const b=Object.fromEntries(f),old=ownScore(g,out.mine||[],b.offeringId,b.term,b.teacher),element=document.querySelector('#atlas-compose'),controls=[...element.querySelectorAll('input,select,button')];element.dataset.pending='true';controls.forEach(c=>c.disabled=true);
   try{await api('/atlas/ratings','POST',{...b,courseId:g.id,version:old?.version||0,...Object.fromEntries(['grading','difficulty','workload','assessment','overall'].map(k=>[k,Number(b[k])]))})}finally{element.dataset.pending='false';controls.forEach(c=>c.disabled=false)}
   markDirty(false);closeModal();await refresh();
  });
  const form=document.querySelector('#atlas-compose');bindContextFields(g,form,scoreFilter);const fill=()=>{const r=ownScore(g,out.mine||[],form.elements.offeringId.value,form.elements.term.value,form.elements.teacher.value);for(const k of ['grading','difficulty','workload','assessment','overall'])form.elements[k].value=r?.[k]||''};fill();
  form.oninput=()=>markDirty(true);form.onchange=ev=>{markDirty(true);if(['offeringId','term','teacher'].includes(ev.target.name))fill()};
 }
 async function action(ev){
  if(await guideUI.action(ev))return;
  const b=ev.target.closest('[data-atlas]');if(!b)return;
  const r=records.find(r=>r.id===b.dataset.id),a=b.dataset.atlas;
  if(a==='moderate'){if(!guideUI.canRefresh())return;
   const share=document.querySelector('#guide-share-form');if(share?.dataset.pending==='true')return;
   if(share?.dataset.dirty==='true'){if(!confirm('有尚未发表的分享，确定放弃后继续管理吗？'))return;share.dataset.dirty='false';markDirty(false);editShare(null,false)}
  }
  if(a==='new-review'||a==='new-guide')compose(null,a==='new-review'?'review':'guide');
  else if(a==='rate')await composeScore();
  else if(a==='rating-moderate'){const score=scores.records?.find(r=>r.id===b.dataset.id);if(!score)return;modal(score.hidden?'恢复评分':'隐藏评分','<form><label>原因<input name="reason" required maxlength="300"></label><button type="submit">确认</button></form>',async f=>{await api('/atlas/ratings/'+score.id+'/moderate','POST',{hidden:!score.hidden,version:score.version,reason:f.get('reason')});closeModal();await refresh()})}
  else if(a==='edit'&&r){if(r.kind==='guide'){if(user()?.canEdit&&r.user_id===user().id&&!r.hidden)editShare(r)}else compose(r)}
  else if(a==='start-share'&&user()?.canEdit){const share=document.querySelector('#guide-share-form');if(share&&!share.hidden)share.elements.body.focus();else editShare(null)}
  else if(a==='cancel-share')editShare(null,false);
  else if(a==='prev'||a==='next'){page+=a==='prev'?-1:1;document.querySelector('#atlas-list').innerHTML=list(await data());document.querySelector('#atlas-filter').scrollIntoView({block:'start'})}
  else if(a==='history'&&r){let n=1;const show=async()=>{const out=await api('/atlas/entries/'+r.id+'/history?page='+n);modal('历史版本',out.history.map(h=>{const s=JSON.parse(h.snapshot);return '<section class="atlas-entry"><b>版本 '+h.version+'</b> · '+e(h.username)+'<h3>'+e(s.title)+'</h3><pre>'+e(s.body)+'</pre>'+shareResources(s)+'</section>'}).join('')+'<div class="form-actions">'+(n>1?btn('上一页','history-prev'):'')+(out.more?btn('下一页','history-next'):'')+'</div>');document.querySelectorAll('[data-atlas^="history-"]').forEach(el=>el.onclick=event=>{event.stopPropagation();n+=el.dataset.atlas==='history-prev'?-1:1;show().catch(err=>modal('操作未完成','<p>'+e(err.message)+'</p>'))})};await show()}
  else if(a==='moderate'&&r)modal(r.hidden?'恢复内容':'隐藏内容','<form><label>原因<input name="reason" required maxlength="300"></label><button type="submit">确认</button></form>',async f=>{if(document.querySelector('#guide-share-form')?.dataset.pending==='true')throw Error('分享正在保存，请稍后再管理');await api('/atlas/entries/'+r.id+'/moderate','POST',{hidden:!r.hidden,version:r.version,reason:f.get('reason')});closeModal();await refresh()});
 }
 return {view,bind,action,searchLinks};
}
