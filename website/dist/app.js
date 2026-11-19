import {diffView} from './diff-view.js';
import {renderTex,escapeHtml as e,safeHref} from './tex.js';
import {renderPDF,releasePDFs,renderEmbeddedPDFs} from './pdf.js';
import {exportSource as sourceWithDependencies} from './source-export.js';
import {createDiscussionUI} from './discussion.js';
import {createAtlasUI} from './course-atlas.js';
import {createTitleMatcher} from './course-search.mjs';
import {siteNavigation,primarySection} from './site-navigation.mjs';
import {hasVisibleReaderContent} from './reader-content.mjs';
import {courseCollections,professionalSubjects,isCourseCollectionSubject,collectionForSubject,universityMathSubjectId,resolveMathBRoute,hideExamContents} from './catalog.mjs';
const $=s=>document.querySelector(s);
let state={subjects:[],courses:[],user:null},context={},renderId=0,dirty=false,lastHash=location.hash||'#/',skipHash=false,previewTimer;
let forum,atlas;
async function api(path,method='GET',body){
 const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':state.user?.csrf||''},body:method==='GET'?undefined:JSON.stringify(body??{})});
 const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error||'请求失败'),{status:r.status});return value;
}
const button=(label,action,extra='')=>'<button type="button" class="outline-button" data-action="'+action+'" '+extra+'>'+e(label)+'</button>';
const link=(text,path)=>'<a href="#'+path+'">'+e(text)+'</a>';
const subjectName=id=>state.subjects.find(s=>s.id===id)?.title||'';
const editDate=t=>new Date(t).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'});
const movementLine=r=>r.movement?'<small>'+e(r.movement)+'</small>':'';
function dailyRows(groups,render,showTitle=false){
 return groups.map(({day,entries})=>{
  if(entries.length===1)return render(entries[0]);
  const title=showTitle?e(entries[0].targetTitle)+' · ':'';
  return '<details class="history-day"><summary>'+title+e(day)+' · '+entries.length+' 条编辑记录</summary>'+entries.map(render).join('')+'</details>';
 }).join('');
}
function renderRecent(c){
  const href=c.source==='page'?'/doc/'+c.targetId:c.source==='course'?'/course/'+c.targetId:c.source==='subject'?'/subject/'+c.targetId:c.targetPageId?'/doc/'+c.targetPageId:c.adminAction?.startsWith('discussion.')?'/discussion/'+c.targetId:'',target=href?link(c.targetTitle,href):e(c.targetTitle),detail=c.source==='page'?'':c.reason||c.summary||'';
  const action=c.source==='page'?(c.version===1?'创建页面':'编辑页面'):c.action;
  const description=detail?'<p>'+e(detail)+'</p>':'';
  return '<div class="history-row recent-change"><div><b>'+e(c.kind)+' · '+e(action)+'</b> · '+e(c.actor)+'<small>'+target+' · '+e(editDate(c.created))+(c.version?' · v'+e(c.version):'')+'</small>'+(c.source==='page'?'<small>'+(c.exact?'增加 '+c.added+' / 删除 '+c.removed+' 字符':c.status==='incomplete'?'尚未完成统计':'统计中')+'</small>'+button('查看本次改动','recent-compare','data-document="'+e(c.targetId)+'" data-revision="'+(c.previousRevisionId||0)+'" data-to="'+c.eventId+'"')+button('与最新版比较','recent-compare','data-document="'+e(c.targetId)+'" data-revision="'+(c.previousRevisionId||0)+'"'):'')+movementLine(c)+description+(c.before||c.after?'<details><summary>变更记录</summary><pre>'+e(JSON.stringify({before:c.before||{},after:c.after||{}},null,2))+'</pre></details>':'')+'</div>'+button('撤销','undo-recent','data-source="'+e(c.source)+'" data-id="'+e(c.eventId)+'" data-label="'+e(c.kind+' · '+action+' · '+c.targetTitle)+'"')+'</div>';

}
const date=t=>new Date(t).toLocaleString('zh-CN',{hour12:false});
const pagePath=(c,d,tab='read')=>(d.is_course_home?'/course/'+c.id:'/doc/'+d.id)+(tab==='read'?'':'/'+tab);
function modal(title,html,submit){
 $('#modal-title').textContent=title;$('#modal-message').innerHTML=html+'<p class="form-error" role="alert"></p>';
 const form=$('#modal form');if(form)form.onsubmit=async ev=>{ev.preventDefault();const b=form.querySelector('[type=submit]');if(b)b.disabled=true;try{await submit(new FormData(form))}catch(err){$('#modal .form-error').textContent=err.message}finally{if(b)b.disabled=false}};
 if(!$('#modal').open)$('#modal').showModal();
}
function closeModal(){const compose=$('#forum-compose')||$('#atlas-compose');if(compose?.dataset.pending==='true')return;if(compose&&dirty){if(!confirm('有尚未保存的内容，确定放弃吗？'))return;dirty=false}$('#modal').close()}
function error(err){modal('操作未完成','<p>'+e(err.message)+'</p>')}
function needUser(){if(state.user?.canEdit)return true;account('login');return false}
const actionNames={'user.block':'封禁账号','user.unblock':'解除封禁','user.promote':'设置管理员','comment.hide':'隐藏评论','comment.restore':'恢复评论','document.protect':'保护页面','document.unprotect':'取消保护','document.restore':'恢复历史版本','document.archive':'移除页面','document.restore-page':'恢复页面','course.create':'添加课程','course.update':'修改课程','course.archive':'移除课程','course.restore':'恢复课程','subject.create':'添加板块','subject.update':'修改板块','subject.archive':'移除板块','subject.restore':'恢复板块'};
async function management(kind='users',before=''){
 if(!state.user){account('login');return}if(state.user.role!=='admin'){modal('需要管理员','<p>只有管理员可以查看全站最近更改。</p>');return}if(!state.user.canEdit){account('login');return}
 const query=new URLSearchParams();if(before)query.set('before',before);if(kind==='users'&&context.userQuery)query.set('q',context.userQuery);
 if(kind==='recent'){query.set('daily','1');query.set('minChange',context.recentMin||'0');query.set('sort',context.recentSort||'time')}
 const out=await api('/admin/'+kind+'?'+query),tabs='<div class="form-actions">'+[['recent','最近更改'],['users','账号'],['comments','评论'],['actions','操作记录']].map(([k,label])=>button(label,'manage-governance','data-kind="'+k+'"')).join('')+'</div>';
 context.management=kind;context.managementRows=out[kind];
 let content='';
 if(kind==='users')content='<form><label>查找用户名<input name="query" maxlength="80" value="'+e(context.userQuery||'')+'"></label><button type="submit">查找</button></form>'+out.users.map(u=>'<div class="history-row"><div><b>'+e(u.username)+'</b><small>'+e((u.role==='admin'?'管理员':'编辑者')+' · '+(u.verified?'邮箱已验证':'未验证')+' · '+(u.blocked?'已封禁':'正常'))+'</small></div>'+button(u.blocked?'解除封禁':'封禁','moderate-user','data-id="'+u.id+'"')+'</div>').join('');
 else if(kind==='comments')content=out.comments.map(c=>'<div class="history-row"><div><b>'+e(c.username)+'</b> · '+link(c.document_title,'/doc/'+c.document_id)+'<small>'+e(date(c.created)+(c.hidden?' · 已隐藏':' · 公开'))+'</small><p>'+e(c.body).replace(/\n/g,'<br>')+'</p></div>'+button(c.hidden?'恢复评论':'隐藏评论','moderate-comment','data-id="'+c.id+'"')+'</div>').join('');
 else if(kind==='recent')content='<form><label>最少增删字符数<input name="minChange" type="number" min="0" max="100000000" value="'+e(context.recentMin||'0')+'"></label><label>排序<select name="sort"><option value="time">最新优先</option><option value="size"'+(context.recentSort==='size'?' selected':'')+'>大改动优先</option></select></label><button type="submit">应用</button></form><p>增删相对上一版，按正文源码字符计算（含公式、标记和空白）；改写计入增加与删除。未完成统计的记录不参与大小筛选和排名。</p>'+(out.uncounted?'<p role="status">尚有 '+out.uncounted+' 条修订未完成统计。</p>'+button('刷新统计','manage-governance','data-kind="recent"'):'')+dailyRows(out.groups,renderRecent,true);
 else content=out.actions.map(a=>'<div class="history-row"><div><b>'+e(actionNames[a.action]||a.action)+'</b> · '+e(a.actor)+'<small>'+e(date(a.created)+' · '+a.target_type+' '+a.target_id)+'</small><p>'+e(a.reason)+'</p><details><summary>变更记录</summary><pre>'+e(JSON.stringify({before:JSON.parse(a.before_json),after:JSON.parse(a.after_json)},null,2))+'</pre></details></div></div>').join('');
 const rows=kind==='recent'?out.groups:out[kind];
 modal(kind==='recent'?'最近更改':'账号与讨论管理',tabs+content+(rows.length?'':'<p>暂无记录。</p>')+(out.nextBefore?button('下一页','manage-governance','data-kind="'+kind+'" data-before="'+out.nextBefore+'"'):''),async f=>{if(kind==='recent'){context.recentMin=f.get('minChange');context.recentSort=f.get('sort');await management('recent')}else{context.userQuery=f.get('query').trim();await management('users')}});
}
function account(mode){
 const mailHint=state.mailMode==='file'?'<p>当前为本机测试邮件模式，邮件不会实际外发。</p>':'';
 if(mode==='forgot'){
  modal('找回密码','<form><label>已登记的复旦邮箱<input name="email" type="email" autocomplete="email" maxlength="254" required></label>'+mailHint+'<button class="primary" type="submit">发送恢复邮件</button></form>',async f=>{const out=await api('/auth/forgot-password','POST',Object.fromEntries(f));modal('找回密码','<p>'+e(out.message)+'</p>')});return;
 }
 if(state.user){
  const u=state.user;
  const binding=u.localEdit?'<p>本机编辑已启用，可直接编辑和发布。正式网站仍需验证复旦邮箱。</p>':u.emailVerified?'<p>邮箱已验证：'+e(u.email)+'</p>':'<p>绑定并验证复旦邮箱后即可编辑和发布。原有资料与历史保留。</p><form><label>复旦邮箱<input name="email" type="email" autocomplete="email" maxlength="254" required value="'+e(u.email||'')+'"></label><label>当前密码<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="200" required></label><button class="primary" type="submit">绑定并发送验证邮件</button></form>'+(u.email?button('重发验证邮件','resend-verification'):'')+mailHint;
  modal(u.username,'<p>'+e(u.role==='admin'?'管理员':'注册用户')+'</p>'+binding+'<div class="form-actions">'+button('找回密码','forgot-password')+button('退出登录','logout')+'</div>',async f=>{const out=await api('/auth/bind-email','POST',Object.fromEntries(f));state.user=out.user;await render();modal('验证邮箱','<p>'+e(out.message)+'</p>'+mailHint)});return;
 }
 const register=mode==='register';
 modal(register?'注册':'登录','<form><label>用户名<input name="username" autocomplete="username" minlength="2" maxlength="40" required></label>'+(register?'<label>复旦邮箱<input name="email" type="email" autocomplete="email" maxlength="254" required></label><small>允许邮箱：'+e((state.emailDomains||[]).join('、'))+'</small>':'')+'<label>密码<input name="password" type="password" autocomplete="'+(register?'new-password':'current-password')+'" minlength="8" maxlength="200" required></label>'+(register?mailHint:'')+'<div class="form-actions"><button class="primary" type="submit">'+(register?'注册并发送验证邮件':'登录')+'</button>'+button(register?'已有账号，登录':'注册账号',register?'login':'register')+(!register?button('忘记密码','forgot-password'):'')+'</div></form>',async f=>{
  const out=await api('/auth/'+(register?'register':'login'),'POST',Object.fromEntries(f));state.user=out.user;closeModal();await render();if(register)account('login');
 });
}
function accountPage(parts){
 if(parts[1]==='verify')return '<h1>验证邮箱</h1>'+(state.user?'<form id="verify-email"><p>为当前登录账号确认此邮箱。</p><button class="primary" type="submit">确认验证</button><p class="form-error" role="alert"></p></form>':'<p>请先登录申请此邮件的账号，再确认验证。</p>'+button('登录','login'));
 if(parts[1]==='reset')return '<h1>重设密码</h1><form id="reset-password"><label>新密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="200" required></label><label>再次输入<input name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="200" required></label><button class="primary" type="submit">更新密码</button><p class="form-error" role="alert"></p></form>';
 throw Error('账号链接无效');
}
function bindAccountPage(parts){
 const form=$('#verify-email')||$('#reset-password');if(!form)return;
 form.onsubmit=async ev=>{
  ev.preventDefault();const b=form.querySelector('button');b.disabled=true;
  try{
   const values=Object.fromEntries(new FormData(form));if(parts[1]==='reset'&&values.password!==values.confirm)throw Error('两次密码不一致');
   const out=await api('/auth/'+(parts[1]==='verify'?'verify-email':'reset-password'),'POST',{token:parts[2],password:values.password});
   state.user=out.user||null;history.replaceState(null,'','#/');lastHash='#/';await render();modal('账号操作完成','<p>'+e(out.message)+'</p>'+(!out.user?button('登录','login'):''));
  }catch(err){form.querySelector('.form-error').textContent=err.message;b.disabled=false}
 };
}
function sidebar(selected='',scope='root',active=primarySection(location.hash),children){
 return '<aside class="subject-sidebar">'+siteNavigation(active,children)+'</aside>';
}
function layout(html,subject='',scope='root',active=primarySection(location.hash),children){return '<div class="layout">'+sidebar(subject,scope,active,children)+'<main id="main" tabindex="-1">'+html+'</main></div>'}
function directoryList(items,label){return items.length?'<nav class="directory-list" aria-label="'+e(label)+'"><ul>'+items.map(item=>'<li>'+link(item.title,item.path)+'</li>').join('')+'</ul></nav>':''}
function crumb(c,title){
 const parts=[link('课程资料','/materials')];
 if(c){
  if(isCourseCollectionSubject(c.subject))parts.push(link(subjectName(c.subject),'/subject/'+c.subject));
  else parts.push(link('数学科学学院','/catalog/major/math'),link(subjectName(c.subject),'/subject/'+c.subject));
  parts.push(link(c.title,'/course/'+c.id));
 }
 if(title)parts.push('<span>'+e(title)+'</span>');
 return '<div class="crumb">'+parts.join(' / ')+'</div>';
}
function section(s){return '<section class="subject-section"><h2>'+link(s.title,'/subject/'+s.id)+'</h2><ul class="course-list">'+state.courses.filter(c=>c.subject===s.id).map(c=>'<li>'+link(c.title,'/course/'+c.id)+'</li>').join('')+'</ul></section>'}
function aboutPage(){
 return layout(`<article class="about-page">
<h1>网站介绍与页面编辑说明</h1>
<section aria-labelledby="about-origin"><h2 id="about-origin">网站缘起</h2>
<p>本站由香蕉空间旧站「用户:Solution」目录下整理的课程资料发展而来。因香蕉空间更新，相关资料迁移至现在的独立网站。</p>
<p>感谢香蕉空间及其维护者、编辑者提供的整理与分享平台，也感谢资料的原作者和参与整理的同学。本站使用新版香蕉空间的部分排版工具与编辑规范，希望延续共同整理、公开分享资料的方式。</p></section>
<section aria-labelledby="about-content"><h2 id="about-content">内容与发展方向</h2>
<p>复旦数学资源库以课程资料为主，面向所有人开放阅读。目前设有专业课程、通识课程和讨论室，支持共同编辑课程页面、查看版本历史和交流讨论。</p>
<p>现有资料主要集中在数学科学学院。后续希望逐步拓展至更多学科，丰富专业课程与通识课程的资料，为全校同学的学习与交流提供帮助。</p></section>
<section aria-labelledby="about-editing"><h2 id="about-editing">页面编辑</h2>
<p>使用 <strong><code>@m.fudan.edu.cn</code> 或 <code>@fudan.edu.cn</code></strong> 邮箱注册、完成邮箱验证并登录后，即可创建和编辑普通课程页面、参与讨论。</p>
<p><strong>编辑保存后会直接公开，无需逐次审核。</strong>修改记录保留在版本历史中；受保护的页面需由具有相应权限的用户编辑。</p>
<p>具体编辑规范请参考：<a href="https://bananaspace.org/help/%E6%A0%BC%E5%BC%8F%E6%89%8B%E5%86%8C/" target="_blank" rel="noopener noreferrer">页面编辑规范——香蕉空间格式手册</a>。</p></section>
</article>`);
}
function subjectOptions(selected){return state.subjects.map(s=>'<option value="'+s.id+'" '+(selected===s.id?'selected':'')+'>'+e(s.title)+'</option>').join('')}
async function editCourse(c=null,selectedSubject=''){
 if(!needUser())return;context.managedCourse=c;
 modal(c?'修改课程':'添加课程','<form><label>课程名称<input name="title" maxlength="120" required value="'+e(c?.title||'')+'"></label><label>板块<select name="subject">'+subjectOptions(c?.subject||selectedSubject)+'</select></label><div class="form-actions"><button class="primary" type="submit">保存</button>'+(c?button('移除课程','archive-course')+button('修改记录','course-history'):'')+'</div></form>',async f=>{
  const b=Object.fromEntries(f);if(c)b.version=c.version;await api('/courses'+(c?'/'+c.id:''),c?'PATCH':'POST',b);closeModal();await render();
 });
}
function editSubject(s=null){
 if(!needUser())return;
 context.managedSubject=s;
 modal(s?'修改板块':'添加板块','<form><label>板块名称<input name="title" maxlength="80" required value="'+e(s?.title||'')+'"></label><label>显示顺序<input name="position" type="number" step="1" required value="'+(s?.position??state.subjects.length)+'"></label><div class="form-actions"><button type="submit" class="primary">保存</button>'+(s?button('移除板块','archive-subject'):'')+'</div></form>',async f=>{
  const b=Object.fromEntries(f);b.position=Number(b.position);if(s)b.version=s.version;await api('/subjects'+(s?'/'+s.id:''),s?'PATCH':'POST',b);closeModal();await render();
 });
}
function localizeTeXQuotes(html){
 const holder=document.createElement('div');holder.innerHTML=html;
 const walker=document.createTreeWalker(holder,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode()))if(!node.parentElement?.closest('code,pre,textarea,kbd,samp,math,svg,.math-rendered,.math-inline,.math-display,.katex,.MathJax,.tex-math'))node.nodeValue=node.nodeValue.replaceAll('``','“').replaceAll("''",'”').replaceAll('’‘','”').replaceAll('’’','”').replaceAll('‘‘','“');
 return holder.innerHTML;
}
function texHTML(source,preamble=''){
 const r=renderTex(preamble+'\n'+source,window.katex);
 return (r.warnings.length?'<details class="warnings" open><summary>快速预览提示（'+r.warnings.length+'）</summary><ul>'+r.warnings.map(w=>'<li>'+e(w)+'</li>').join('')+'</ul><p>数学宏包和 TikZ 请使用完整 LaTeX 排版。</p></details>':'')+'<div class="tex-body">'+localizeTeXQuotes(r.html)+'</div>';
}
function download(source,title,mode=context.document?.render_mode){
 const url=URL.createObjectURL(new Blob([source],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
 a.href=url;a.download=(title||'课程页面').replace(/[\\/:*?"<>|]/g,'_')+(mode==='markdown'?'.md':'.tex');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadComparison(container,id,from,to='latest'){
 const token={};container.comparisonToken=token;
 container.innerHTML='<p role="status">正在读取版本…</p>';
 const started=Date.now();let resolvedTo=to;
 async function update(){
  try{
   const out=await api('/documents/'+encodeURIComponent(id)+'/diff?'+new URLSearchParams({from:from||'0',to:resolvedTo}));
   if(!container.isConnected||container.comparisonToken!==token||(container.closest('dialog')&&!container.closest('dialog').open))return;
   if(out.nextRevisionId)resolvedTo=String(out.nextRevisionId);
   const r=out.old,d=out.next,view=diffView(out.diff);
   if(container.id==='revision-detail'){context.revision=r;if(to==='latest')context.document={...context.document,...d,id}}
   container.innerHTML='<div data-comparison-root><h2>版本 '+r.version+' 与版本 '+d.version+'</h2><p>'+e(r.title)+' → '+e(d.title)+'</p>'+view.html+'<details data-diff-source><summary>并排查看完整源码</summary><div class="source-comparison"></div></details>'+(r.preamble!==d.preamble||r.render_mode!==d.render_mode?'<p>导言区或排版模式也有变化，请查看完整源码。</p>':'')+(container.id==='revision-detail'?button('下载此版本源码','download-revision')+(state.user?button('恢复此版本','restore-revision'):''):'')+'</div>';
   const root=container.firstElementChild;root.diffFolds=view.folds;
   root.querySelector('[data-diff-source]').addEventListener('toggle',ev=>{
    const details=ev.currentTarget;if(!details.open||details.dataset.loaded)return;details.dataset.loaded='true';
    details.querySelector('.source-comparison').innerHTML='<label>所选版本<textarea readonly>'+e(exportSource(r))+'</textarea></label><label>目标版本<textarea readonly>'+e(exportSource(d))+'</textarea></label>';
   });
   if(['pending','busy'].includes(out.diff.status)){
    if(Date.now()-started<30000)setTimeout(()=>{if(container.isConnected&&container.comparisonToken===token&&(!container.closest('dialog')||container.closest('dialog').open))void update()},500);
    else{const retry=document.createElement('button');retry.textContent='继续查看比较结果';retry.onclick=()=>loadComparison(container,id,from,resolvedTo);root.append(retry)}
   }
  }catch(err){if(container.isConnected&&container.comparisonToken===token)container.innerHTML='<p role="alert">'+e(err.message)+'</p>'}
 }
 await update();
}
function exportSource(d){return d.render_mode==='markdown'?d.tex:sourceWithDependencies(d,location.origin)}
function pageShell(c,docs,d,tab,body,archived){
 const children=docs.filter(x=>x.parent_id===d.id);
 const parent=docs.find(x=>x.id===d.parent_id&&x.id!==d.id);
 const back=parent?'<p class="reader-parent">'+link('返回上级目录',pagePath(c,parent))+'</p>':'';
 const side='<aside class="reader-sidebar" id="reader-sidebar">'+siteNavigation('materials',children.map(x=>({title:x.title,path:pagePath(c,x)})))+'</aside>';
 const directory=tab==='read'&&children.length?'<section class="reader-child-directory">'+directoryList(children.map(x=>({title:x.title,path:pagePath(c,x)})),'目录')+'</section>':'';
 return '<div class="reader-layout">'+side+'<main class="reading-main" id="main">'+crumb(c,d.is_course_home?'':d.title)+back+'<div class="page-heading"><h1>'+e(d.title)+'</h1>'+(d.is_course_home?button('修改课程','edit-course'):'')+'</div><div class="reader-toolbar"><nav class="page-tabs">'+['read','discussion','history'].map((t,i)=>'<a class="'+(t===tab?'active':'')+'" href="#'+pagePath(c,d,t)+'">'+['阅读','讨论','历史版本'][i]+'</a>').join('')+'</nav><div class="actions">'+button('编辑本页','edit-document')+(!c.archived&&!d.archived?button('新增子页面','new-document','data-course="'+c.id+'" data-parent="'+d.id+'"'):'')+button('下载 TeX','download')+(d.source?button('下载原格式源码','download-legacy-source'):'')+'</div></div>'+(c.archived||d.archived?'<p class="status-text">此页面或课程已移除。</p>':'')+'<article class="page-body">'+body+'</article>'+directory+'<div class="page-maintenance">'+(state.user?.role==='admin'?button(d.protected?'取消保护':'保护本页','protect'):'')+(state.user&&!d.is_course_home?button(d.archived?'恢复页面':'移除页面',d.archived?'restore-page':'archive-page'):'')+(state.user&&d.is_course_home?button('已移除页面','archived-pages'):'')+(d.protected?'<small>此页面已保护</small>':'')+'</div></main></div>';
}
function fitParentReaderFrames(){
 const mediaSelectors='img,svg,canvas,video,audio,object,embed,iframe,table,pre,figure,math,.math-display,.math-rendered,.katex,.MathJax,.theorem-proof,.bibliography,.footnotes,.pdf-document,form,input,button,textarea,select';
 const fit=frame=>{
  try{
   const doc=frame.contentDocument,article=doc?.querySelector('article');if(doc?.readyState!=='complete'||!article)return false;
   const view=frame.contentWindow,pageBody=frame.closest('.page-body'),layout=frame.closest('.reader-layout'),content=article.cloneNode(true);
   if(!doc.getElementById('fudan-parent-fit')){
    const style=doc.createElement('style');style.id='fudan-parent-fit';
    style.textContent='.wrapper{min-height:0!important}article>header:has(#page-title),.article-footer{display:none!important}.content{flex:none!important;margin-block:0!important}.content>.container{margin:0!important;padding:0!important;max-width:none!important}';
    doc.head.append(style);
   }
   content.querySelectorAll('#page-title,.collection-sidebar,.collection-children,.collection-pagination,.article-footer').forEach(node=>node.remove());
   const hasMedia=content.querySelector(mediaSelectors)!==null;
   const hasContent=hasVisibleReaderContent(content.textContent,hasMedia);
   if(!hasContent){
    pageBody?.classList.add('empty-parent-page-body');frame.style.height='0px';return true;
   }
   pageBody?.classList.remove('empty-parent-page-body');
   frame.style.height='0px';
   frame.style.height=Math.max(32,doc.documentElement.scrollHeight,doc.body.scrollHeight)+'px';
   return true;
  }catch{return false}
 };
 document.querySelectorAll('iframe.banana-page.parent-page').forEach(frame=>{
  let attempts=0,observed=false;
  const measure=()=>{
   if(!frame.isConnected)return;
   if(fit(frame)){
    frame.contentDocument?.fonts?.ready?.then(()=>fit(frame)).catch(()=>{});
    if(!observed){
     observed=true;let width=frame.getBoundingClientRect().width;
     const observer=new ResizeObserver(()=>{
      if(!frame.isConnected){observer.disconnect();return;}
      const next=frame.getBoundingClientRect().width;
      if(next!==width){width=next;fit(frame);}
     });observer.observe(frame);
     frame.contentDocument.addEventListener('load',()=>{if(frame.isConnected)fit(frame);},true);
    }
    return;
   }
   if(attempts++<30)setTimeout(measure,100);
  };
  frame.addEventListener('load',measure,{once:true});
  measure();
 });

}
function parentOptions(c,docs,d){
 const descendants=new Set([d.id]);let changed=true;
 while(changed){changed=false;for(const x of docs)if(descendants.has(x.parent_id)&&!descendants.has(x.id)){descendants.add(x.id);changed=true}}
 return docs.filter(x=>!descendants.has(x.id)).map(x=>'<option value="'+x.id+'" '+(x.id===(d.parent_id||c.home_id)?'selected':'')+'>'+e(x.is_course_home?c.title:x.title)+'</option>').join('');
}
function editor(c,docs,d,isNew){
 return '<main class="editor-main" id="main">'+crumb(c,isNew?'新增子页面':'编辑')+'<form id="editor-form"><div class="editor-fields"><label>标题<input name="title" value="'+e(d.title)+'" maxlength="120" required '+(d.is_course_home?'readonly':'')+'></label>'+(d.is_course_home?'':'<label>上级页面<select name="parent_id">'+parentOptions(c,docs,d)+'</select></label>')+'<label>目录顺序<input name="position" type="number" step="1" min="-100000" max="100000" value="'+d.position+'" required></label><label>页面排版<select name="render_mode"><option value="markdown" '+(d.render_mode==='markdown'?'selected':'')+'>香蕉空间 Markdown</option><option value="web" '+(d.render_mode==='web'?'selected':'')+'>网页排版</option><option value="latex" '+(['latex','markdown'].includes(d.render_mode)?'selected':'')+'>完整 LaTeX（含 TikZ）</option></select></label></div><details class="preamble-panel" '+(d.preamble?'open':'')+'><summary>导言区：宏包与自定义命令</summary><label>导言区<textarea name="preamble" maxlength="30000" spellcheck="false">'+e(d.preamble||'')+'</textarea></label><small>完整排版已加载 '+e((state.packages||[]).join('、'))+'。可补充宏定义和 TikZ 库；完整 .tex 文档也可直接放入正文。</small></details><div class="editor-tools">'+button('节标题','insert','data-template="section"')+button('公式','insert','data-template="math"')+button('定理','insert','data-template="theorem"')+button('证明','insert','data-template="proof"')+button('链接','insert-link')+'<label class="file-label">上传图片 / PDF<input type="file" id="image-file" accept="image/png,image/jpeg,image/webp,application/pdf" aria-label="上传图片 / PDF"></label>'+button('下载 TeX','download-editor')+'<label class="file-label">导入 TeX<input type="file" id="tex-file" accept=".tex,.txt" aria-label="导入 TeX"></label></div><div class="editor-columns"><label class="source-pane">TeX 正文<textarea id="tex-source" name="tex" spellcheck="false" maxlength="200000">'+e(d.tex)+'</textarea></label><section class="preview-pane" aria-label="实时预览"><div class="preview-heading"><h2>预览</h2>'+button('快速预览','quick-preview')+button('编译 LaTeX 预览','compile-preview')+'</div><p id="preview-status" role="status"></p><div id="tex-preview">'+(d.render_mode==='latex'?'<p class="empty-state">点击“编译 LaTeX 预览”。</p>':texHTML(d.tex,d.preamble))+'</div></section></div><details class="syntax-help"><summary>编辑说明</summary><p>正文可用 section、theorem、proof、公式和列表；超链接用 href 或 url，图片用 includegraphics。上传图片 / PDF后自动插入源码，上传的附件可公开访问。PDF 附件在网页排版中用 includepdf 显示全部页。</p><p>网页排版即时预览；数学宏包和 TikZ 使用完整 LaTeX 排版，保存时自动编译。支持常规 pdfLaTeX 数学宏包，不执行 shell escape 或外部程序。较长资料请分成子页面。</p></details><label>修改说明<input name="summary" maxlength="300" placeholder="可选"></label><div class="form-actions"><button class="primary" type="submit">保存并公开</button><a href="#'+(isNew?'/course/'+c.id:pagePath(c,d))+'">取消</a><span id="save-status" role="status"></span></div><p id="editor-error" class="form-error" role="alert"></p></form></main>';
}
function insertText(text){
 const source=$('#tex-source');if(!source||source.disabled)return;
 source.setRangeText(text,source.selectionStart,source.selectionEnd,'end');source.dispatchEvent(new Event('input',{bubbles:true}));source.focus();
}
function bindEditor(){
 const form=$('#editor-form'),source=$('#tex-source');if(!form)return;let importing=false,previewSeq=0,previewBusy=false;
 // Textareas normalize line endings. Retain the original source on an unchanged submission.
 const initialText={};
 for(const key of ['tex','preamble']){
  const original=context.document[key]??'';
  form.elements[key].value=original;
  initialText[key]={original,displayed:form.elements[key].value};
 }
 form.elements.render_mode.value=context.isNew?'markdown':context.document.render_mode;
 const syncFormat=()=>{const md=form.elements.render_mode.value==='markdown';form.querySelector('.source-pane').firstChild.textContent=md?'Markdown 正文':'TeX 正文';form.querySelector('.preamble-panel').hidden=md;form.querySelector('[data-action=download-editor]').textContent=md?'下载 Markdown':'下载 TeX';form.querySelector('[data-action=compile-preview]').textContent=md?'预览 Markdown':'编译 LaTeX 预览';form.querySelector('.syntax-help').hidden=md;};
 form.elements.render_mode.addEventListener('change',syncFormat);syncFormat();
 $('#tex-file').accept='.md,.tex,.txt';
 form.addEventListener('input',()=>{
  dirty=true;$('#save-status').textContent='尚未保存';previewSeq++;releasePDFs();clearTimeout(previewTimer);
  if(form.elements.render_mode.value==='web')previewTimer=setTimeout(()=>{if(form.isConnected){$('#tex-preview').innerHTML=texHTML(source.value,form.elements.preamble.value);renderEmbeddedPDFs($('#tex-preview'))}},250);
  else $('#preview-status').textContent='源码已修改，请重新编译预览。';
 });
 $('#tex-file').onchange=async ev=>{
  const f=ev.target.files[0];if(!f)return;if(f.size>600000){$('#editor-error').textContent='文件过大，请拆分页面。';return}
  if(source.value&&!confirm('导入会替换编辑框中的内容，是否继续？'))return;
  importing=true;
  try{const loaded=await f.text();if(!form.isConnected)return;source.value=loaded;if(/\\(?:documentclass|begin\{tikzpicture)/.test(loaded))form.elements.render_mode.value='latex';source.dispatchEvent(new Event('input',{bubbles:true}))}
  catch{if(form.isConnected)$('#editor-error').textContent='无法读取文件。'}finally{importing=false}
 };
 $('#image-file').onchange=async ev=>{
  const f=ev.target.files[0];if(!f)return;if(f.size>5*1024*1024){$('#editor-error').textContent='附件不能超过 5 MB。';return}
  importing=true;$('#save-status').textContent='正在上传图片 / PDF…';
  try{
   const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(f)});
   const out=await api('/assets','POST',{data});if(!form.isConnected)return;insertText(form.elements.render_mode.value==='markdown'?(out.url.endsWith('.pdf')?'[PDF]('+out.url+')\n':'![]('+out.url+')\n'):(out.url.endsWith('.pdf')?'\\includepdf[pages=-]{':'\\includegraphics[width=0.8\\textwidth]{')+out.url+'}\n');
  }catch(err){if(form.isConnected)$('#editor-error').textContent=err.message||'附件读取失败'}
  finally{importing=false;if(form.isConnected)$('#save-status').textContent=dirty?'尚未保存':''}
 };
 form.invalidatePreview=()=>{previewSeq++;releasePDFs()};
 form.compilePreview=async()=>{
  previewBusy=true;const seq=++previewSeq,b=form.querySelector('[data-action=compile-preview]');b.disabled=true;$('#preview-status').textContent='正在编译…';
  try{
   const out=await api('/preview','POST',{tex:source.value,preamble:form.elements.render_mode.value==='markdown'?'':form.elements.preamble.value,render_mode:form.elements.render_mode.value,title:form.elements.title.value,document_id:context.isNew?undefined:context.document.id});
   if(!form.isConnected||seq!==previewSeq)return;
   $('#preview-status').textContent='编译完成';if(form.elements.render_mode.value==='markdown')$('#tex-preview').innerHTML='<iframe class="banana-page" title="Markdown预览" sandbox="allow-same-origin allow-top-navigation-by-user-activation allow-top-navigation-by-user-activation" src="'+e(out.url+(out.url.includes('?')?'&':'?')+'readerLayout=1')+'"></iframe>';else await renderPDF($('#tex-preview'),out.url,()=>form.isConnected&&seq===previewSeq);
  }catch(err){if(form.isConnected&&seq===previewSeq)$('#preview-status').textContent=err.message}
  finally{previewBusy=false;if(form.isConnected){b.disabled=form.dataset.saving==='true';if(seq!==previewSeq)$('#preview-status').textContent='源码已修改，请重新编译预览。'}}
 };
 form.onsubmit=async ev=>{
  ev.preventDefault();if(form.dataset.saving==='true')return;
  if(importing){$('#editor-error').textContent='正在读取或上传文件，请完成后保存。';return}
  const activeContext=context,values=Object.fromEntries(new FormData(form));values.position=Number(values.position);values.version=activeContext.document.version;
  for(const [key,{original,displayed}] of Object.entries(initialText)){
   if(values[key]===displayed)values[key]=original;
  }
  if(values.render_mode==='markdown')values.preamble='';
  const controls=Array.from(form.elements).map(el=>({el,disabled:el.disabled}));
  form.dataset.saving='true';controls.forEach(({el})=>el.disabled=true);$('#editor-error').textContent='';$('#save-status').textContent=values.render_mode==='latex'?'正在编译并保存…':'正在保存…';previewSeq++;
  try{
   const out=await api(activeContext.isNew?'/courses/'+activeContext.course.id+'/documents':'/documents/'+activeContext.document.id,activeContext.isNew?'POST':'PUT',values);
   if(!form.isConnected||context!==activeContext)return;
   dirty=false;location.hash=pagePath(activeContext.course,out.document);
  }catch(err){if(form.isConnected){$('#editor-error').textContent=err.message;$('#save-status').textContent='尚未保存'}}
  finally{form.dataset.saving='false';controls.forEach(({el,disabled})=>el.disabled=disabled);form.querySelector('[data-action=compile-preview]').disabled=previewBusy}
 };
}
async function render(){
 const id=++renderId;clearTimeout(previewTimer);
 try{
  const next=await api('/state');if(id!==renderId)return;state=next;$('.account').textContent=state.user?state.user.username:'登录 / 注册';
  const [route,routeQuery='']=(location.hash.slice(1)||'/').split('?');
  const p=resolveMathBRoute(route.split('/').filter(Boolean).map(decodeURIComponent),state.courses);p.query=routeQuery;
  if(p[0]==='catalog'&&p[1]==='general'&&p.length===2)p.splice(0,p.length,'subject',universityMathSubjectId);
  let html='',ctx={},pdfUrl=null;
 if(!p.length||(p[0]==='materials'&&p.length===1)){
   const adminTools=button('添加课程','add-course')+(state.user?button('管理课程','manage-courses')+button('已移除课程','archived'):'')+(state.user?.role==='admin'?button('管理板块','manage-subjects')+button('最近更改','manage-governance','data-kind="recent"')+button('账号与讨论管理','manage-governance'):'');
   html=layout('<div class="page-heading"><h1>课程资料</h1><div class="actions">'+adminTools+'</div></div>'+directoryList(courseCollections,'课程类别'));
  }else if(['reviews','guides'].includes(p[0])){
   releasePDFs();$('#app').innerHTML='<div class="layout"><aside class="subject-sidebar">'+siteNavigation(p[0])+'</aside><main id="main" class="atlas-main" tabindex="-1"><p role="status" aria-live="polite">正在加载…</p></main></div>';
   const content=await atlas.view(p);html='<div class="layout"><aside class="subject-sidebar">'+siteNavigation(p[0])+'</aside><main id="main" class="atlas-main" tabindex="-1">'+content+'</main></div>';
  }else if(p[0]==='about'&&p.length===1){
   html=aboutPage();
  }else if(p[0]==='discussion'){
   html=layout(await forum.view(p));
  }else if(p[0]==='account'){
   html=layout(accountPage(p));
  }else if(p[0]==='catalog'){
   if(p[1]==='major'&&(p.length===2||(p.length===3&&p[2]==='math'))){
    const crumbHtml='<div class="crumb">'+link('课程资料','/materials')+' / <span>数学科学学院</span></div>';
    const controls=button('添加课程','add-course')+(state.user?button('管理课程','manage-courses')+button('已移除课程','archived'):'')+(state.user?.role==='admin'?button('管理板块','manage-subjects'):'');
    html=layout(crumbHtml+'<div class="page-heading"><h1>数学科学学院</h1><div class="actions">'+controls+'</div></div><div class="subject-grid">'+professionalSubjects(state.subjects).map(section).join('')+'</div>','','math','materials',professionalSubjects(state.subjects).map(s=>({title:s.title,path:'/subject/'+s.id})));
   }else{
    throw Error('课程目录不存在');
   }
  }else if(p[0]==='subject'){
   const s=state.subjects.find(x=>x.id===p[1]);if(!s)throw Error('板块不存在');
   const isCollection=isCourseCollectionSubject(s.id),scope=collectionForSubject(s.id);
   const ancestors=isCollection?link('课程资料','/materials')+' / <span>'+e(s.title)+'</span>':link('课程资料','/materials')+' / '+link('数学科学学院','/catalog/major/math')+' / <span>'+e(s.title)+'</span>';
   const items=state.courses.filter(c=>c.subject===s.id).map(c=>({title:c.title,path:'/course/'+c.id}));
   html=layout('<div class="crumb">'+ancestors+'</div><div class="page-heading"><h1>'+e(s.title)+'</h1>'+button('添加课程','add-course','data-subject="'+s.id+'"')+'</div>'+(items.length?directoryList(items,'课程目录'):'<p class="empty-state">暂无课程</p>'),s.id,scope,'materials',items);
  }else if(p[0]==='new'){
   const data=await api('/courses/'+p[1]),c=data.course,docs=[data.home,...data.documents];
   if(!state.user?.canEdit)html=layout('<p>登录并验证复旦邮箱后可创建子页面。</p>'+button('账号与邮箱验证','account'));
   else{
    if(c.archived)throw Error('课程已移除，请先恢复');
    const parent=p[2]||c.home_id;if(!docs.some(x=>x.id===parent))throw Error('上级页面不存在');
    const d={title:'',tex:'',position:0,parent_id:parent,preamble:'',render_mode:'web'};
    ctx={course:c,documents:docs,document:d,isNew:true};html=editor(c,docs,d,true);
   }
  }else if(['course','doc','read'].includes(p[0])){
   let data,d;
   if(p[0]==='doc'){const out=await api('/documents/'+p[1]);d=out.document;data=await api('/courses/'+out.course.id)}
   else{data=await api('/courses/'+p[1]);d=data.home}
   const c=data.course,docs=[data.home,...data.documents],tab=p[2]||'read';ctx={course:c,document:d,documents:docs,archived:data.archived,isNew:false};
   if(tab==='edit'){
    if(!state.user?.canEdit)html=layout('<p>登录并验证复旦邮箱后可编辑页面。</p>'+button('账号与邮箱验证','account'));
    else if((d.protected&&state.user.role!=='admin')||c.archived||d.archived)throw Error('此页面已受保护或移除，当前无法编辑');
    else html=editor(c,docs,d,false);
   }else{
    let body='';
    if(tab==='history'){
     const {groups}=await api('/documents/'+d.id+'/history?daily=1');
     body='<div class="history-list">'+dailyRows(groups,r=>'<div class="history-row"><div><b>版本 '+r.version+'</b> · '+e(r.username)+'<small>'+e(editDate(r.created))+'</small>'+movementLine(r)+'</div>'+button('查看与比较','compare','data-revision="'+r.id+'"')+'</div>')+'</div><div id="revision-detail"></div>';
    }else if(tab==='discussion'){
     const {comments}=await api('/documents/'+d.id+'/comments');
     body='<div class="comments">'+comments.map(x=>'<div class="comment"><b>'+e(x.username)+'</b><small>'+e(date(x.created))+'</small><p>'+e(x.body).replace(/\n/g,'<br>')+'</p></div>').join('')+'</div>'+(state.user?.canEdit?'<form id="comment-form"><label>讨论<textarea name="body" maxlength="5000" required></textarea></label><button class="primary" type="submit">发布</button><p class="form-error" role="alert"></p></form>':button('登录并验证邮箱后参与讨论','account'));
    }else if(d.source&&d.render_mode==='latex'&&!d.artifact){body='<p class="form-error">原源码已导入，编译待处理。正文保持原样，尚无可核验的 PDF。</p><pre>'+e(d.source.compile_error)+'</pre><details open><summary>原始源码</summary><pre>'+e(d.tex)+'</pre></details>'}
    else if(d.render_mode==='markdown'&&d.artifact){const hasChildren=docs.some(x=>x.parent_id===d.id);body='<iframe class="banana-page'+(hasChildren?' parent-page':'')+'" title="课程正文" sandbox="allow-same-origin allow-top-navigation-by-user-activation" src="/markdown/'+e(d.artifact)+'/books/page/?readerLayout=1'+(hasChildren?'&parentPage=1':'')+(hideExamContents(c,d,docs)?'&hideExamContents=1':'')+(new URLSearchParams(location.search).get('mdDoc')===d.id?'#'+e(encodeURIComponent(new URLSearchParams(location.search).get('mdAnchor')||'')):'')+'"></iframe>'}
    else if(d.render_mode==='latex'&&d.artifact){body='<div id="page-pdf" class="pdf-document"></div>';pdfUrl='/compiled/'+d.artifact+'.pdf'}
    else if(d.tex||d.preamble)body=texHTML(d.tex,d.preamble);
    html=pageShell(c,docs,d,tab,body,data.archived);
   }
  }else if(p[0]==='search'){
   const q=(p[1]||'').trim().toLowerCase(),{documents}=await api('/search?q='+encodeURIComponent(q));
   const matches=createTitleMatcher(q);
   html=layout('<h1>搜索</h1><ul class="search-results">'+state.courses.filter(c=>matches(c.title)).map(c=>'<li>'+link(c.title,'/course/'+c.id)+'<span>'+e(subjectName(c.subject))+'</span></li>').join('')+documents.map(d=>'<li>'+link(d.title,'/doc/'+d.id)+'<span>'+e(d.course_title)+'</span></li>').join('')+await atlas.searchLinks(q)+'</ul>');$('#search').value=p[1]||'';
  }else throw Error('页面不存在');
  if(id!==renderId)return;
  if(['new','course','doc','read'].includes(p[0])&&html.startsWith('<main class="editor-main"'))html='<div class="layout">'+sidebar(ctx.course?.subject,collectionForSubject(ctx.course?.subject))+html+'</div>';
  releasePDFs();context=ctx;$('#app').innerHTML=html;bindEditor();bindAccountPage(p);atlas.bind();document.title=(ctx.document?.title?ctx.document.title+' · ':'')+'复旦数学资源库';fitParentReaderFrames();
  if(ctx.document?.render_mode==='markdown'){const b=$('[data-action=download]');if(b)b.textContent='下载 Markdown';const original=$('[data-action=download-legacy-source]');if(original)original.textContent='下载导入时 TeX';}
  if(pdfUrl)renderPDF($('#page-pdf'),pdfUrl);
  renderEmbeddedPDFs($('#app'));
  const form=$('#comment-form');if(form)form.onsubmit=async ev=>{ev.preventDefault();const b=form.querySelector('button');b.disabled=true;try{await api('/documents/'+context.document.id+'/comments','POST',Object.fromEntries(new FormData(form)));await render()}catch(err){form.querySelector('.form-error').textContent=err.message;b.disabled=false}};
 }catch(err){if(id===renderId){releasePDFs();$('#app').innerHTML=layout('<p class="form-error" role="alert">'+e(err.message)+'</p>'+button('重试','retry-load')+' '+link('返回课程资料','/materials'),'','root','')}}
}
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 try{
  if(action==='close')closeModal();
  else if(action==='retry-load')await render();
  else if(['account','login','register'].includes(action))account(action==='register'?'register':'login');
  else if(action==='forgot-password')account('forgot');
  else if(action==='resend-verification'){const out=await api('/auth/resend-verification','POST');modal('验证邮箱','<p>'+e(out.message)+'</p>')}
  else if(action==='logout'){if(dirty&&!confirm('有尚未保存的修改，确定退出吗？'))return;dirty=false;await api('/auth/logout','POST');closeModal();state.user=null;await render()}
  else if(action==='add-course')await editCourse(null,b.dataset.subject||'');
  else if(action==='edit-course')await editCourse(context.course);
  else if(action==='manage-courses'){
   if(!needUser())return;
   modal('管理课程','<div class="archive-list">'+state.courses.map(c=>'<div><span>'+e(c.title)+'</span>'+button('修改 / 移除','manage-course','data-id="'+c.id+'"')+'</div>').join('')+'</div>');
  }else if(action==='manage-course')await editCourse(state.courses.find(c=>c.id===b.dataset.id));
  else if(action==='course-history'){
   const {history}=await api('/courses/'+context.managedCourse.id+'/history'),names={create:'添加',update:'修改',archive:'移除',restore:'恢复'};
   modal('课程修改记录',history.length?history.map(h=>{const c=JSON.parse(h.snapshot);return '<div class="history-row"><div>'+e(names[h.action]+' · '+h.username)+'<small>'+e(date(h.created))+'</small><small>'+e(c.title+' · '+subjectName(c.subject))+'</small></div></div>'}).join(''):'<p>暂无修改记录。</p>');
  }else if(action==='archive-course'){
   const c=context.managedCourse;
   modal('移除课程','<form><p>将“'+e(c.title)+'”从主页移除，正文、子页面和历史保留，可恢复。</p><div class="form-actions"><button class="primary" type="submit">确认移除</button>'+button('取消','close')+'</div></form>',async()=>{await api('/courses/'+c.id+'/archive','POST',{version:c.version});closeModal();if(location.hash==='#/')await render();else location.hash='/'});
  }else if(action==='archived'){
   if(!needUser())return;const {courses}=await api('/courses/archived');
   modal('已移除课程',courses.length?'<div class="archive-list">'+courses.map(c=>'<div>'+e(c.title)+button('恢复','restore-course','data-id="'+c.id+'" data-version="'+c.version+'"')+'</div>').join('')+'</div>':'<p>暂无已移除课程。</p>');
  }else if(action==='restore-course'){await api('/courses/'+b.dataset.id+'/restore','POST',{version:Number(b.dataset.version)});closeModal();await render()}
  else if(action==='manage-subjects'){
   modal('管理板块','<div class="form-actions">'+button('添加板块','add-subject')+button('已移除板块','archived-subjects')+button('修改记录','subject-history')+'</div><div class="archive-list">'+state.subjects.map(s=>'<div><span>'+e(s.title)+'</span>'+button('修改','edit-subject','data-id="'+s.id+'"')+'</div>').join('')+'</div>');
  }else if(action==='add-subject')editSubject();
  else if(action==='edit-subject')editSubject(state.subjects.find(s=>s.id===b.dataset.id));
  else if(action==='archive-subject'){
   const s=context.managedSubject;modal('移除板块','<form><p>移除“'+e(s.title)+'”？板块内课程需先移走。</p><button class="primary" type="submit">确认移除</button></form>',async()=>{await api('/subjects/'+s.id+'/archive','POST',{version:s.version});closeModal();await render()});
  }else if(action==='archived-subjects'){
   const out=await api('/subjects/archived');modal('已移除板块',out.subjects.length?'<div class="archive-list">'+out.subjects.map(s=>'<div>'+e(s.title)+button('恢复','restore-subject','data-id="'+s.id+'" data-version="'+s.version+'"')+'</div>').join('')+'</div>':'<p>暂无已移除板块。</p>');
  }else if(action==='restore-subject'){await api('/subjects/'+b.dataset.id+'/restore','POST',{version:Number(b.dataset.version)});closeModal();await render()}
  else if(action==='subject-history'){
   const {history}=await api('/subjects/history'),names={create:'添加',update:'修改',archive:'移除',restore:'恢复'};
   modal('板块修改记录',history.length?history.map(x=>{const s=JSON.parse(x.snapshot);return '<div class="history-row"><div>'+e(s.title+' · '+names[x.action])+'<small>'+e(x.username+' · '+date(x.created)+' · 顺序 '+s.position)+'</small></div></div>'}).join(''):'<p>暂无修改记录。</p>');
  }else if(action==='manage-governance')await management(b.dataset.kind||'users',b.dataset.before||'');
  else if(action==='undo-recent'){
   const label=b.dataset.label||'这项变更';modal('撤销最近更改','<form><p>将“'+e(label)+'”恢复到变更前的状态，历史记录会保留。</p><label>撤销原因<input name="reason" maxlength="300" required></label><button class="primary" type="submit">确认撤销</button>'+button('取消','close')+'</form>',async f=>{await api('/admin/recent/'+encodeURIComponent(b.dataset.source)+'/'+encodeURIComponent(b.dataset.id)+'/undo','POST',{reason:f.get('reason')});closeModal();await management('recent')});
  }
  else if(action==='moderate-user'||action==='moderate-comment'){
   const isUser=action==='moderate-user',row=context.managementRows.find(x=>String(x.id)===b.dataset.id),kind=isUser?'users':'comments';if(!row)throw Error('记录已变化，请刷新');
   const title=isUser?(row.blocked?'解除封禁':'封禁账号'):(row.hidden?'恢复评论':'隐藏评论');
   modal(title,'<form><p>'+e(isUser?row.username:row.body)+'</p><label>操作原因<textarea name="reason" maxlength="300" required></textarea></label><button class="primary" type="submit">确认'+e(title)+'</button></form>',async f=>{
    await api('/admin/'+kind+'/'+row.id+(isUser?'/block':'/moderate'),'POST',{version:isUser?row.moderation_version:row.version,reason:f.get('reason'),...(isUser?{blocked:!row.blocked}:{hidden:!row.hidden})});await management(kind);
   });
  }else if(action==='new-document'){if(needUser())location.hash='/new/'+b.dataset.course+'/'+b.dataset.parent}
  else if(action==='edit-document'){if(needUser())location.hash='/doc/'+context.document.id+'/edit'}
  else if(action==='download')download(exportSource(context.document),context.document.title);
  else if(action==='download-legacy-source'){
 const d=context.document;if(d.render_mode!=='markdown'){download(d.tex,d.title+'-原格式','latex');return}
 const history=await api('/documents/'+d.id+'/history');const entry=history.revisions.find(r=>r.version===d.source.imported_version);if(!entry)throw Error('导入时源码修订未找到，请从保留的原始资料核对。');
 const {revision:r}=await api('/documents/'+d.id+'/revisions/'+entry.id);download(r.tex,d.title+'-导入时TeX','latex');
}
  else if(action==='download-editor'){const f=$('#editor-form');download(exportSource({tex:$('#tex-source').value,preamble:f.elements.preamble.value,render_mode:f.elements.render_mode.value}),f.elements.title.value,f.elements.render_mode.value)}
  else if(action==='insert'){
   const snippets=$('#editor-form').elements.render_mode.value==='markdown'?{section:'## 标题\n',math:'\\[\n\n\\]\n',theorem:'::: theorem\n\n:::\n',proof:'::: proof\n\n:::\n'}:{section:'\\section{标题}\n',math:'\\[\n\n\\]\n',theorem:'\\begin{theorem}\n\n\\end{theorem}\n',proof:'\\begin{proof}\n\n\\end{proof}\n'};
   insertText(snippets[b.dataset.template]);
  }else if(action==='insert-link'){
   modal('插入链接','<form><label>链接文字<input name="label" required></label><label>链接地址<input name="url" required placeholder="https://… 或 #/doc/…"></label><button class="primary" type="submit">插入</button></form>',async f=>{
    const url=safeHref(f.get('url'));if(!url)throw Error('请输入有效的网页或站内页面地址');
    const esc=s=>String(s).replace(/[\\{}%&#_$]/g,c=>'\\'+c);insertText($('#editor-form').elements.render_mode.value==='markdown'?'['+String(f.get('label')).replace(/[\[\]\\]/g,'\\$&')+']('+url.replace(/[()]/g,c=>encodeURIComponent(c))+')':'\\href{'+esc(url)+'}{'+esc(f.get('label'))+'}');closeModal();
   });
  }else if(action==='quick-preview'){const f=$('#editor-form');if(f.elements.render_mode.value==='markdown'){await f.compilePreview();return}f.invalidatePreview();$('#tex-preview').innerHTML=texHTML($('#tex-source').value,f.elements.preamble.value);renderEmbeddedPDFs($('#tex-preview'));$('#preview-status').textContent='快速网页预览'}
  else if(action==='compile-preview')await $('#editor-form').compilePreview();
  else if(action==='recent-history'){closeModal();location.hash='/doc/'+b.dataset.document+'/history'}
  else if(action==='diff-expand'){
   const root=b.closest('[data-comparison-root]'),text=root?.diffFolds?.[Number(b.dataset.fold)];
   if(text!==undefined)b.replaceWith(document.createTextNode(text));
  }
  else if(action==='recent-compare'){
   modal(b.dataset.to?'查看本次改动':'与最新版比较','<div id="recent-comparison"></div>'+button('查看全部历史版本','recent-history','data-document="'+e(b.dataset.document)+'"'));
   await loadComparison($('#recent-comparison'),b.dataset.document,b.dataset.revision,b.dataset.to||'latest');
  }
  else if(action==='compare'){
   await loadComparison($('#revision-detail'),context.document.id,b.dataset.revision);
  }else if(action==='download-revision')download(exportSource(context.revision),context.revision.title);
  else if(action==='restore-revision'){
   if(!needUser())return;const d=context.document,r=context.revision;
   modal('恢复版本 '+r.version,'<form><p>恢复后生成新版本，现有历史保留。</p><button class="primary" type="submit">确认恢复</button></form>',async()=>{await api('/documents/'+d.id+'/restore','POST',{revisionId:r.id,version:d.version});closeModal();await render()});
  }else if(action==='protect'){const d=context.document;await api('/documents/'+d.id+'/protect','POST',{protected:!d.protected,version:d.version});await render()}
  else if(action==='archive-page'||action==='restore-page'){
   const d=context.document,c=context.course,remove=action==='archive-page';
   modal(remove?'移除页面':'恢复页面','<form><p>'+e((remove?'移除':'恢复')+'“'+d.title+'”')+(remove?'？下级页面一同从目录隐藏，正文和历史保留。':'？')+'</p><button class="primary" type="submit">确认'+(remove?'移除':'恢复')+'</button></form>',async()=>{
    await api('/documents/'+d.id+(remove?'/archive':'/restore-page'),'POST',{version:d.version});closeModal();location.hash='/course/'+c.id;if(location.hash==='#/course/'+c.id)await render();
   });
  }else if(action==='archived-pages'){
   modal('已移除页面',context.archived?.length?'<div class="archive-list">'+context.archived.map(d=>'<div>'+e(d.title)+button('恢复','restore-archived-page','data-id="'+d.id+'" data-version="'+d.version+'"')+'</div>').join('')+'</div>':'<p>暂无已移除页面。</p>');
  }else if(action==='restore-archived-page'){await api('/documents/'+b.dataset.id+'/restore-page','POST',{version:Number(b.dataset.version)});closeModal();await render()}
 }catch(err){error(err)}
});
document.querySelector('.skip').addEventListener('click',ev=>{ev.preventDefault();const main=$('#main');if(main){main.setAttribute('tabindex','-1');main.focus()}});
$('.search').onsubmit=ev=>{ev.preventDefault();location.hash='/search/'+encodeURIComponent($('#search').value.trim())};
$('#modal').addEventListener('cancel',ev=>{const compose=$('#forum-compose')||$('#atlas-compose');if(compose&&(compose.dataset.pending==='true'||dirty)){ev.preventDefault();closeModal()}});
window.addEventListener('beforeunload',ev=>{if(dirty){ev.preventDefault();ev.returnValue=''}});
window.addEventListener('hashchange',()=>{
 if(skipHash){skipHash=false;return}
 if($('#atlas-compose')?.dataset.pending==='true'||[...document.querySelectorAll('#guide-share-form,[data-guide-comment-form]')].some(f=>f.dataset.pending==='true')){skipHash=true;location.hash=lastHash;return}
 if(dirty&&!confirm('有尚未保存的修改，确定离开吗？')){skipHash=true;location.hash=lastHash;return}
 dirty=false;if($('#atlas-compose'))closeModal();lastHash=location.hash;context={};window.scrollTo(0,0);render();
});
forum=createDiscussionUI({api,user:()=>state.user,modal,closeModal,refresh:()=>render(),markDirty:value=>{dirty=value}});
atlas=createAtlasUI({api,user:()=>state.user,courses:()=>state.courses,modal,closeModal,refresh:()=>render(),markDirty:value=>{dirty=value}});
document.addEventListener('click',ev=>forum.action(ev));
document.addEventListener('click',ev=>atlas.action(ev).catch(error));
const updateHeaderHeight=()=>document.documentElement.style.setProperty('--topbar-height',$('.topbar').getBoundingClientRect().height+'px');
updateHeaderHeight();
if(typeof ResizeObserver==='function')new ResizeObserver(updateHeaderHeight).observe($('.topbar'));
render();


