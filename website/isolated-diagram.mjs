import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {loadConfig} from './config.mjs';import {createIsolatedCompiler} from './isolated-compiler.mjs';
import {DatabaseSync} from 'node:sqlite';
const root=path.dirname(fileURLToPath(import.meta.url));
const error=m=>Object.assign(new Error(m),{status:422});
export function diagramDocument({tex,display=false,mode='math'}){
 if(typeof tex!=='string'||tex.length>200000||!['math','text'].includes(mode))throw error('图形输入无效');
 const body=mode==='text'?tex:'$'+(display?'\\displaystyle ':'')+tex+'$';
 return String.raw`\documentclass[border=2pt]{standalone}
\usepackage[utf8]{inputenc}
\usepackage{CJKutf8}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,mathtools,bm,mathrsfs,extarrows,dsfont,tikz,tikz-cd,pgfplots,array,booktabs,longtable,multirow,arydshln,graphicx,xcolor,ulem,cancel}
\providecommand{\widecheck}[1]{\check{#1}}
\providecommand{\qedhere}{\quad\square}
\providecommand{\R}{\mathbb{R}}
\providecommand{\Z}{\mathbb{Z}}
\providecommand{\C}{\mathbb{C}}
\providecommand{\N}{\mathbb{N}}
\providecommand{\Q}{\mathbb{Q}}
\usetikzlibrary{arrows,arrows.meta,angles,quotes,calc,positioning,decorations.pathmorphing,decorations.markings,decorations.pathreplacing,patterns,matrix,cd,fit,intersections,shapes.geometric}
\pgfplotsset{compat=1.18}
\newcolumntype{C}{>{\centering\arraybackslash}p{1.1cm}}
\colorlet{grey}{gray}
\definecolor{gold}{HTML}{FFD700}
\tikzset{vertex/.style={circle,fill=black,inner sep=1.4pt},edge_arrow/.style={->}}
\tikzset{->-/.style={decoration={markings,mark=at position 0.5 with {\arrow{>}}},postaction={decorate}}}
\begin{document}
\begin{CJK*}{UTF8}{gbsn}
`+[...new Set([...tex.matchAll(/\\(?:color|textcolor)\{([A-Fa-f0-9]{6})\}/g)].map(m=>m[1]))].map(c=>'\\definecolor{'+c+'}{HTML}{'+c+'}').join('\n')+'\n'+body+'\n\\end{CJK*}\n\\end{document}\n';
}
export async function compileDiagram(input,{config=loadConfig(process.env),dataDir=config.dataDir}={}){
 const tag=/\\tag(\*)?\{([^{}]*)\}\s*$/.exec(input.tex||'');if(tag){const result=await compileDiagram({...input,tex:input.tex.slice(0,tag.index)},{config,dataDir});const label=await compileDiagram({tex:tag[1]?tag[2]:'('+tag[2]+')',display:false,mode:'math'},{config,dataDir});const width=/viewBox="[\d.\s-]+ ([\d.]+) [\d.]+"/.exec(label.svg);return{...result,tagSvg:label.svg,tagWidth:Number(width?.[1]||30)}}
 if(config.compileMode!=='isolated')throw error('图形仅允许使用已配置的隔离编译服务');
 const isPrivateMedia=name=>{
  if(!config.dbPath||config.dbPath===':memory:'||(!config.production&&!fs.existsSync(config.dbPath)))return false;
  const db=new DatabaseSync(config.dbPath,{readOnly:true});
  try{return !!db.prepare("SELECT 1 FROM settings WHERE key=? AND value='1'").get('private-media:'+name)}
  finally{db.close()}
 };
 const compiler=createIsolatedCompiler(dataDir,{...config.compileService,isPrivateMedia}),out=await compiler.compile(diagramDocument(input));
 const destination=path.join(dataDir,'diagram-svg');fs.mkdirSync(destination,{recursive:true});const svgFile=path.join(destination,out.artifact+'.svg');
 if(!fs.existsSync(svgFile))await new Promise((resolve,reject)=>{let stderr='';const binary=process.env.FUDAN_PDFTOCAIRO||'pdftocairo';const child=spawn(binary,['-svg','-f','1','-l','1',path.join(compiler.output,out.artifact+'.pdf'),svgFile],{stdio:['ignore','ignore','pipe'],windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(error('图形SVG转换超时'))},10000);child.stderr.on('data',b=>stderr=(stderr+b).slice(-1500));child.on('error',()=>{clearTimeout(timer);reject(error('未找到PDF到SVG转换工具'))});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(error('SVG转换失败：'+stderr))})});
 const stat=fs.statSync(svgFile);if(stat.size>20*1024*1024)throw error('SVG输出过大');let svg=fs.readFileSync(svgFile,'utf8').replace(/<\?xml[^>]*\?>/g,'');
 if(!/^\s*<svg\b/.test(svg)||/<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:|file:|ftp:)/i.test(svg))throw error('SVG包含不允许的主动内容');
 const ids=new Map([...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],'fudan-'+out.artifact.slice(0,16)+'-'+m[1]]));svg=svg.replace(/\bid="([^"]+)"/g,(_,id)=>'id="'+ids.get(id)+'"').replace(/#([\w.-]+)/g,(all,id)=>ids.has(id)?'#'+ids.get(id):all);
 svg=svg.replace(/\bwidth="([\d.]+)pt"/,'width="$1pt" style="max-width:100%;height:auto"');return{svg,fonts:[],artifact:out.artifact};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const value=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(await compileDiagram(value)))}catch(e){console.error(e.message);process.exitCode=1}
}
