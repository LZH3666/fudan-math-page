import {createHash} from 'node:crypto';
export const protocol='fudan-tex-v2';
export const digest=data=>createHash('sha256').update(data).digest('hex');
export const fault=(status,message)=>Object.assign(new Error(message),{status});
export const assetName=/^[a-f0-9]{64}\.(png|jpg|pdf)$/;
export function validateJob(value){
 if(!value||typeof value.source!=='string'||Buffer.byteLength(value.source)>1000000||!Array.isArray(value.assets)||value.assets.length>32)throw fault(400,'编译输入格式不正确或过大。');
 let total=0;const seen=new Set();
 const assets=value.assets.map(a=>{
  if(!a||!assetName.test(a.name)||seen.has(a.name)||typeof a.data!=='string'||a.data.length>28*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data))throw fault(400,'编译附件格式不正确。');
  seen.add(a.name);const bytes=Buffer.from(a.data,'base64');total+=bytes.length;
  if(total>24*1024*1024||digest(bytes)!==a.name.slice(0,64))throw fault(400,'编译附件内容校验失败。');
  return {name:a.name,data:bytes.toString('base64')};
 }).sort((a,b)=>a.name.localeCompare(b.name));
 return {source:value.source,assets};
}
export function jobKey(job,runtime){return digest(JSON.stringify({protocol,runtime,source:job.source,assets:job.assets.map(a=>({name:a.name,sha256:digest(Buffer.from(a.data,'base64'))}))}))}
export function boundedQueue({limit=4}={}){
 let running=false;const waiting=[];
 async function drain(){if(running||!waiting.length)return;running=true;const task=waiting.shift();try{task.resolve(await task.fn())}catch(e){task.reject(e)}finally{running=false;drain()}}
 return {run(fn){return new Promise((resolve,reject)=>{if(waiting.length>=limit)return reject(fault(429,'编译队列已满，请稍后重试。'));waiting.push({fn,resolve,reject});drain()})},get pending(){return waiting.length},get active(){return running}};
}
