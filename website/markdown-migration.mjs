import {createHash} from 'node:crypto';
export const digest=s=>createHash('sha256').update(s).digest('hex');
// Every replacement retains the exact input span. Reconstruction is independent
// of the generated Markdown and must equal the original byte-for-byte.
export function convertSource(source){
 const spans=[],issues=[],stack=[];let i=0;
 const emit=(end,markdown,kind='text')=>{spans.push({start:i,end,original:source.slice(i,end),markdown,kind});i=end};
 const group=(start,open='{',close='}')=>{if(source[start]!==open)return null;let depth=1,j=start+1;for(;j<source.length;j++){if(source[j]==='\\'){j++;continue}if(source[j]===open)depth++;if(source[j]===close&&!--depth)return{value:source.slice(start+1,j),end:j+1}}return null};
 while(i<source.length){
  const tail=source.slice(i);
  if(tail.startsWith('%')){const end=source.indexOf('\n',i);const n=end<0?source.length:end;emit(n,'<!-- '+source.slice(i+1,n).replaceAll('--','—')+' -->','source-comment');continue}
  const delimiter=tail.startsWith('\\[')?['\\[','\\]']:tail.startsWith('\\(')?['\\(','\\)']:tail.startsWith('$$')?['$$','$$']:tail.startsWith('$')?['$','$']:null;
  if(delimiter){let end=i+delimiter[0].length;while(end<source.length){end=source.indexOf(delimiter[1],end);if(end<0)break;if(source[end-1]!=='\\')break;end+=delimiter[1].length}if(end<0){issues.push({offset:i,reason:'未闭合公式'});emit(source.length,tail,'unresolved');continue}end+=delimiter[1].length;emit(end,source.slice(i,end),'math');continue}
  const template=tail.match(/^\{\{(comment|warning)\|/);if(template){issues.push({offset:i,reason:'Wiki '+template[1]+'模板须核对嵌套、显示语义和原编号'});emit(i+template[0].length,template[0],'unresolved');continue}
  const cmd=tail.match(/^\\([a-zA-Z]+)(\*?)/);
  if(cmd){const name=cmd[1],star=cmd[2];let after=i+cmd[0].length;
   if(['section','subsection','subsubsection','textbf','emph','textit','setdisplaytitle','sethtmltitle','label','ref','eqref','url'].includes(name)){
    const g=group(after);if(g){let out;
     if(name.endsWith('section'))out='\n\n'+({section:'##',subsection:'###',subsubsection:'####'}[name])+' '+g.value+(star?'*':'')+'\n\n';
     else if(name==='textbf')out='**'+g.value+'**';else if(['emph','textit'].includes(name))out='*'+g.value+'*';
     else if(['setdisplaytitle','sethtmltitle'].includes(name))out='';
     else if(name==='label')out='{@'+g.value+'}';else if(['ref','eqref'].includes(name))out='@'+g.value;else out='<'+g.value+'>';
     if(['ref','eqref','label'].includes(name))issues.push({offset:i,reason:'引用标签及编号需要跨页原文核对'});
     if(/\\/.test(g.value)&&!['url'].includes(name))issues.push({offset:i,reason:'命令参数包含嵌套TeX，须进一步转换'});
     emit(g.end,out,'command:'+name);continue;
    }
   }
   if(['begin','end'].includes(name)){const g=group(after);if(g&&['definition','theorem','lemma','proposition','corollary','example','remark','proof','exercise','comment'].includes(g.value)){
    if(g.value==='comment'){issues.push({offset:i,reason:'comment环境可能是源码隐藏内容，须人工确认，未发布'});emit(g.end,tail.slice(0,g.end-i),'unresolved');continue}
    let title='';let end=g.end;const opt=group(end,'[',']');if(opt){title=' ['+opt.value+']';end=opt.end}
    if(name==='begin')stack.push(g.value);else if(stack.pop()!==g.value)issues.push({offset:i,reason:'环境不平衡'});
    emit(end,name==='begin'?'\n\n::: '+g.value+title+'\n':'\n:::\n\n','environment');continue;
   }}
   if(['noindent','qquad','quad','par','medskip','smallskip','bigskip'].includes(name)){emit(after,name==='par'?'\n\n':'','layout');continue}
   issues.push({offset:i,reason:'未支持的原文命令 '+cmd[0]});emit(after,cmd[0],'unresolved');continue;
  }
  if(tail.startsWith('\\%')){emit(i+2,'\\%','escaped');continue}
  // Copy ordinary text without changing punctuation, wording, or math.
  let end=i+1;while(end<source.length&&!['\\','$','%','{'].includes(source[end]))end++;
  emit(end,source.slice(i,end));
 }
 if(stack.length)issues.push({offset:source.length,reason:'环境未闭合'});
 const reconstructed=spans.map(s=>s.original).join('');if(reconstructed!==source)throw Error('Source span coverage failed');
 return{markdown:spans.map(s=>s.markdown).join(''),spans,issues,sourceHash:digest(source),reconstructedHash:digest(reconstructed),eligible:issues.length===0};
}
