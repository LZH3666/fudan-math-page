import http from 'node:http';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateJob,jobKey,boundedQueue,fault} from './compile-protocol.mjs';

export function containerArgs(image,name){
 return ['run','--rm','--pull=never','--name',name,'--label','fudan.role=tex-job','--network=none','--read-only','--user=10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=512m','--memory-swap=512m','--pids-limit=64','--ulimit','nofile=128:128','--ulimit','fsize=20971520:20971520','--tmpfs','/work:rw,noexec,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=700','--workdir=/work','--log-driver=none','-i',image];
}
export function dockerRunner({docker='docker',image,timeout=30000}={}){
 if(!/^sha256:[a-f0-9]{64}$/.test(image||''))throw new Error('编译镜像须固定为本机 sha256 image ID');
 const active=new Set();
 function remove(name){return new Promise(resolve=>{const c=spawn(docker,['rm','-f',name],{stdio:'ignore',windowsHide:true});const timer=setTimeout(()=>{c.kill();resolve(false)},5000);c.on('error',()=>{clearTimeout(timer);resolve(false)});c.on('close',code=>{clearTimeout(timer);resolve(code===0)})})}
 async function run(job){
  const name='fudan-tex-'+randomUUID();active.add(name);
  try{return await new Promise((resolve,reject)=>{
   const c=spawn(docker,containerArgs(image,name),{stdio:['pipe','pipe','pipe'],windowsHide:true});let chunks=[],size=0,reason='',error='',closed=false;
   const stop=msg=>{if(reason)return;reason=msg;void remove(name).finally(()=>c.kill())};
   const timer=setTimeout(()=>stop('编译超过30秒时限，请简化页面或拆分图形。'),timeout);
   const force=setTimeout(()=>{if(!closed){c.kill();reject(fault(503,'容器服务未能及时回收任务，请维护者检查。'))}},timeout+7000);
   c.stdout.on('data',b=>{size+=b.length;if(size>29*1024*1024)stop('编译输出超过限制。');else chunks.push(b)});
   c.stderr.on('data',b=>{error=(error+b.toString()).slice(-1500)});
   c.stdin.on('error',()=>{});c.on('error',()=>{clearTimeout(timer);clearTimeout(force);reject(fault(503,'容器编译服务不可用。'))});
   c.on('close',code=>{closed=true;clearTimeout(timer);clearTimeout(force);if(reason)return reject(fault(422,reason));if(code!==0)return reject(fault(code===125?503:422,code===125?'无法启动隔离编译容器。':'编译任务因错误或资源限制结束。'));
    let value;try{value=JSON.parse(Buffer.concat(chunks).toString())}catch{return reject(fault(422,'编译任务没有返回有效结果。'))}
    if(!value.ok)return reject(fault(422,typeof value.error==='string'?value.error.slice(0,2800):'LaTeX 编译失败。'));resolve(value);
   });c.stdin.end(JSON.stringify(job));
  })}finally{await remove(name);active.delete(name)}
 }
 return {run,close:()=>Promise.all([...active].map(remove)),active};
}
export function createWorker({token,image,runner,docker,timeout}={}){
 if(!/^[a-f0-9]{64}$/.test(token||''))throw new Error('编译服务需要独立的256位凭据');
 const queue=boundedQueue(),executor=runner||dockerRunner({docker,image,timeout});
 const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
  try{
   const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
   if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw fault(401,'编译服务认证失败。');
   if(req.method==='GET'&&req.url==='/health')return send(200,{ok:true,runtime:image,active:queue.active,pending:queue.pending});
   if(req.method!=='POST'||req.url!=='/compile')throw fault(404,'接口不存在。');
   const chunks=[];let length=0;
   for await(const b of req){length+=b.length;if(length>34*1024*1024)throw fault(413,'编译请求过大。');chunks.push(b)}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString())}catch{throw fault(400,'编译请求格式不正确。')}
   const job=validateJob(input),key=jobKey(job,image);
   if(input.runtime!==image||input.key!==key)throw fault(409,'编译镜像或输入版本不一致，请检查部署配置。');
   const out=await queue.run(()=>executor.run(job));send(200,{key,runtime:image,pdf:out.pdf});
  }catch(e){send(e.status||503,{error:e.status?e.message:'编译服务暂不可用。'})}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxConnections=12;
 return {server,queue,close:async()=>{await executor.close?.();await new Promise(r=>{server.close(r);server.closeAllConnections()})}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const token=fs.readFileSync(process.env.FUDAN_COMPILE_TOKEN_FILE,'utf8').trim(),image=process.env.FUDAN_TEX_IMAGE;
 const worker=createWorker({token,image,docker:process.env.FUDAN_DOCKER||'docker'});
 worker.server.listen(Number(process.env.FUDAN_WORKER_PORT||4322),'127.0.0.1',()=>console.log('隔离编译服务 http://127.0.0.1:'+(process.env.FUDAN_WORKER_PORT||4322)));
 for(const s of ['SIGTERM','SIGINT'])process.on(s,async()=>{await worker.close();process.exit(0)});
}
