import {escapeHtml as e,safeHref} from './tex.js';
// Deliberately small Markdown subset: raw HTML is always text; math never trusts URLs/HTML.
export function discussionMarkdown(source,katex){
 if(typeof source!=='string'||source.length>20000)return '<p>正文超过20000字。</p>';
 const math=(s,display)=>{try{return katex.renderToString(s,{displayMode:display,throwOnError:false,trust:false,strict:'ignore',maxExpand:200,maxSize:10})}catch{return '<code>'+e(s)+'</code>'}};
 function inline(s,depth=0){
  if(depth>4)return e(s);let out='';
  const re=/`([^`\n]+)`|\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\\([\\`*$[\]])/g;
  let end=0;for(const m of s.matchAll(re)){out+=e(s.slice(end,m.index)).replace(/\n/g,'<br>');
   if(m[1]!==undefined)out+='<code>'+e(m[1])+'</code>';
   else if(m[2]!==undefined)out+=math(m[2],true);
   else if(m[3]!==undefined)out+=math(m[3],false);
   else if(m[4]!==undefined){const href=safeHref(m[5]);out+=href?'<a rel="nofollow noopener noreferrer" href="'+e(href)+'">'+e(m[4])+'</a>':e(m[0])}
   else if(m[6]!==undefined)out+='<strong>'+inline(m[6],depth+1)+'</strong>';
   else if(m[7]!==undefined)out+='<em>'+inline(m[7],depth+1)+'</em>';
   else out+=e(m[8]);end=m.index+m[0].length;
  }return out+e(s.slice(end)).replace(/\n/g,'<br>');
 }
 const lines=source.replace(/\r\n?/g,'\n').split('\n');let out='',paragraph=[];
 const flush=()=>{if(paragraph.length){out+='<p>'+inline(paragraph.join('\n'))+'</p>';paragraph=[]}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^```/.test(line)){flush();const code=[];while(++i<lines.length&&!/^```\s*$/.test(lines[i]))code.push(lines[i]);out+='<pre><code>'+e(code.join('\n'))+'</code></pre>';continue}
  if(line.trim()==='$$'){flush();const formula=[];while(++i<lines.length&&lines[i].trim()!=='$$')formula.push(lines[i]);out+=math(formula.join('\n'),true);continue}
  if(!line.trim()){flush();continue}
  const heading=/^(#{1,3})\s+(.+)$/.exec(line);if(heading){flush();const n=heading[1].length+1;out+='<h'+n+'>'+inline(heading[2])+'</h'+n+'>';continue}
  if(/^>\s?/.test(line)){flush();out+='<blockquote>'+inline(line.replace(/^>\s?/,''))+'</blockquote>';continue}
  const item=/^\s*(?:([-+*])|([0-9]+)[.)])\s+(.+)$/.exec(line);
  if(item){flush();const ordered=!!item[2],tag=ordered?'ol':'ul';out+='<'+tag+(ordered?' start="'+Math.min(Number(item[2]),100000)+'"':'')+'>';
   let current=item;for(;;){out+='<li>'+inline(current[3])+'</li>';const next=/^\s*(?:([-+*])|([0-9]+)[.)])\s+(.+)$/.exec(lines[i+1]||'');if(!next||!!next[2]!==ordered)break;current=next;i++}out+='</'+tag+'>';continue}
  paragraph.push(line);
 }flush();return out;
}
