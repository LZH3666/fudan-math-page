export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function safeHref(value) {
 const url=String(value).replace(/\\([%#$&_{}])/g,'$1').trim();
 if(safePDF(url))return url;
 if(/^#\/(?:course|doc|subject)\//.test(url)||url==='#/')return url;
 try{const parsed=new URL(url);if(['https:','http:','mailto:'].includes(parsed.protocol))return parsed.href}catch{}
 return null;
}
export function safeImage(value) {
 const url=String(value).replace(/\\([%#$&_{}])/g,'$1').trim();
 if(/^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(url))return url;
 try{const parsed=new URL(url);if(parsed.protocol==='https:')return parsed.href}catch{}
 return null;
}
export function safePDF(value){return /^\/media\/[a-f0-9]{64}\.pdf$/.test(String(value).trim())?String(value).trim():null}
// This is a bounded TeX-to-web reader, not a TeX interpreter. All prose is escaped.
export function renderTex(input, katex) {
 const warnings=new Set(), headings=[], labels=new Map(), references=[], macros={};
 const environments={theorem:'定理',lemma:'引理',proposition:'命题',corollary:'推论',definition:'定义',example:'例',remark:'注',proof:'证明'};
 const counters={};let currentLabel='1',serial=0,equations=0;
 const warn=s=>warnings.add(s);
 if(input.length>200000)return {html:'',warnings:['源码超过 200000 字，请拆分章节。'],headings:[]};
 // A percent sign starts a comment only when preceded by an even number of slashes.
 const source=input.replace(/(^|[^\r\n]*?)(?=\r?$)/gm,line=>{
  for(let i=0;i<line.length;i++)if(line[i]==='%'){let n=0;for(let j=i-1;j>=0&&line[j]==='\\';j--)n++;if(n%2===0)return line.slice(0,i)}
  return line;
 });
 function group(s,start,open='{',close='}') {
  while(/\s/.test(s[start]||'')&&start<s.length)start++;
  if(s[start]!==open)return null;
  let depth=1;
  for(let i=start+1;i<s.length;i++){if(s[i]==='\\'){i++;continue}if(s[i]===open)depth++;if(s[i]===close&&--depth===0)return{value:s.slice(start+1,i),end:i+1}}
  warn('有未闭合的 '+open+close+'。');return null;
 }
 function math(tex,display) {
  tex=tex.replace(/\\label\{([^{}]+)\}/g,(_,id)=>{warn('未编号公式中的引用 '+id+' 无法确定编号。');return ''});
  try{return '<span class="'+(display?'tex-display':'tex-inline')+'">'+katex.renderToString(tex,{displayMode:display,throwOnError:true,trust:false,strict:'error',maxExpand:500,maxSize:20,macros:{...macros},output:'htmlAndMathml'})+'</span>'}
  catch(e){warn('公式未能排版：'+String(e.message).slice(0,220));return '<code class="tex-error">'+escapeHtml(tex)+'</code>'}
 }
 // Split only outer rows; line breaks inside matrices or brace groups stay intact.
 function mathRows(s) {
  const rows=[];let start=0,braces=0,environments=0;
  for(let i=0;i<s.length;i++){
   if(s[i]==='\\'){
    const env=/^\\(begin|end)\{[^{}]+\}/.exec(s.slice(i));
    if(env){environments+=env[1]==='begin'?1:-1;i+=env[0].length-1;continue}
    if(s[i+1]==='\\'&&braces===0&&environments===0){
     rows.push(s.slice(start,i));i++;start=i+1;continue;
    }
    if(s[i+1]&&'\\{}%'.includes(s[i+1]))i++;
   }else if(s[i]==='{')braces++;else if(s[i]==='}')braces--;
  }
  rows.push(s.slice(start));return rows;
 }
 function mathEnvironment(name,body) {
  const base=name.replace(/\*$/,''),numbered=!name.endsWith('*');
  const rows=base==='equation'?[body]:mathRows(body);
  const rendered=rows.map(row=>{
   const tag=/\\tag\*?\s*\{([^{}]*)\}/.exec(row);
   const suppressed=/\\(?:notag|nonumber)\b/.test(row);
   // Empty trailing rows do not create an extra number.
   const meaningful=row.replace(/\\label\{[^{}]+\}/g,'').trim();
   let number=tag?.[1]??null;
   if(numbered&&!suppressed&&meaningful){equations++;if(number===null){number=String(equations);row+='\\tag{'+number+'}'}}
   row=row.replace(/\\label\{([^{}]+)\}/g,(_,id)=>{
    if(number!==null)labels.set(id,number);else warn('未编号公式中的引用 '+id+' 无法确定编号。');
    return '';
   });
   return row;
  }).join('\\\\');
  return math('\\begin{'+base+'*}'+rendered+'\\end{'+base+'*}',true);
 }
 function environment(s,start,name) {
  const pattern=/\\(begin|end)\{([^{}]+)\}/g;pattern.lastIndex=start;let depth=1,m;
  while((m=pattern.exec(s)))if(m[2]===name){depth+=m[1]==='begin'?1:-1;if(depth===0)return{value:s.slice(start,m.index),end:pattern.lastIndex}}
  warn('环境 '+name+' 未闭合。');return null;
 }
 function list(s,ordered,depth) {
  const marks=[], re=/\\(?:begin\{[^{}]+\}|end\{[^{}]+\}|item\b)/g;let nesting=0,m;
  while((m=re.exec(s))){if(m[0].startsWith('\\begin'))nesting++;else if(m[0].startsWith('\\end'))nesting--;else if(nesting===0)marks.push({start:m.index,end:re.lastIndex})}
  if(!marks.length){warn('列表中缺少 \\item。');return parse(s,depth+1)}
  const tag=ordered?'ol':'ul';return '<'+tag+'>'+marks.map((p,i)=>'<li>'+parse(s.slice(p.end,marks[i+1]?.start??s.length).trim(),depth+1)+'</li>').join('')+'</'+tag+'>';
 }
 function parse(s,depth=0) {
  if(depth>30){warn('嵌套层级过多。');return escapeHtml(s)}
  let html='',i=0;
  while(i<s.length){
   if(s[i]==='$'){
    const delim=s[i+1]==='$'?'$$':'$';let end=i+delim.length;
    while((end=s.indexOf(delim,end))>=0){let n=0;for(let j=end-1;j>=0&&s[j]==='\\';j--)n++;if(n%2===0)break;end+=delim.length}
    if(end<0){warn('公式分隔符 '+delim+' 未闭合。');html+=escapeHtml(s.slice(i));break}
    html+=math(s.slice(i+delim.length,end),delim==='$$');i=end+delim.length;continue;
   }
   if(s[i]!=='\\'){
    let end=i+1;while(end<s.length&&s[end]!=='\\'&&s[end]!=='$')end++;
    html+=escapeHtml(s.slice(i,end)).replace(/\n[ \t]*\n/g,'<span class="tex-gap"></span>').replace(/\r?\n/g,' ');i=end;continue;
   }
   const next=s[i+1];
   if(next==='('||next==='['){
    const end=s.indexOf(next==='('? '\\)' : '\\]',i+2);
    if(end<0){warn('公式分隔符未闭合。');html+=escapeHtml(s.slice(i));break}
    html+=math(s.slice(i+2,end),next==='[');i=end+2;continue;
   }
   if(next==='\\'){html+='<br>';i+=2;continue}
   if(next&&'%$&#_{} '.includes(next)){html+=escapeHtml(next);i+=2;continue}
   const command=/^\\([A-Za-z]+)(\*)?/.exec(s.slice(i));
   if(!command){html+='&#92;';i++;continue}
   const name=command[1],star=!!command[2],begin=i;i+=command[0].length;
   if(name==='href'||name==='url'){
    const target=group(s,i),caption=target&&name==='href'?group(s,target.end):null;
    if(target&&(name==='url'||caption)){
     const href=safeHref(target.value),label=name==='url'?escapeHtml(target.value.replace(/\\([%#$&_{}])/g,'$1')):parse(caption.value,depth+1);
     if(href)html+='<a href="'+escapeHtml(href)+'"'+(href.startsWith('#')?'':' target="_blank" rel="noopener noreferrer"')+'>'+label+'</a>';
     else{warn('链接地址不支持，请使用 http、https、mailto 或站内页面链接。');html+=label}
     i=caption?.end??target.end;continue;
    }
   }
   if(name==='includepdf'){
    const options=group(s,i,'[',']'),a=group(s,options?.end??i);
    if(a){
     const src=safePDF(a.value);
     if(options&&options.value.replace(/\s/g,'')!=='pages=-')warn('网页 PDF 阅读显示全部页，其他选项不适用。');
     if(src)html+='<div class="embedded-pdf" data-pdf="'+escapeHtml(src)+'"><a href="'+escapeHtml(src)+'" target="_blank" rel="noopener">打开 / 下载 PDF</a></div>';
     else{warn('PDF 地址不支持，请先上传 PDF 附件。');html+=escapeHtml(s.slice(begin,a.end))}
     i=a.end;continue;
    }
   }
   if(name==='includegraphics'){
    const options=group(s,i,'[',']'),a=group(s,options?.end??i);
    if(a){
     const src=safeImage(a.value);let width='100%';
     if(options){const m=/width\s*=\s*(0?\.\d+|1(?:\.0+)?)\\(?:textwidth|linewidth)/.exec(options.value);if(m)width=(Number(m[1])*100)+'%';else if(options.value.trim())warn('网页预览的图片宽度请使用 width=0.8\\textwidth，其他排版选项请使用完整 LaTeX。')}
     if(src)html+='<img class="tex-image" src="'+escapeHtml(src)+'" alt="正文插图" loading="lazy" style="width:'+width+'">';
     else{warn('图片地址不支持，请上传图片或使用 HTTPS 图片地址。');html+=escapeHtml(s.slice(begin,a.end))}
     i=a.end;continue;
    }
   }
   if(name==='centering')continue;
   if(name==='par'){html+='<span class="tex-gap"></span>';continue}
   if(name==='LaTeX'||name==='TeX'){html+=name;continue}
   if(name==='maketitle'){continue}
   if(name==='newcommand'||name==='renewcommand'){
    const a=group(s,i);if(a&&/^\\[A-Za-z]+$/.test(a.value)){let pos=a.end;const count=group(s,pos,'[',']');if(count)pos=count.end;const def=group(s,pos);if(def){macros[a.value]=def.value;i=def.end;continue}}
    warn('宏定义格式暂不支持。');html+=escapeHtml(command[0]);continue;
   }
   if(name==='newtheorem'){
    const a=group(s,i),b=a&&group(s,a.end);
    if(a&&b&&/^[A-Za-z]+$/.test(a.value)){environments[a.value]=b.value;i=b.end;continue}
    warn('仅支持 \\newtheorem{名称}{标题}。');html+=escapeHtml(command[0]);continue;
   }
   if(name==='begin'){
    const a=group(s,i);
    if(a){const env=environment(s,a.end,a.value);if(env){i=env.end;
     if(a.value==='document'){html+=parse(env.value,depth+1);continue}
     if(['figure','center'].includes(a.value)){html+='<figure>'+parse(env.value.replace(/^\s*\[[^\]]*\]/,''),depth+1)+'</figure>';continue}
     if(['equation','equation*','align','align*','gather','gather*'].includes(a.value)){
      html+=mathEnvironment(a.value,env.value);continue;
     }
     if(a.value==='itemize'||a.value==='enumerate'){html+=list(env.value,a.value==='enumerate',depth);continue}
     if(Object.hasOwn(environments,a.value)){
      const title=group(env.value,0,'[',']'),content=title?env.value.slice(title.end):env.value;
      const n=a.value==='proof'?'':String(counters[a.value]=(counters[a.value]||0)+1);
      if(n)currentLabel=n;
      html+='<div class="tex-theorem"><strong>'+escapeHtml(environments[a.value]+(n?' '+n:'')+(title?'（'+title.value+'）':'')+'。')+'</strong> '+parse(content,depth+1)+(a.value==='proof'?'<span class="qed">□</span>':'')+'</div>';continue;
     }
     warn('尚不支持环境 '+a.value+'，已保留原文。');html+='<pre class="tex-unknown">'+escapeHtml(s.slice(begin,i))+'</pre>';continue;
    }}
   }
   const a=group(s,i);
   if(a){
    if(['chapter','section','subsection','subsubsection','title'].includes(name)){
     const level={chapter:2,section:2,subsection:3,subsubsection:4,title:2}[name];serial++;currentLabel=String(serial);const id='tex-heading-'+serial;
     headings.push({id,title:a.value});html+='<h'+level+' id="'+id+'">'+parse(a.value,depth+1)+'</h'+level+'>';i=a.end;continue;
    }
    if(name==='caption'){html+='<figcaption>'+parse(a.value,depth+1)+'</figcaption>';i=a.end;continue}
    if(['textbf','textit','emph','texttt','underline'].includes(name)){
     const tag={textbf:'strong',textit:'em',emph:'em',texttt:'code',underline:'u'}[name];html+='<'+tag+'>'+parse(a.value,depth+1)+'</'+tag+'>';i=a.end;continue;
    }
    if(name==='label'){labels.set(a.value,currentLabel);i=a.end;continue}
    if(name==='ref'||name==='eqref'){const token='TEXREF'+references.length+'END';references.push({token,label:a.value,equation:name==='eqref'});html+='<span data-tex-ref="'+token+'"></span>';i=a.end;continue}
   }
   warn('尚不支持命令 \\'+name+'，已保留原文。');html+=escapeHtml(command[0]);
  }
  return html;
 }
 let html=parse(source);
 for(const r of references){const val=labels.get(r.label);if(!val)warn('未找到引用 '+r.label+'。');html=html.replace('<span data-tex-ref="'+r.token+'"></span>',escapeHtml(r.equation?'('+(val??'??')+')':val??'??'))}
 return{html,warnings:[...warnings],headings};
}

