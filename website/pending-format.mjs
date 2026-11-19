import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
function columns(body){
 let depth=0,braces=0,n=1,max=1;for(let i=0;i<body.length;i++){
  if(body[i]==='%'){const e=body.indexOf('\n',i);i=e<0?body.length:e;continue}
  if(body[i]==='\\'){const e=/^\\(begin|end)\{[^}]+\}/.exec(body.slice(i));if(e){depth+=e[1]==='begin'?1:-1;i+=e[0].length-1;continue}if(body[i+1]==='\\'&&!depth&&!braces){max=Math.max(max,n);n=1}i++;continue}
  if(body[i]==='{')braces++;else if(body[i]==='}')braces--;else if(body[i]==='&'&&!depth&&!braces)n++;
 }return Math.max(max,n);
}
function outerAmpersands(body){
 let result='',braces=0,depth=0;for(let i=0;i<body.length;i++){
  if(body[i]==='%'){const end=body.indexOf('\n',i),stop=end<0?body.length:end;result+=body.slice(i,stop);i=stop-1;continue}
  if(body[i]==='\\'){const env=/^\\(begin|end)\{[^}]+\}/.exec(body.slice(i));if(env){depth+=env[1]==='begin'?1:-1;result+=env[0];i+=env[0].length-1;continue}const token=/^\\(?:[A-Za-z]+|[^\r\n])/.exec(body.slice(i));if(token){result+=token[0];i+=token[0].length-1;continue}}
  if(body[i]==='{')braces++;else if(body[i]==='}')braces--;result+=body[i]==='&'&&!braces&&!depth?'\\&':body[i];
 }return result;
}
export function repairMarkdown(md,changes,{preserveListLayout=false}={}){
 const original=md;
 md=md.replace(/\r\n/g,'\n');
 let code=false,math=false,footnote=false,metadata=md.startsWith('---\n');
 md=md.split('\n').map((line,index)=>{if(metadata){if(index>0&&line==='---')metadata=false;return line}if(/^\[\^[^\]]+\]:/.test(line)){footnote=true;return line}if(footnote){if(!line.trim()||/^(?: {4}|\t)/.test(line))return line;footnote=false}const plain=line.replace(/^[ \t]+/,'');if(/^```/.test(plain)){code=!code;return preserveListLayout?line:plain}if(code)return line;if(/^\\\[$/.test(plain)){math=true;return preserveListLayout?line:plain}if(/^\\\]$/.test(plain)){math=false;return preserveListLayout?line:plain}return math||preserveListLayout?line:plain}).join('\n');
 md=md.replace(/\\(begin|end)\{split\}/g,(_,command)=>'\\'+command+'{aligned}');
 md=md.replace(/(\\begin\{tikzpicture\}(?:\[[^\]]*\])?)([\s\S]*?)(\\end\{tikzpicture\})/g,(all,start,body,end)=>start+body.replace(/([^;\s])\s*$/,'$1;\n')+end);
 md=md.replace(/\\begin\{tikzcd\}([\s\S]*?)\\end\{tikzcd\}/g,(_,body)=>'\\begin{tikzcd}'+body.replace(/"([^"\n]*)"/g,(_,label)=>'"{'+label+'}"')+'\\end{tikzcd}');
 md=md.replace(/\\begin\{tikzcd\}([\s\S]*?)\\end\{tikzcd\}/g,(all,body)=>{if(!/\\begin\{(?:[pbBvV]?matrix|array)\}/.test(body))return all;changes.push({kind:'diagram-nested-matrix-alignment'});return '\\begin{tikzcd}[ampersand replacement=\\&]'+outerAmpersands(body)+'\\end{tikzcd}'});
 md=md.replace(/\\node \(a7\) at \(3,1\) \(\$a_7\$\);/g,'\\node (a7) at (3,1) {$a_7$};');
 md=md.replace('\\draw (0.0) node {$B_R$};','\\draw (0,0) node {$B_R$};');
 if(md.includes('\\begin{itemize}'))md=md.replace(/\\node\[inner sep=0pt\] \(fudantext\)/g,'\\node[inner sep=0pt,text width=12cm] (fudantext)');
 md=md.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g,(all,body)=>{const count=columns(body);if(count<=2||!/&\s*&/.test(body))return all;changes.push({kind:'cases-alignment',columns:count});return '\\left\\{\\begin{array}{'+'l'.repeat(count)+'}'+body+'\\end{array}\\right.'});
 md=md.replace(/\\begin\{tabular\}(\{[clr| ]+\})([\s\S]*?)\\end\{tabular\}/g,(all,spec,body)=>'\\begin{tabular}'+spec+body.replace(/\\backslash\b/g,'\\textbackslash{}').replace(/\\\[([\s\S]*?)\\\]/g,'$\\displaystyle $1$')+'\\end{tabular}');
 if(md!==original)changes.push({kind:'format-compatibility',beforeHash:sha(original),afterHash:sha(md),details:'prose indentation, terminal TikZ semicolons, protected arrow labels, a7 node braces'});
 // Widen only simple table specifications. Cells, row breaks and nested math stay intact.
 md=md.replace(/\\begin\{tabular\}\{([clr| ]+)\}([\s\S]*?)\\end\{tabular\}/g,(all,spec,body)=>{
  const terminated=body.replace(/(\$)[ \t]*\n([ \t]*\\hline)/g,'$1\\\\\n$2');
  if(terminated!==body){changes.push({kind:'table-row-before-rule'});body=terminated;all='\\begin{tabular}{'+spec+'}'+body+'\\end{tabular}'}
  const max=columns(body),count=spec.replace(/[| ]/g,'').length;if(max<=count)return all;
  const replacement=spec.replace(/\|*$/,m=>'c'.repeat(max-count)+m);changes.push({kind:'table-columns',from:spec,to:replacement});return '\\begin{tabular}{'+replacement+'}'+body+'\\end{tabular}';
 });
 return md;
}
