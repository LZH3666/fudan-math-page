import {escapeHtml as e} from './tex.js';
import {discussionMarkdown} from './discussion-markdown.js';
export function createDiscussionUI({api,user,modal,closeModal,refresh,markDirty}){
 let records=[];
 const btn=(label,action,id='')=>'<button type="button" class="outline-button" data-forum="'+action+'" data-id="'+e(id)+'">'+label+'</button>';
 const date=s=>e(new Date(s).toLocaleString('zh-CN',{hour12:false}));
 const isAdmin=()=>user()?.role==='admin'&&user()?.canEdit;
 function post(p){return '<section class="forum-post"><div><b>'+e(p.username)+'</b> · '+date(p.created)+(p.hidden?' · 已隐藏':'')+(p.version>1?' · 版本 '+p.version:'')+'</div><div class="forum-markdown">'+discussionMarkdown(p.body,globalThis.katex)+'</div><div class="form-actions">'+(user()?.canEdit&&user().id===p.user_id&&!p.hidden?btn('编辑','edit',p.id):'')+(user()?.canEdit&&(user().id===p.user_id||isAdmin())?btn('编辑记录','history',p.id):'')+(isAdmin()?btn(p.hidden?'恢复':'隐藏','moderate',p.id):'')+'</div></section>'}
 const paging=(base,page,more)=>'<nav class="form-actions" aria-label="讨论分页">'+(page>1?'<a href="#'+base+'/'+(page-1)+'">上一页</a>':'')+(more?'<a href="#'+base+'/'+(page+1)+'">下一页</a>':'')+'</nav>';
 async function view(parts){
  records=[];if(!parts[1]||parts[1]==='page'){
   const page=Number(parts[2]||1),hidden=isAdmin()&&parts[3]==='hidden',out=await api('/discussion?page='+page+(hidden?'&hidden=1':''));
   return '<h1>讨论室</h1><div class="form-actions">'+(user()?.canEdit?btn('发起讨论','new'):'<button data-action="account">登录并验证邮箱后发帖</button>')+(isAdmin()?'<a href="#/discussion/page/1'+(hidden?'':'/hidden')+'">'+(hidden?'仅看公开主题':'包含隐藏主题')+'</a>':'')+'</div><ul class="forum-topics">'+out.topics.map(t=>'<li><a href="#/discussion/'+t.id+'">'+e(t.title)+'</a>'+(t.hidden?'（已隐藏）':'')+'<small>'+e(t.username)+' · '+date(t.created)+' · '+t.replies+'条回复</small></li>').join('')+'</ul>'+(out.topics.length?'':'<p>暂无讨论。</p>')+paging('/discussion/page',page,out.more).replaceAll('/'+(page-1)+'"','/'+(page-1)+(hidden?'/hidden':'')+'"').replaceAll('/'+(page+1)+'"','/'+(page+1)+(hidden?'/hidden':'')+'"');
  }
  const page=Number(parts[2]||1),out=await api('/discussion/'+encodeURIComponent(parts[1])+'?page='+page);records=[out.topic,...out.replies];
  return '<a href="#/discussion">返回讨论室</a><h1>'+e(out.topic.title)+'</h1>'+post(out.topic)+'<h2>回复</h2>'+out.replies.map(post).join('')+(out.replies.length?'':'<p>暂无回复。</p>')+paging('/discussion/'+out.topic.id,page,out.more)+(user()?.canEdit&&!out.topic.hidden?btn('回复主题','reply',out.topic.id):!user()?.canEdit?'<button data-action="account">登录并验证邮箱后回复</button>':'');
 }
 function compose(target=null,replyTo=null){
  if(!user()?.canEdit)return;const topic=!replyTo&&!target?.topic_id;
  modal(target?'编辑帖子':replyTo?'回复主题':'发起讨论','<form id="forum-compose">'+(topic?'<label>标题<input name="title" maxlength="120" required value="'+e(target?.title||'')+'"></label>':'')+'<label>正文（Markdown）<textarea name="body" maxlength="20000" rows="10" required>'+e(target?.body||'')+'</textarea></label><div class="form-actions">'+[['加粗','bold'],['列表','list'],['链接','link'],['公式','math'],['代码','code']].map(([label,action])=>btn(label,action)).join('')+'</div><small>支持标题、列表、链接、代码及 $…$ / $$…$$ 数学公式。HTML按文字显示。</small><h3>预览</h3><div id="forum-preview" class="forum-markdown"></div><button type="submit" class="primary">发布</button></form>',async form=>{
   const b=Object.fromEntries(form);if(target)b.version=target.version;
   const element=document.querySelector('#forum-compose'),controls=[...element.querySelectorAll('input,textarea,button')],disabled=controls.map(c=>c.disabled);
   element.dataset.pending='true';controls.forEach(c=>c.disabled=true);
   let out;try{out=await api('/discussion'+(target?'/'+target.id:replyTo?'/'+replyTo+'/replies':''),target?'PUT':'POST',b)}finally{element.dataset.pending='false';controls.forEach((c,i)=>c.disabled=disabled[i])}
   markDirty(false);closeModal();const hash='#/discussion/'+(out.post.topic_id||out.post.id);if(location.hash===hash)await refresh();else location.hash=hash;
  });
  const form=document.querySelector('#forum-compose'),area=form.elements.body,preview=document.querySelector('#forum-preview');let timer;
  const paint=()=>{preview.innerHTML=discussionMarkdown(area.value,globalThis.katex)};paint();form.oninput=()=>{markDirty(true);clearTimeout(timer);timer=setTimeout(()=>{if(form.isConnected)paint()},180)};
  form.onclick=ev=>{const b=ev.target.closest('[data-forum]');if(!b)return;const snippets={bold:['**','**','加粗文字'],list:['\n- ','','列表项'],link:['[','](https://example.com)','链接文字'],math:['$','$','x^2'],code:['`','`','代码']},s=snippets[b.dataset.forum];if(!s)return;area.setRangeText(s[0]+(area.value.slice(area.selectionStart,area.selectionEnd)||s[2])+s[1],area.selectionStart,area.selectionEnd,'end');area.focus();markDirty(true);paint()};
 }
 async function action(ev){const b=ev.target.closest('[data-forum]');if(!b||b.closest('#forum-compose'))return;const p=records.find(p=>p.id===b.dataset.id);
  try{if(b.dataset.forum==='new')compose();else if(b.dataset.forum==='reply')compose(null,p.id);else if(b.dataset.forum==='edit')compose(p);
   else if(b.dataset.forum==='moderate')modal(p.hidden?'恢复帖子':'隐藏帖子','<form><label>原因<input name="reason" maxlength="300" required></label><button type="submit">确认</button></form>',async f=>{await api('/discussion/'+p.id+'/moderate','POST',{hidden:!p.hidden,version:p.version,reason:f.get('reason')});closeModal();await refresh()});
   else if(b.dataset.forum==='history'){let page=1;const show=async()=>{const out=await api('/discussion/'+p.id+'/history?page='+page);modal('编辑记录',out.history.map(h=>'<section class="forum-post"><b>版本 '+h.version+'</b> · '+e(h.username)+' · '+date(h.created)+(h.hidden?' · 已隐藏':'')+'<h3>'+e(h.title)+'</h3><pre>'+e(h.body)+'</pre></section>').join('')+'<div class="form-actions">'+(page>1?btn('上一页','older-prev'):'')+(out.more?btn('下一页','older-next'):'')+'</div>');document.querySelectorAll('[data-forum^="older-"]').forEach(el=>el.onclick=event=>{event.stopPropagation();page+=el.dataset.forum==='older-next'?1:-1;show().catch(err=>modal('操作未完成','<p>'+e(err.message)+'</p>'))})};await show()}
  }catch(err){modal('操作未完成','<p>'+e(err.message)+'</p>')}
 }
 return {view,action};
}
