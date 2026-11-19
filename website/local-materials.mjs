import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const controlCourses = ['数学控制论','控制理论基础','最优化方法','线性与非线性规划'];
export const computationalCourses = ['数值代数与优化','微分方程数值解法','计算方法','数值代数及其应用','科学计算'];
export function subjectFor(record) {
 if(record.group==='应用')return controlCourses.includes(record.course)?'optimization-control':computationalCourses.includes(record.course)?'computational':'applied';
 const map={'代数':'algebra','数论和表示论':'number-representation','微分几何':'geometry','拓扑':'topology','代数几何':'ag','数学物理':'mathematical-physics','概率和统计':'probability','试题汇萃':'exams'};
 if(!map[record.group])throw Error('Unknown group: '+record.group);
 return map[record.group];
}
export function inside(root,relative) {
 const target=path.resolve(root,relative);
 if(!target.startsWith(path.resolve(root)+path.sep))throw Error('Path escapes source root');
 for(let p=target;p!==path.resolve(root);p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error('Linked source forbidden');
 return target;
}
export function splitCourse(root,record) {
 const file=inside(root,record.file),original=fs.readFileSync(file,'utf8');
 const preambleEnd=original.indexOf('\\title{');
 if(preambleEnd<0||!original.trimEnd().endsWith('\\end{document}'))throw Error('Unexpected document structure: '+record.file);
 const preamble=original.slice(0,preambleEnd);
 const pattern=/^\\section\{([^\n]+)\}\r?\n\\noindent\\bsurl\{([^\n]+)\}\\par\\medskip\r?\n/gm;
 const matches=[...original.matchAll(pattern)];
 if(matches.length!==record.articles)throw Error('Article count mismatch: '+record.file+' '+matches.length+'/'+record.articles);
 const assets=new Map();
 const pages=matches.map((m,i)=>{
  const end=i+1<matches.length?matches[i+1].index:original.lastIndexOf('\\end{document}');
  const raw=original.slice(m.index,end);
  if(!raw.includes('\\begingroup\\let\\newcommand\\bsnewcommand')||!raw.trimEnd().endsWith('\\endgroup'))throw Error('Unbalanced article wrapper: '+record.file);
  const dependencies=[];
  const body=raw.replace(/\{(\.\.\/\.\.\/(?:assets|attachments)\/[^{}]+)\}/g,(_,ref)=>{
   const asset=inside(root,path.relative(root,path.resolve(path.dirname(file),ref.replaceAll('\\_','_'))));
   const bytes=fs.readFileSync(asset),extension=path.extname(asset).toLowerCase().replace('.jpeg','.jpg');
   if(!['.png','.jpg','.pdf'].includes(extension))throw Error('Unsupported asset '+asset);
   const name=hash(bytes)+extension;assets.set(name,{name,source:path.relative(root,asset),hash:hash(bytes)});dependencies.push(name);
   return '{/media/'+name+'}';
  });
  const source='% FudanEngine: xelatex\n'+preamble+'\\begin{document}\n\\setcounter{chapter}{1}\n'+body+'\\end{document}\n';
  if(source.length>200000)throw Error('Article exceeds editor limit: '+m[1]+' '+source.length);
  const url=m[2].replaceAll('\\%','%').replaceAll('\\_','_').replaceAll('\\&','&');
  if(!url.startsWith('https://bananaspace.org/legacy/wiki/'))throw Error('Unexpected source URL');
  return {title:m[1],url,index:i,raw,rawHash:hash(raw),source,hash:hash(source),dependencies:[...new Set(dependencies)],id:'local-page-'+hash(record.file+'\0'+i).slice(0,32)};
 });
 // Keep mutually referring articles together: static external labels would go
 // stale after an editor changes the referenced page.
 const owners=new Map();for(const p of pages)for(const m of p.raw.matchAll(/\\label\{([^}]+)\}/g))owners.set(m[1],p.index);
 const spans=[];
 for(const p of pages)for(const m of p.raw.matchAll(/\\(?:eqref|ref|autoref|pageref)\{([^}]+)\}/g)){
  const target=owners.get(m[1]);if(target!==undefined&&target!==p.index)spans.push([Math.min(p.index,target),Math.max(p.index,target)]);
 }
 spans.sort((a,b)=>a[0]-b[0]);const groups=[];
 for(const span of spans){const last=groups.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else groups.push([...span]);}
 const merged=[];
 for(let i=0;i<pages.length;i++){
  const span=groups.find(s=>s[0]===i);if(!span){merged.push(pages[i]);continue;}
  const parts=pages.slice(i,span[1]+1);let section=0,depth=2;
  for(const p of pages.slice(0,i))for(const m of p.raw.matchAll(/\\setcounter\{(section|secnumdepth)\}\{(-?\d+)\}|\\nosectionnumbers\b|^\s*\\section\{/gm)){
   if(m[1]==='section')section=Number(m[2]);else if(m[1]==='secnumdepth')depth=Number(m[2]);else if(m[0].includes('nosectionnumbers'))depth=0;else if(depth>=1)section++;
  }
  const wrapper='\\begin{document}\n\\setcounter{chapter}{1}\n';
  const body=parts.map(p=>p.source.slice(p.source.indexOf(wrapper)+wrapper.length,p.source.lastIndexOf('\\end{document}'))).join('');
  const source='% FudanEngine: xelatex\n'+preamble+wrapper+'\\setcounter{section}{'+section+'}\n\\setcounter{secnumdepth}{'+depth+'}\n'+body+'\\end{document}\n';
  if(source.length>200000)throw Error('Cross-reference group exceeds editor limit: '+record.course);
  const raw=parts.map(p=>p.raw).join('');
  merged.push({...parts[0],title:parts.map(p=>p.title).join('、'),raw,rawHash:hash(raw),source,hash:hash(source),dependencies:[...new Set(parts.flatMap(p=>p.dependencies))],sourceArticles:parts.map(p=>({title:p.title,url:p.url,rawHash:p.rawHash})),numberingContext:{section,depth}});
  i=span[1];
 }
 return {...record,subject:subjectFor(record),originalHash:hash(original),pages:merged,assets:[...assets.values()]};
}
