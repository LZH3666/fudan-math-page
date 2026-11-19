const root=document.querySelector('#app');let data;
const e=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const link=(title,route)=>'<a href="#'+e(route)+'">'+e(title)+'</a>';
const route=d=>d.is_course_home?'/course/'+d.course_id:'/doc/'+d.id;
function sidebar(selected=''){return '<aside class="subject-sidebar"><h2>目录</h2><nav>'+link('全部课程','/')+data.subjects.map((s,i)=>'<a class="side-link '+(s.id===selected?'selected':'')+'" href="#/subject/'+e(s.id)+'"><span class="side-no">'+(i+1)+'</span>'+e(s.title)+'</a>').join('')+'</nav></aside>'}
function layout(body,selected=''){return '<div class="layout">'+sidebar(selected)+'<main id="main" tabindex="-1">'+body+'</main></div>'}
function section(s){return '<section class="subject-section"><h2><span class="section-no">'+(data.subjects.indexOf(s)+1)+'</span>'+link(s.title,'/subject/'+s.id)+'</h2><ul class="course-list">'+data.courses.filter(c=>c.subject===s.id).map(c=>'<li>'+link(c.title,'/course/'+c.id)+'</li>').join('')+'</ul></section>'}
function tree(docs,parent,depth=0){return docs.filter(d=>d.parent_id===parent).flatMap(d=>[{...d,depth},...tree(docs,d.id,depth+1)])}
function render(){
 if(!data)return;let parts;try{parts=(location.hash.slice(1)||'/').split('/').filter(Boolean).map(decodeURIComponent)}catch{parts=['missing']}
 const [kind,id]=parts;let html='',title='复旦数学资源库';
 if(!kind)html=layout('<div class="page-heading"><h1>课程目录</h1></div>'+data.subjects.map(section).join(''));
 else if(kind==='subject'){const s=data.subjects.find(x=>x.id===id);html=s?layout(section(s),s.id):layout('<h1>板块不存在</h1>')}
 else if(kind==='search'){
  const q=(id||'').trim().toLocaleLowerCase();document.querySelector('#search').value=id||'';
  const docs=q?data.documents.filter(d=>(d.title+'\n'+d.tex).toLocaleLowerCase().includes(q)):[];
  html=layout('<h1>搜索</h1><ul class="course-list">'+docs.map(d=>'<li>'+link(d.title,route(d))+'</li>').join('')+'</ul>'+(docs.length?'':'<p>没有找到相关页面。</p>'));
 }else if(kind==='course'||kind==='doc'){
  const c=kind==='course'?data.courses.find(x=>x.id===id):data.courses.find(x=>x.id===data.documents.find(d=>d.id===id)?.course_id);
  const d=c&&data.documents.find(x=>x.id===(kind==='course'?c.home_id:id));
  if(c&&d){
   const docs=data.documents.filter(x=>x.course_id===c.id),s=data.subjects.find(x=>x.id===c.subject);title=d.title+' · 复旦数学资源库';
   const query=new URLSearchParams(location.search),anchor=query.get('mdDoc')===d.id?query.get('mdAnchor')||'':'';
   const body='<iframe class="banana-page" title="课程正文" sandbox="allow-same-origin allow-top-navigation-by-user-activation" src="'+e(d.readUrl+(anchor?'#'+encodeURIComponent(anchor):''))+'"></iframe>';
   html='<div class="reader-layout"><aside class="reader-sidebar">'+link(c.title,'/course/'+c.id)+'<nav class="page-tree">'+tree(docs,c.home_id).map(x=>'<a class="tree-link '+(x.id===d.id?'active':'')+'" style="--depth:'+x.depth+'" href="#/doc/'+e(x.id)+'">'+e(x.title)+'</a>').join('')+'</nav></aside><main class="reading-main" id="main"><div class="crumb">'+link('课程目录','/')+' / '+link(s?.title||'', '/subject/'+c.subject)+' / '+link(c.title,'/course/'+c.id)+(d.is_course_home?'':' / '+e(d.title))+'</div><div class="page-heading"><h1>'+e(d.title)+'</h1></div><article class="page-body">'+body+'</article><ul class="subpages">'+docs.filter(x=>x.parent_id===d.id).map(x=>'<li>'+link(x.title,route(x))+'</li>').join('')+'</ul></main></div>';
  }else html=layout('<h1>页面不存在</h1>');
 }else html=layout('<h1>页面不存在</h1>');
 root.innerHTML=html;document.title=title;window.scrollTo(0,0);
}
document.querySelector('.search').onsubmit=ev=>{ev.preventDefault();location.hash='/search/'+encodeURIComponent(document.querySelector('#search').value.trim())};
window.addEventListener('hashchange',()=>{if(location.hash!=='#main')render()});
try{const r=await fetch('/snapshot.json');if(!r.ok)throw Error('读取失败');data=await r.json();const doc=new URLSearchParams(location.search).get('mdDoc');if(doc&&!location.hash)location.hash='/doc/'+encodeURIComponent(doc);render()}catch{root.innerHTML='<main><h1>课程目录暂时无法加载</h1><p>请刷新重试。</p></main>'}
