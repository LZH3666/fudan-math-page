import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {commonPackages,buildDocument} from './dist/latex-source.js';
export {commonPackages,buildDocument};
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createCompiler(dataDir,{engine=process.env.FUDAN_TEX_ENGINE||'pdflatex',timeout=25000}={}){
 const jobs=path.join(dataDir,'tex-jobs'),output=path.join(dataDir,'compiled'),assets=path.join(dataDir,'assets');
 for(const dir of [jobs,output,assets])fs.mkdirSync(dir,{recursive:true});
 let running=false;const queue=[];
 function schedule(fn){return new Promise((resolve,reject)=>{if(queue.length>=4){reject(fail(429,'编译任务较多，请稍后重试'));return}queue.push({fn,resolve,reject});drain()})}
 async function drain(){if(running)return;const task=queue.shift();if(!task)return;running=true;try{task.resolve(await task.fn())}catch(err){task.reject(err)}finally{running=false;drain()}}
 function run(job){
  return new Promise((resolve,reject)=>{
   const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,HOME:job,USERPROFILE:job,APPDATA:job,LOCALAPPDATA:job,TEMP:job,TMP:job,TEXMFHOME:job,TEXMFOUTPUT:job,openin_any:'p',openout_any:'p',shell_escape:'f',MKTEXPK:'0',MKTEXTFM:'0'};
   const child=spawn(engine,['-no-shell-escape','-interaction=nonstopmode','-halt-on-error','-file-line-error','-recorder','-jobname=page','page.tex'],{cwd:job,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let log='',reason='';
   const stop=message=>{reason=message;child.kill()};
   const timer=setTimeout(()=>stop('编译超过时限，请拆分页面或简化图形。'),timeout);
   const quota=setInterval(()=>{try{const names=fs.readdirSync(job);let size=0;for(const f of names){const st=fs.statSync(path.join(job,f));if(st.isFile())size+=st.size}if(size>40*1024*1024||names.length>150)stop('编译输出过大。')}catch{}},250);
   const consume=b=>{log+=b.toString();if(log.length>2*1024*1024)stop('编译日志过大，请检查循环或宏定义。')};
   child.stdout.on('data',consume);child.stderr.on('data',consume);
   child.on('error',()=>{clearTimeout(timer);clearInterval(quota);reject(fail(503,'未找到可运行的 pdfLaTeX，请检查本机 TeX Live 配置。'))});
   child.on('close',code=>{
    clearTimeout(timer);clearInterval(quota);
    if(reason)return reject(fail(422,reason));
    if(code!==0){const lines=log.split(/\r?\n/),at=lines.findIndex(x=>/^!|^\.\/page\.tex:\d+:|LaTeX Error|Emergency stop|not allowed|I can't find/.test(x));return reject(fail(422,'LaTeX 编译失败：\n'+lines.slice(at<0?-18:at,(at<0?lines.length:at+15)).join('\n').slice(0,2800)))}
    resolve(log);
   });
  });
 }
 async function compile(tex,preamble=''){
  if(typeof tex!=='string'||typeof preamble!=='string'||tex.length>200000||preamble.length>30000)throw fail(400,'TeX 源码或导言区过长。');
  let source=buildDocument(tex,preamble);
  const used=new Set();
  source=source.replace(/\{\/media\/([a-f0-9]{64}\.(?:png|jpg|webp))\}/g,(_,name)=>{used.add(name);return '{'+name+'}'});
  // Remote images are not fetched by the compiler; upload once to give TeX a local file.
  if(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{https?:/i.test(source))throw fail(422,'完整 LaTeX 排版请先上传图片，再使用上传后生成的图片地址。');
  for(const name of used){if(name.endsWith('.webp'))throw fail(422,'完整 LaTeX 排版请使用 PNG 或 JPEG 图片。');if(!fs.existsSync(path.join(assets,name)))throw fail(422,'引用的图片不存在，请重新上传。')}
  const key=createHash('sha256').update('fudan-pdf-v1\0'+source).digest('hex'),pdf=path.join(output,key+'.pdf');
  if(fs.existsSync(pdf))return {artifact:key,url:'/compiled/'+key+'.pdf'};
  return schedule(async()=>{
   if(fs.existsSync(pdf))return {artifact:key,url:'/compiled/'+key+'.pdf'};
   const job=path.resolve(jobs,randomUUID());fs.mkdirSync(job);fs.writeFileSync(path.join(job,'page.tex'),source,'utf8');
   for(const name of used)fs.copyFileSync(path.join(assets,name),path.join(job,name));
   try{
    await run(job);await run(job);
    const result=path.join(job,'page.pdf');if(!fs.existsSync(result)||fs.statSync(result).size>20*1024*1024)throw fail(422,'未产生有效 PDF，或输出超过 20 MB。');
    fs.copyFileSync(result,pdf);return {artifact:key,url:'/compiled/'+key+'.pdf'};
   }finally{
    // Only this freshly created job directory can be removed.
    if(job.startsWith(path.resolve(jobs)+path.sep))fs.rmSync(job,{recursive:true,force:true});
   }
  });
 }
 return {compile,output,assets};
}

