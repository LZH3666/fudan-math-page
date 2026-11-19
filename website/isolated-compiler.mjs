import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildDocument} from './dist/latex-source.js';
import {validateJob,jobKey,fault,protocol} from './compile-protocol.mjs';

export function prepareJob(tex,preamble,assetsDir,isPrivateMedia=()=>false){
 if(typeof tex!=='string'||typeof preamble!=='string'||tex.length>200000||preamble.length>30000)throw fault(400,'TeX 源码或导言区过长。');
 const names=new Set();let source=buildDocument(tex,preamble);
 source=source.replace(/\{\/media\/([a-f0-9]{64}\.(?:png|jpg|webp|pdf))\}/g,(_,name)=>{names.add(name);return '{'+name+'}'});
 if(/\\(?:includegraphics|includepdf)(?:\s*\[[^\]]*\])?\s*\{https?:/i.test(source))throw fault(422,'完整排版请先上传附件，再使用站内附件地址。');
 const assets=[...names].map(name=>{
  if(isPrivateMedia(name))throw fault(422,'引用的附件不存在，请重新上传。');
  if(name.endsWith('.webp'))throw fault(422,'完整排版请使用 PNG 或 JPEG 图片。');
  const file=path.join(assetsDir,name);let st;try{st=fs.lstatSync(file)}catch{throw fault(422,'引用的附件不存在，请重新上传。')}
  if(!st.isFile()||st.isSymbolicLink()||st.size>20*1024*1024)throw fault(422,'附件格式或大小不正确。');
  return {name,data:fs.readFileSync(file).toString('base64')};
 });
 return validateJob({source,assets});
}
export function createIsolatedCompiler(dataDir,{url,tokenFile,runtime,request=fetch,isPrivateMedia}={}){
 const output=path.join(dataDir,'compiled'),assets=path.join(dataDir,'assets');
 for(const p of [output,assets])fs.mkdirSync(p,{recursive:true});
 const token=fs.readFileSync(tokenFile,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(token))throw new Error('编译服务凭据格式不正确');
 const inflight=new Map();
 function complete(key){return fs.existsSync(path.join(output,key+'.pdf'))&&fs.existsSync(path.join(output,key+'.json'))}
 async function compile(tex,preamble=''){
  const job=prepareJob(tex,preamble,assets,isPrivateMedia),key=jobKey(job,runtime),result={artifact:key,url:'/compiled/'+key+'.pdf'};
  if(complete(key))return {...result,cached:true};
  if(inflight.has(key))return inflight.get(key);
  if(inflight.size>=5)throw fault(429,'编译任务较多，请稍后重试。');
  const promise=(async()=>{
   let response;try{response=await request(url+'/compile',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({...job,runtime,key}),signal:AbortSignal.timeout(160000)})}catch{throw fault(503,'隔离编译服务暂不可用；源码尚未保存，请保留编辑内容。')}
   const chunks=[];let length=0;
   for await(const chunk of response.body){length+=chunk.length;if(length>29*1024*1024)throw fault(502,'编译服务返回内容过大。');chunks.push(chunk)}
   let value;try{value=JSON.parse(Buffer.concat(chunks).toString())}catch{throw fault(502,'编译服务响应无效。')}
   if(!response.ok)throw fault([400,422,429,503].includes(response.status)?response.status:503,typeof value.error==='string'?value.error.slice(0,3000):'编译失败。');
   if(value.key!==key||value.runtime!==runtime||typeof value.pdf!=='string')throw fault(502,'编译结果与源码或运行环境不一致。');
   const bytes=Buffer.from(value.pdf,'base64');if(bytes.length>20*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw fault(502,'编译服务没有返回有效 PDF。');
   const temp=path.join(output,key+'.'+randomUUID()+'.tmp');
   const manifest={protocol,runtime,key,dependencies:job.assets.map(a=>({name:a.name,url:'/media/'+a.name})),created:new Date().toISOString()};
   try{fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,path.join(output,key+'.pdf'));fs.writeFileSync(path.join(output,key+'.json'),JSON.stringify(manifest,null,2))}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
   return {...result,cached:false};
  })();inflight.set(key,promise);try{return await promise}finally{inflight.delete(key)}
 }
 return {compile,output,assets};
}
