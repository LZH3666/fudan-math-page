// Convert only the legacy Banana bTeX formatting for standalone compilation.
// The database keeps the original source; this is a compilation-time bridge.
export const legacyMarker='\\providecommand{\\FudanLegacySource}{}';
const mathEnvironment=/^(?:equation\*?|align\*?|alignat\*?|aligned|gather\*?|gathered|cases|[pbBvV]?matrix|array|split|subarray)$/;
function wikiLinks(source){
 let out='',math=false;const envs=[];
 for(let i=0;i<source.length;){
  if(source[i]==='%'){const end=source.indexOf('\n',i);if(end<0){out+=source.slice(i);break}out+=source.slice(i,end+1);i=end+1;continue}
  if(source[i]==='\\'){
   const env=/^\\(begin|end)\{([^{}]+)\}/.exec(source.slice(i));
   if(env){if(env[1]==='begin')envs.push(env[2]);else envs.pop();out+=env[0];i+=env[0].length;continue}
   if('([)]'.includes(source[i+1]||'\0'))math=['(','['].includes(source[i+1]);
   out+=source.slice(i,i+2);i+=2;continue;
  }
  if(source[i]==='$')math=!math;
  if(!math&&!envs.some(e=>mathEnvironment.test(e))&&source.startsWith('[[',i)){
   const match=/^\[\[([^\]\n]+)\]\]/.exec(source.slice(i));
   if(match){
    const parts=match[1].split('|'),label=parts.at(-1);
    // bTeX expands spacing commands before handing titles to MediaWiki.
    const page=parts[0].replace(/^User:/,'用户:').replace(/\\(?:qquad|quad|space)\b|\\ /g,' ').replaceAll('_',' ').replace(/\s+/g,' ').trim();
    const url='https://bananaspace.org/legacy/wiki/'+encodeURIComponent(page).replaceAll('%2F','/');
    out+='\\href{'+url.replaceAll('%','\\%')+'}{'+label+'}';i+=match[0].length;continue;
   }
  }
  out+=source[i++];
 }
 return out;
}
// Count only the outer alignment. A cases block inside a table cell must not
// contribute its ampersands or row breaks to the surrounding HTML table.
function alignmentColumns(contents){
 let depth=0,braces=0,count=1,max=1;
 for(let i=0;i<contents.length;){
  if(contents[i]==='%'){const end=contents.indexOf('\n',i);if(end<0)break;i=end+1;continue}
  if(contents[i]==='\\'){
   const env=/^\\(begin|end)\{[^{}]+\}/.exec(contents.slice(i));
   if(env){depth+=env[1]==='begin'?1:-1;i+=env[0].length;continue}
   if(contents[i+1]==='\\'&&depth===0&&braces===0){max=Math.max(max,count);count=1}
   i+=2;continue;
  }
  if(contents[i]==='{')braces++;else if(contents[i]==='}')braces--;
  if(contents[i]==='&'&&depth===0&&braces===0)count++;
  i++;
 }
 return Math.max(max,count);
}
function dollarDisplays(source){
 let out='';
 for(let i=0;i<source.length;){
  if(source[i]==='\\'){out+=source.slice(i,i+2);i+=2;continue}
  if(source[i]==='%'){const end=source.indexOf('\n',i);if(end<0){out+=source.slice(i);break}out+=source.slice(i,end+1);i=end+1;continue}
  if(source[i]!=='$'){out+=source[i++];continue}
  const display=source[i+1]==='$',delimiter=display?'$$':'$';let end=i+delimiter.length;
  while((end=source.indexOf(delimiter,end))>=0){let slashes=0;for(let j=end-1;j>=0&&source[j]==='\\';j--)slashes++;if(slashes%2===0)break;end+=delimiter.length}
  if(end<0){out+=source.slice(i);break}
  const contents=source.slice(i+delimiter.length,end);
  out+=display?'\\begin{equation*}'+contents+'\\end{equation*}':delimiter+contents+delimiter;i=end+delimiter.length;
 }
 return out;
}
function textAmpersands(source){
 let out='',math=false,braceDepth=0;const envs=[];
 const mathEnv=/^(?:equation\*?|align\*?|alignat\*?|aligned|gather\*?|gathered|cases|[pbBvV]?matrix|array|split|subarray)$/;
 for(let i=0;i<source.length;){
  if(source[i]==='%'){const end=source.indexOf('\n',i);if(end<0){out+=source.slice(i);break}out+=source.slice(i,end+1);i=end+1;continue}
  if(source[i]==='\\'){
   const env=/^\\(begin|end)\{([^{}]+)\}/.exec(source.slice(i));
   if(env){if(env[1]==='begin')envs.push(env[2]);else envs.pop();out+=env[0];i+=env[0].length;continue}
   if(source[i+1]==='.'&&(math||envs.some(e=>mathEnv.test(e)))){out+='\\dot ';i+=2;continue}
   if(source[i+1]==='\\'&&!math&&!envs.some(e=>mathEnv.test(e)||e==='tabular'||e==='tikzcd')){out+='\\leavevmode\\\\\\relax{}';i+=2;continue}
   if('([)]'.includes(source[i+1]||'\0'))math=['(','['].includes(source[i+1]);
   out+=source.slice(i,i+2);i+=2;continue;
  }
  if(source[i]==='$')math=!math;
  if(source[i]==='{')braceDepth++;else if(source[i]==='}')braceDepth--;
  const alignment=envs.some(e=>/^(?:tabular\*?|array|[pbBvV]?matrix|align\*?|alignat\*?|aligned|cases|tikzcd|split)$/.test(e));
  const graphics=envs.some(e=>e==='tikzpicture'||e==='scope');
  const inMath=math||envs.some(e=>mathEnv.test(e));
  if(!inMath&&!alignment&&!graphics&&source[i]==='^'&&braceDepth===0)out+='\\^{}';
  else out+=!inMath&&!alignment&&(source[i]==='&'||source[i]==='_'&&braceDepth===0&&!graphics)?'\\'+source[i]:source[i];i++;
 }
 return out;
}
export function legacyDocument(input,preamble=''){
 const declarations=new Set([...input.matchAll(/\\(?:newcommand|renewcommand|providecommand)\s*(?:\{\\([A-Za-z]+)\}|\\([A-Za-z]+))/g)].map(m=>m[1]||m[2]));
 const declaredEnvs=new Set([...input.matchAll(/\\(?:newtheorem\*?|newenvironment)\s*\{([^{}]+)\}/g)].map(m=>m[1]));
 let body=input.replaceAll('\u00a0',' ').replace(/^([ \t]*)(={2,6})[ \t]*(.*?)[ \t]*\2[ \t]*$/gm,(_,space,marks,title)=>space+'\\'+({2:'section',3:'subsection',4:'subsubsection',5:'paragraph',6:'subparagraph'}[marks.length])+'{'+title+'}');
 body=body.replace(/\\begin\{cd\}/g,'\\begin{tikzcd}').replace(/\\end\{cd\}/g,'\\end{tikzcd}');
 body=dollarDisplays(body);
 body=wikiLinks(body);
 body=body.replace(/\\newtheorem(?!\*)\s*\{([^{}]+)\}(?:\[[^\]]*\])?/g,'\\newtheorem{$1}[legacytheorem]');
 body=body.replaceAll('\\setcounter{enum-{list-level}}','\\setcounter{\\csname @enumctr\\endcsname}');
 // bTeX-local parser definitions select displaystyle for inline math. They
 // are formatting directives, not executable TeX primitive definitions.
 body=body.replace(/^\s*\\pdef\s*\\[([][^\n]*$/gm,'');
 body=body.replace(/\\item\[(\\(?:bullet|circ|star|ast))\]/g,'\\item[\\ensuremath{$1}]');
 body=body.replace(/\\begin\{tabular\}\{([^{}]+)\}/g,(_,spec)=>'\\begin{tabular}{'+spec.replace(/[CLR]/g,c=>c.toLowerCase())+'}');
 body=body.replace(/\\begin\{enumerate\}\[(\d+)\]/g,'\\begin{enumerate}[start=$1]');
 body=body.replace(/\\begin\{tabular\}\{([^{}]+)\}([\s\S]*?)\\end\{tabular\}/g,(_,spec,contents)=>'\\begin{tabular}{'+spec+'}'+contents.replace(/\\\[([\s\S]*?)\\\]/g,'$\\displaystyle $1$')+'\\end{tabular}');
 body=body.replace(/\\begin\{(align\*?|aligned|equation\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g,(_,env,contents)=>'\\begin{'+env+'}'+contents.replace(/\n[ \t]*\n/g,'\n')+'\\end{'+env+'}');
 body=body.replace(/\\begin\{tikzpicture\}([\s\S]*?)\\end\{tikzpicture\}/g,(_,contents)=>'\\begin{tikzpicture}'+contents.replace(/([^;\s])\s*$/,'$1;\n')+'\\end{tikzpicture}');
 body=body.replace(/\\begin\{tikzcd\}([\s\S]*?)\\end\{tikzcd\}/g,(_,contents)=>'\\begin{tikzcd}'+contents.replace(/"([^"\n]*)"/g,(_,label)=>'"{'+label+'}"')+'\\end{tikzcd}');
 body=body.replaceAll('➢','\\ensuremath{\\blacktriangleright}').replaceAll('➣','\\ensuremath{\\blacktriangleright}').replaceAll('−','\\ensuremath{-}').replaceAll('✩','\\ensuremath{\\star}').replaceAll('🔗','\\faLink{}');
 body=[...body].map(char=>{const cp=char.codePointAt(0);return cp>=0x2f00&&cp<=0x2fd5?char.normalize('NFKC'):char}).join('');
 body=[...body].map(char=>{const cp=char.codePointAt(0),plain=char.normalize('NFKD');if(cp>=0x1d400&&cp<=0x1d7ff&&/^[A-Za-z0-9]$/.test(plain)){const style=cp<0x1d434?'mathbf':cp<0x1d468?'mathit':cp<0x1d49c?'bm':cp<0x1d504?'mathscr':cp<0x1d538?'mathfrak':cp<0x1d56c?'mathbb':'mathrm';return '\\ensuremath{\\'+style+'{'+plain+'}}'}return char}).join('');
 body=body.replace(/\\begin\{tabular\}\{([clr| ]+)\}([\s\S]*?)\\end\{tabular\}/g,(_,spec,contents)=>{const columns=alignmentColumns(contents);const have=(spec.match(/[clr]/g)||[]).length;return '\\begin{tabular}{'+(columns>have?spec+'c'.repeat(columns-have):spec)+'}'+contents+'\\end{tabular}'});
 body=body.replace(/\\begin\{tabular\}([\s\S]*?)\\end\{tabular\}/g,whole=>'\\par\\noindent\\begin{adjustbox}{max width=\\linewidth}'+whole+'\\end{adjustbox}\\par');
 // bTeX/KaTeX permits additional empty alignment columns in cases.
 body=body.replace(/\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g,(whole,contents)=>{const columns=alignmentColumns(contents);return columns>2&&/&\s*&/.test(contents)&&contents.includes('\\\\')?'\\left\\{\\begin{array}{'+ 'l'.repeat(columns)+'}'+contents+'\\end{array}\\right.':whole});
 body=textAmpersands(body);
 body=body.replace(/\\(?:textbf|textit|textmd)\{([^{}$]*)\}/g,(whole,contents)=>whole.replace(contents,contents.replace(/(?<!\\)_/g,'\\_')));
 const customMacros={R:'\\mathbb{R}',C:'\\mathbb{C}',N:'\\mathbb{N}',Q:'\\mathbb{Q}',Z:'\\mathbb{Z}',exist:'\\exists',alef:'\\aleph',gt:'>',lt:'<',varGamma:'\\mathit{\\Gamma}',varDelta:'\\mathit{\\Delta}',varTheta:'\\mathit{\\Theta}',varLambda:'\\mathit{\\Lambda}',varXi:'\\mathit{\\Xi}',varPi:'\\mathit{\\Pi}',varSigma:'\\mathit{\\Sigma}',varPhi:'\\mathit{\\Phi}',varPsi:'\\mathit{\\Psi}',varOmega:'\\mathit{\\Omega}',widecheck:'\\check',infin:'\\infty'};
 const macros=Object.entries(customMacros).filter(([name])=>!declarations.has(name)).map(([name,value])=>'\\providecommand{\\'+name+'}{'+value+'}').join('\n');
 const english=/\\english\b/.test(input);
 const labels=english?{theorem:'Theorem',lemma:'Lemma',proposition:'Proposition',corollary:'Corollary',conjecture:'Conjecture',definition:'Definition',example:'Example',remark:'Remark',problem:'Problem'}:{theorem:'定理',lemma:'引理',proposition:'命题',corollary:'推论',conjecture:'猜想',definition:'定义',example:'例',remark:'注',problem:'问题'};
 const environments='\\newcounter{legacytheorem}[section]\n\\renewcommand{\\thelegacytheorem}{\\thesection.\\arabic{legacytheorem}}\n\\makeatletter\\let\\c@theorem\\c@legacytheorem\\makeatother\n'+Object.entries(labels).filter(([name])=>!declaredEnvs.has(name)).map(([name,label])=>'\\newtheorem{'+name+'}[legacytheorem]{'+label+'}').join('\n');
 const solution=declaredEnvs.has('solution')?'':'\\newenvironment{solution}[1][解答]{\\begin{proof}[#1]}{\\end{proof}}';
 return String.raw`\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{CJKutf8}
\usepackage{amsmath,amssymb,amsthm,mathtools,bm,mathrsfs,dsfont,extarrows}
\usepackage{siunitx,tikz,tikz-cd,pgfplots,graphicx,xcolor,enumitem,fontawesome5,adjustbox}
\usepackage[margin=18mm,paperwidth=180mm,paperheight=260mm]{geometry}
\usepackage[unicode,colorlinks=true,linkcolor=blue,urlcolor=blue]{hyperref}
\definecolor{gold}{HTML}{FFD700}
\usetikzlibrary{arrows.meta,calc,positioning,decorations.pathmorphing,patterns,matrix,cd,fit,shapes.geometric}
\pgfplotsset{compat=1.18}
\renewcommand{\proofname}{证明}
\renewenvironment{proof}[1][\proofname]{\par\pushQED{\qed}\noindent\textbf{#1.}\quad\ignorespaces}{\popQED\par}
\newenvironment{proofc}[1][证明]{\begin{proof}[{#1}]}{\end{proof}}
\newcolumntype{C}{c}
\newcolumntype{L}{l}
\newcolumntype{R}{r}
\newenvironment{structure}{\begin{enumerate}}{\end{enumerate}}
\newcommand{\subpage}[1]{\item #1}
\newcommand{\setdisplaytitle}[1]{}
\newcommand{\sethtmltitle}[1]{}
\newcommand{\nosectionnumbers}{\setcounter{secnumdepth}{0}\renewcommand{\thelegacytheorem}{\arabic{legacytheorem}}}
\newcommand{\textsize}[2]{{\fontsize{#1}{1.2\dimexpr#1\relax}\selectfont #2}}
\newcommand{\printfootnotes}{}
\newcommand{\english}{\renewcommand{\proofname}{Proof}}
\let\LegacyTextDot\.
\renewcommand{\.}[1]{\ifmmode\dot{#1}\else\LegacyTextDot{#1}\fi}
\newenvironment{references}{\begin{thebibliography}{99}}{\end{thebibliography}}
\makeatletter
\let\LegacyOriginalNewCommand\newcommand
\def\LegacyNewCommand#1{\let#1\relax\LegacyOriginalNewCommand#1}
\def\newcommand{\@ifstar{\LegacyNewCommand}{\LegacyNewCommand}}
\makeatother
\setlength{\parindent}{0pt}
\setlength{\parskip}{0.6em}
\pagestyle{empty}
`+'\n'+macros+'\n'+environments+'\n'+solution+'\n'+[...new Set([...input.matchAll(/\\(?:textcolor|color)\{([a-fA-F0-9]{6})\}/g)].map(m=>m[1]))].map(hex=>'\\definecolor{'+hex+'}{HTML}{'+hex+'}').join('\n')+'\n'+preamble+'\n\\begin{document}\n\\begin{CJK*}{UTF8}{gbsn}\n'+[...declaredEnvs].map(name=>'\\expandafter\\let\\csname '+name+'\\endcsname\\relax').join('\n')+'\n'+body+'\n\\end{CJK*}\n\\end{document}\n';
}
