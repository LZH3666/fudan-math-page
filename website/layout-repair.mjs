import {titleSpacing} from './markdown-compat.mjs';
import {createHash} from 'node:crypto';
export const digest=s=>createHash('sha256').update(s).digest('hex');
export const stable=(kind,s)=>'layout-'+kind+'-'+digest(s).slice(0,32);
const normalize=s=>s.replaceAll('_',' ').replace(/\s+/g,'').replaceAll('：',':');
export function sourcePath(url){return normalize(decodeURIComponent(url.split('/wiki/')[1]||'').replace(/^用户:Solution\//,''));}
// Balanced braces are required: comment bodies contain nested TeX groups.
export function remarks(source){
 let out='',cursor=0;const re=/\{\{(comment|warning)\s*\|/g;let m;
 while((m=re.exec(source))){let depth=2,i=re.lastIndex;
  for(;i<source.length&&depth;i++){if(source[i]==='\\'){i++;continue}if(source[i]==='{')depth++;if(source[i]==='}')depth--;}
  if(depth)throw Error('Unclosed comment template');
  out+=source.slice(cursor,m.index)+'\\begin{remark}'+(m[1]==='warning'?'[注意]':'')+'\n'+remarks(source.slice(re.lastIndex,i-2))+'\n\\end{remark}';cursor=i;re.lastIndex=i;
 }
 return (out+source.slice(cursor)).replace(/(\\(?:begin|end|newtheorem\*?)\{)([a-z0-9]*comment)(\})/gi,(_,a,n,b)=>a+n.replace(/comment$/i,'remarknote')+b);
}
export function formatSource(source){
 let s=remarks(source);
 const full=/\\documentclass/.test(s);
 if(full){
  const merged=(s.match(/\\begingroup\\let\\newcommand\\bsnewcommand/g)||[]).length>1;
  s=s.replace(/\\section\{([^\n]+)\}\s*\\noindent\\bsurl\{[^\n]*\}\\par\\medskip/g,(_,title)=>'\\section*{'+title+'}\n'+(merged?'\\ifnum\\value{secnumdepth}>0\\stepcounter{section}\\fi\n':''));
  s=s.replace(/^\\noindent\\bsurl\{[^\n]*\}\\par\\medskip\s*$/gm,'');
  s=s.replace(/\\newcommand\{\\bsurl\}\[1\]\{\\href\{#1\}\{原网页\}\}/g,'\\newcommand{\\bsurl}[1]{}');
  if(!merged)s=s.replace('\\begin{document}','\\begin{document}\n\\renewcommand{\\thesection}{\\arabic{section}}');
  s=s.replace(/\\section\{(第[一二三四五六七八九十百0-9]+[课讲章][^\n]*)\}/g,'\\refstepcounter{section}\n\\section*{$1}');
  if(/\\begin\{remark\}/.test(s)&&! /\\newtheorem\*?\{remark\}/.test(s))s=s.replace('\\begin{document}','\\newtheorem*{remark}{注}\n\\begin{document}');
  // This standalone diagram followed prose in the same paragraph and overflowed.
  s=s.replace(/\\begin\{tikzpicture\}\[x=0\.75pt,y=0\.75pt,yscale=-1,xscale=1\]([\s\S]*?)\\end\{tikzpicture\}/g,(all,body)=>body.includes('line')&&body.includes('479,52.39')?'\\par\n\\begin{center}\n\\begin{adjustbox}{max width=\\linewidth}\n'+all+'\n\\end{adjustbox}\n\\end{center}\n':all);
  if(s.includes('\\begin{adjustbox}')&&!/\\usepackage(?:\[[^\]]*\])?\{adjustbox\}/.test(s))s=s.replace('\\begin{document}','\\usepackage{adjustbox}\n\\begin{document}');
 }
 return s;
}
export function headings(source){
 const out=[];const re=/^(?:\\((?:sub)*section)(\*?)\{([^\n]*)\}|(={2,})\s*(.*?)\s*\4\s*$)/gm;let m;
 while((m=re.exec(source)))out.push({start:m.index,end:re.lastIndex,title:m[3]||m[5],level:m[1]?(m[1].length-7)/3+1:m[4].length-1,text:m[0]});
 return out;
}
export function datedTitle(title){
 let t=titleSpacing(title).replace(/\$\\sim\$/g,'–').replace(/(Autumn|Fall|Spring|Summer|Winter)\s+(20\d{2})/gi,(_,term,year)=>year+({autumn:'秋',fall:'秋',spring:'春',summer:'夏',winter:'冬'}[term.toLowerCase()])+'季').replace(/\\ /g,' ').replace(/(\d{2,4})\s*(?:--|–|—|-)\s*(\d{2,4})/g,(_,a,b)=>(a.length===2?'20'+a:a)+'–'+(b.length===2?'20'+b:b));
 t=t.replace(/^(\d{2})(?=\s*[春秋冬夏年])/, '20$1').replace(/\\(?:textbf|textit)\{([^{}]*)\}/g,'$1').trim();
 if(! /(?:19|20)\d{2}/.test(t))t+='（年份未注明）';
 return t;
}
export function formatExamSource(source){
 let s=formatSource(source);
 // A paper is now independent: its title cannot supply an artificial section 1.
 if(!/\\section\{/.test(s)){
  const used=new Set([...s.matchAll(/\\begin\{([^{}]+)\}/g)].map(m=>m[1]));
  s=s.replace(/(\\newtheorem\{([^{}]+)\}\{[^{}]+\})\[section\]/g,(all,declaration,name)=>used.has(name)?declaration:all);
  s=s.replace(/\\(subsubsection|subsection)\{/g,(_,kind)=>'\\'+(kind==='subsubsection'?'subsection':'section')+'{');
 }
 return s;
}
export function splitExams(doc){
 if(!/试卷|试题|期末试卷|期中和平时测试/.test(doc.title))return null;
 const all=headings(doc.tex).filter(h=>h.title!==doc.title);
 let hs=all.filter(h=>/(?:19|20)\d{2}|20\d\?/.test(h.title)||/^\s*\d{2}\s*(?:--|-|春|秋|年)/.test(h.title));
 if(!hs.length)for(const m of doc.tex.matchAll(/\\begin\{center\}[\s\S]*?\\end\{center\}/g)){
  const date=/(?:19|20)\d{2}[^\n{}]*?(?:期中|期末)[^\n{}]*?(?:试卷|试题)/.exec(m[0]);
  if(date){const h={start:m.index,end:m.index,title:date[0].replace(/\\\\.*$/,'').trim(),level:1,text:''};all.push(h);hs.push(h);}
 }
 if(!hs.length)return null;
 const level=Math.min(...hs.map(h=>h.level));hs=all.filter(h=>h.level===level&&(hs.includes(h)||/^(?:\?年|其他.*试题|其他笔试|面试问题|年份不详|年份未注明)/.test(h.title)));
 // Even one dated paper gets a named child, keeping its exam collection as parent.
 const full=/\\documentclass/.test(doc.tex),end=full?doc.tex.lastIndexOf('\\endgroup'):doc.tex.length;
 if(end<hs.at(-1).end)throw Error('Exam footer boundary: '+doc.title);
 const prefix=doc.tex.slice(0,hs[0].start),suffix=doc.tex.slice(end),seen=new Map();
 const children=hs.map((h,i)=>{let title=datedTitle(h.title),n=(seen.get(title)||0)+1;seen.set(title,n);if(n>1)title+='（第'+n+'份）';
  const stop=i+1<hs.length?hs[i+1].start:end,body=doc.tex.slice(h.end,stop);
  // Retain exact body slices; headings now serve as unnumbered paper labels.
  return {id:stable('exam',doc.id+'\0'+i+'\0'+h.title),title,tex:prefix+(full?'\\subsection*{'+h.title+'}':'== '+h.title+' ==')+body+suffix,preamble:doc.preamble,parent_id:doc.id,position:i,slice:{start:h.end,end:stop,hash:digest(body)}};
 });
 return {prefix,suffix,children,headings:hs};
}
export function hierarchyPlan(snapshot){
 const docs=structuredClone(snapshot.docs),courses=structuredClone(snapshot.courses),newCourses=[],newDocs=[];
 const sourceById=new Map(snapshot.sources.map(s=>[s.document_id,s]));
 function parent(course,title){let d=docs.find(d=>d.course_id===course.id&&normalize(d.title)===normalize(title));if(d)return d;
  d={id:stable('page',course.id+'\0'+title),course_id:course.id,type:'page',title,tex:'',version:0,position:0,protected:0,archived:0,parent_id:course.home_id,preamble:'',render_mode:'web',artifact:'',is_course_home:0};docs.push(d);newDocs.push(d);return d;
 }
 function course(title,old){let c=courses.find(c=>normalize(c.title)===normalize(title));if(c)return c;
  const id=stable('course',title);c={id,title,subject:old.subject,position:old.position+1,home_id:stable('home',id),version:1,archived:0};courses.push(c);newCourses.push(c);
  const h={id:c.home_id,course_id:id,type:'page',title,tex:'',version:0,position:0,protected:0,archived:0,parent_id:null,preamble:'',render_mode:'web',artifact:'',is_course_home:1};docs.push(h);newDocs.push(h);return c;
 }
 for(const d of docs.slice()){
  if(!sourceById.has(d.id))continue;const old=courses.find(c=>c.id===d.course_id);if(!old)continue;
  const t=normalize(d.title).replaceAll('Ⅰ','I').replaceAll('Ⅱ','II');let target;
  if(/^(习题|试卷):抽象代数II(?:$|\()/.test(t))target='抽象代数 II';
  if(/^(习题|试卷):拓扑学\(?II\)?$/.test(t))target='拓扑学 II';
  const prob=/^(?:习题|试卷):现代概率论基础(II|I)$/.exec(t);if(prob)target='现代概率论基础 '+prob[1];
  if(target){const dest=course(target,old);d.course_id=dest.id;d.parent_id=dest.home_id;}
 }
 const pathDocs=new Map(docs.filter(d=>sourceById.has(d.id)).map(d=>[sourcePath(sourceById.get(d.id).url),d]));
 for(const d of docs.slice()){
  if(!sourceById.has(d.id))continue;const c=courses.find(c=>c.id===d.course_id);if(!c)continue;
  const p=sourcePath(sourceById.get(d.id).url),slash=p.lastIndexOf('/');
  if(slash>0){const pth=p.slice(0,slash);let par=pathDocs.get(pth);
   if(!par&&d.title.includes('/'))par=parent(c,d.title.slice(0,d.title.lastIndexOf('/')));
   if(par&&par.id!==d.id&&par.course_id===d.course_id){d.parent_id=par.id;d.title=d.title.includes('/')?d.title.slice(d.title.lastIndexOf('/')+1):d.title;}
  }
  const chapter=/^习题:\s*(泛函分析|数理方程)\s*((?:第[一二三四五六七八九十]+章)|附录)/.exec(d.title);
  if(chapter){d.parent_id=parent(c,'习题: '+chapter[1]).id;d.title=chapter[2];}
  const mod=/^习题:\s*现代代数学II\s*模论\s*\(([iv]+)\)$/.exec(d.title);
  if(mod){d.parent_id=parent(c,'习题: 现代代数学II 模论').id;d.title='模论 ('+mod[1]+')';}
 }
 return {docs,courses,newCourses,newDocs};
}

