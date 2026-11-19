import {escapeHtml as e} from './tex.js';
import {renderPDF} from './pdf.js';
export function shareResources(r){return '<div class="guide-resources">'+(r.attachments||[]).map(f=>'<div class="guide-attachment"><span class="guide-attachment-name">'+e(f.name)+'</span><span class="guide-attachment-actions"><button type="button" class="outline-button" data-guide="file" data-entry="'+e(r.id)+'" data-file="'+e(f.id)+'">预览</button><a href="'+e(f.url)+'" download>下载</a></span></div>').join('')+(r.links||[]).map(url=>'<p><a href="'+e(url)+'" target="_blank" rel="nofollow noopener noreferrer">'+e(url)+'</a></p>').join('')+'</div>';}
const readBase64=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('附件读取失败'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file)});
export function createGuideInteractions({api,user,markdown,modal,closeModal,markDirty,records}){
 const admin=()=>user()?.canEdit&&user()?.role==='admin';
 const forms=()=>[...document.querySelectorAll('#guide-share-form,[data-guide-comment-form]')];
 const dirty=()=>markDirty(forms().some(f=>f.dataset.dirty==='true'||f.dataset.pending==='true'));
 function canRefresh(except){const others=forms().filter(f=>f!==except);if(others.some(f=>f.dataset.pending==='true'))return false;if(others.some(f=>f.dataset.dirty==='true')){if(!confirm('有尚未发表的分享或评论，确定放弃后继续吗？'))return false;for(const f of others){f.dataset.dirty='false';f.reset();f.commentTarget=null;if(f.matches('[data-guide-comment-form]'))f.querySelector('[type=submit]').textContent='发表评论';if(f.id==='guide-share-form'){f.shareTarget=null;setEditorFiles(f,[])}}dirty()}return true;}
 const button=(label,action,id,extra='')=>'<button type="button" class="outline-button" data-guide="'+action+'" data-entry="'+e(id)+'" '+extra+'>'+label+'</button>';
 function controls(r){
  const enabled=user()?.canEdit&&!r.hidden,attrs=v=>'aria-pressed="'+(r.my_vote===v)+'"';
  const atlas=(label,action)=>'<button type="button" class="outline-button" data-atlas="'+action+'" data-id="'+e(r.id)+'">'+label+'</button>';
  const more=(enabled&&r.user_id===user()?.id?atlas('编辑','edit'):'')+atlas('历史版本','history')+(admin()?atlas(r.hidden?'恢复':'隐藏','moderate')+button(r.featured?'取消精华':'加精华','feature',r.id):'');
  return '<span class="guide-feature"'+(r.featured?'':' hidden')+'>精华</span><div class="guide-toolbar guide-votes">'+(enabled?button('赞 '+(r.likes||0),'up',r.id,attrs(1))+button('踩 '+(r.dislikes||0),'down',r.id,attrs(-1)):'<button data-action="account" class="outline-button">赞 '+(r.likes||0)+'</button><button data-action="account" class="outline-button">踩 '+(r.dislikes||0)+'</button>')+button('评论 '+(r.comment_count||0),'comments',r.id)+(!r.hidden?(user()?.canEdit?button('写评论','write-comment',r.id):'<button data-action="account" class="outline-button">登录后写评论</button>'):'')+'<details class="guide-more"><summary>更多</summary><div class="guide-more-actions">'+more+'</div></details></div>';
 }
 const render=r=>shareResources(r)+'<div data-guide-tools="'+e(r.id)+'">'+controls(r)+'</div><div class="guide-comments" id="guide-comments-'+e(r.id)+'" hidden></div>';
 function update(r,value){Object.assign(r,value);const root=document.querySelector('[data-guide-tools="'+r.id+'"]');if(root)root.innerHTML=controls(r);}
 function setEditorFiles(form,files){form.shareFiles=[...files];const root=form.querySelector('[data-guide-files]');if(root)root.innerHTML=form.shareFiles.map(f=>'<div>'+e(f.name)+' '+button('移除','remove-file','', 'data-file="'+e(f.id)+'"')+'</div>').join('');}
 function editorFields(){return '<label>网页链接（每行一个，选填）<textarea name="links" rows="2" maxlength="20000" placeholder="https://…"></textarea></label><label>添加 PDF / Markdown 附件<input id="guide-file-input" type="file" accept=".pdf,.md,.markdown,application/pdf,text/markdown" multiple></label><small>最多3份，每份不超过5 MB。附件随分享公开。</small><div data-guide-files></div><p data-guide-upload-status role="status"></p>';}
 function bindEditor(form){
  const picker=form.querySelector('#guide-file-input');if(!picker)return;setEditorFiles(form,form.shareFiles||[]);
  picker.onchange=async()=>{
   if(form.dataset.pending==='true')return;const files=[...picker.files];if(!files.length)return;const status=form.querySelector('[data-guide-upload-status]');
   if((form.shareFiles||[]).length+files.length>3){status.textContent='每条分享最多3个附件';picker.value='';return}
   if(files.some(f=>f.size>5*1024*1024||!/^.+\.(pdf|md|markdown)$/i.test(f.name))){status.textContent='请选择不超过5 MB的PDF或Markdown文件';picker.value='';return}
   const inputs=[...form.querySelectorAll('input,textarea,button')],disabled=inputs.map(c=>c.disabled);form.dataset.pending='true';form.dataset.dirty='true';dirty();inputs.forEach(c=>c.disabled=true);
   try{for(const file of files){status.textContent='正在上传 '+file.name;const out=await api('/atlas/uploads','POST',{name:file.name,data:await readBase64(file)});setEditorFiles(form,[...(form.shareFiles||[]),out.file])}status.textContent='附件已暂存，点击“发表分享”后与正文和链接一起公开。'}catch(err){status.textContent=err.message}finally{form.dataset.pending='false';inputs.forEach((c,i)=>c.disabled=disabled[i]);picker.value='';dirty()}
  };
 }
 const getRecord=id=>records().find(r=>r.id===id);
 const commentRow=(r,c)=>'<article class="guide-comment" id="guide-comment-'+e(c.id)+'"><small>'+e(c.username)+' · '+e(new Date(c.updated).toLocaleString('zh-CN',{hour12:false}))+(c.hidden?' · 已隐藏':'')+'</small><div class="forum-markdown">'+markdown(c.body)+'</div><div class="form-actions">'+(user()?.canEdit&&c.user_id===user().id&&!c.hidden&&!r.hidden?button('编辑评论','comment-edit',r.id,'data-comment="'+e(c.id)+'"'):'')+button('修改记录','comment-history',r.id,'data-comment="'+e(c.id)+'"')+(admin()&&!r.hidden?button(c.hidden?'恢复评论':'隐藏评论','comment-moderate',r.id,'data-comment="'+e(c.id)+'"'):'')+'</div></article>';
 async function comments(r,page=1){
  const root=document.querySelector('#guide-comments-'+r.id);if(!root)return;const oldForm=root.querySelector('[data-guide-comment-form]');if(oldForm&&(oldForm.dataset.pending==='true'||oldForm.dataset.dirty==='true'))return;
  const request=(root.commentRequest||0)+1;root.commentRequest=request;
  const out=await api('/atlas/entries/'+r.id+'/comments?page='+page);if(!root.isConnected||root.commentRequest!==request)return;
  const currentForm=root.querySelector('[data-guide-comment-form]');if(currentForm&&(currentForm.dataset.pending==='true'||currentForm.dataset.dirty==='true'))return;
  root.hidden=false;root.comments=out.comments;root.page=page;
  root.innerHTML='<h3>评论</h3>'+out.comments.map(c=>commentRow(r,c)).join('')+(out.comments.length?'':'<p>暂无评论。</p>')+'<div class="form-actions">'+(page>1?button('上一页','comment-prev',r.id):'')+(out.more?button('下一页','comment-next',r.id):'')+'</div>'+(r.hidden?'<p>该分享已隐藏，不能新增或修改评论。</p>':user()?.canEdit?'<form data-guide-comment-form="'+e(r.id)+'"><label>发表评论<textarea name="body" required maxlength="5000" rows="3"></textarea></label><div class="form-actions"><button type="submit" class="outline-button">发表评论</button><button type="button" class="outline-button" data-guide="comment-cancel" data-entry="'+e(r.id)+'">清空 / 取消编辑</button></div><p class="form-error" role="alert"></p></form>':'<button data-action="account" class="outline-button">登录后发表评论</button>');
  const form=root.querySelector('form');if(!form)return;
  form.oninput=()=>{form.dataset.dirty='true';dirty()};
  form.onsubmit=async ev=>{ev.preventDefault();if(form.dataset.pending==='true')return;const target=form.commentTarget,content=form.elements.body.value;if(!content.trim())return;form.dataset.pending='true';dirty();const inputs=[...form.querySelectorAll('textarea,button')];inputs.forEach(c=>c.disabled=true);
   try{await api('/atlas/entries/'+r.id+'/comments'+(target?'/'+target.id:''),target?'PUT':'POST',{body:content,...(target?{version:target.version}:{})});form.dataset.dirty='false';form.dataset.pending='false';form.elements.body.value='';dirty();if(!target)update(r,{comment_count:(r.comment_count||0)+1});await comments(r,page)}catch(err){form.querySelector('.form-error').textContent=err.message}finally{form.dataset.pending='false';inputs.forEach(c=>c.disabled=false);dirty()}
  };
 }
 async function action(ev){
  const b=ev.target.closest('[data-guide]');if(!b?.dataset.guide)return false;const a=b.dataset.guide,r=getRecord(b.dataset.entry);
  if(a==='remove-file'){const form=b.closest('form');if(form?.dataset.pending==='true')return true;setEditorFiles(form,(form.shareFiles||[]).filter(f=>f.id!==b.dataset.file));form.dataset.dirty='true';dirty();return true;}
  if(!r)return true;
  if(a==='file'){const file=r.attachments?.find(f=>f.id===b.dataset.file);if(!file)return true;if(file.mime==='application/pdf'){modal(file.name,'<div id="guide-pdf-preview" class="pdf-document"></div>');const viewer=document.querySelector('#guide-pdf-preview');await renderPDF(viewer,file.url,()=>document.querySelector('#modal')?.open&&viewer.isConnected)}else{const response=await fetch(file.url);if(!response.ok)throw Error('附件暂不可用');const content=await response.text();modal(file.name,(content.length>20000?'<p>此处预览前20000字；下载可查看全文。</p>':'')+'<div class="forum-markdown">'+markdown(content.slice(0,20000))+'</div><a href="'+e(file.url)+'" download>下载完整Markdown</a>')}return true;}
  if(a==='up'||a==='down'){if(!user()?.canEdit||b.disabled)return true;const value=a==='up'?1:-1;b.disabled=true;try{const out=await api('/atlas/entries/'+r.id+'/vote','POST',{value:r.my_vote===value?0:value});update(r,out.entry)}finally{b.disabled=false}return true;}
  if(a==='feature'){modal(r.featured?'取消精华':'加精华','<form><label>原因<input name="reason" required maxlength="300"></label><button type="submit">确认</button></form>',async f=>{const out=await api('/atlas/entries/'+r.id+'/feature','POST',{featured:!r.featured,version:r.version,reason:f.get('reason')});update(r,out.entry);closeModal()});return true;}
  const root=document.querySelector('#guide-comments-'+r.id);
  if(a==='write-comment'){if(r.hidden||!user()?.canEdit)return true;if(root?.querySelector('form'))root.hidden=false;else await comments(r);root?.querySelector('textarea')?.focus();return true;}
  if(a==='comments'){if(root&&!root.hidden)root.hidden=true;else if(root?.querySelector('form'))root.hidden=false;else await comments(r);return true;}
  if(a==='comment-prev'||a==='comment-next'){await comments(r,(root.page||1)+(a==='comment-prev'?-1:1));return true;}
  const c=root?.comments?.find(c=>c.id===b.dataset.comment),form=root?.querySelector('form');
  if(a==='comment-cancel'){if(form?.dataset.pending==='true')return true;form.reset();form.commentTarget=null;form.dataset.dirty='false';form.querySelector('[type=submit]').textContent='发表评论';dirty();return true;}
  if(a==='comment-edit'&&c&&form){if(form.dataset.pending==='true')return true;if(form.dataset.dirty==='true'&&!confirm('确定放弃当前评论草稿后编辑吗？'))return true;form.commentTarget=c;form.elements.body.value=c.body;form.dataset.dirty='false';form.querySelector('[type=submit]').textContent='保存评论';form.elements.body.focus();dirty();return true;}
  if(a==='comment-moderate'&&c){if(form?.dataset.pending==='true')return true;if(form?.dataset.dirty==='true'&&!confirm('确定放弃当前评论草稿后管理吗？'))return true;if(form){form.dataset.dirty='false';form.reset();form.commentTarget=null;form.querySelector('[type=submit]').textContent='发表评论';dirty()}modal(c.hidden?'恢复评论':'隐藏评论','<form><label>原因<input name="reason" required maxlength="300"></label><button type="submit">确认</button></form>',async f=>{if(form?.dataset.pending==='true')throw Error('评论正在保存');await api('/atlas/entries/'+r.id+'/comments/'+c.id+'/moderate','POST',{hidden:!c.hidden,version:c.version,reason:f.get('reason')});closeModal();update(r,{comment_count:(r.comment_count||0)+(c.hidden?1:-1)});await comments(r,root.page)});return true;}
  if(a==='comment-history'&&c){let page=1;const show=async()=>{const out=await api('/atlas/entries/'+r.id+'/comments/'+c.id+'/history?page='+page);modal('评论修改记录',out.history.map(h=>{const s=JSON.parse(h.snapshot);return '<p>'+e('版本 '+h.version+' · '+h.username)+'</p><div class="forum-markdown">'+markdown(s.body)+'</div>'}).join('')+'<div class="form-actions">'+(page>1?'<button data-history-prev>上一页</button>':'')+(out.more?'<button data-history-next>下一页</button>':'')+'</div>');for(const el of document.querySelectorAll('[data-history-prev],[data-history-next]'))el.onclick=()=>{page+=el.hasAttribute('data-history-prev')?-1:1;show().catch(err=>modal('操作未完成','<p>'+e(err.message)+'</p>'))}};await show();return true;}
  return true;
 }
 return {render,editorFields,bindEditor,setEditorFiles,canRefresh,syncDirty:dirty,action};
}
