// Opt-in real Nginx regression test. The broker uses controlled 16s jobs,
// not a TeX runner; actual TeX isolation is covered by isolated.integration.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createWorker} from '../compile-worker.mjs';
import {createIsolatedCompiler} from '../isolated-compiler.mjs';
import {fault} from '../compile-protocol.mjs';
import {start} from './helpers.mjs';

const nginx=process.env.FUDAN_NGINX;
assert.ok(nginx&&path.isAbsolute(nginx),'Set FUDAN_NGINX to the installed Nginx executable');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-proxy-rehearsal-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms)),run=promisify(execFile);
const token=randomBytes(32).toString('hex'),tokenFile=path.join(dir,'token');
fs.writeFileSync(tokenFile,token);
const image='sha256:'+'d'.repeat(64);
let app,worker,proxy,proxyError='',pending=[];
try{
 const template=fs.readFileSync(new URL('../deploy/nginx.conf.example',import.meta.url),'utf8');
 const client=fs.readFileSync(new URL('../isolated-compiler.mjs',import.meta.url),'utf8');
 const proxySeconds=Number(template.match(/proxy_read_timeout\s+(\d+)s;/)?.[1]);
 const clientMs=Number(client.match(/AbortSignal\.timeout\((\d+)\)/)?.[1]);
 assert.ok(proxySeconds*1000>=clientMs+15000,'Proxy must outlast the full compiler client deadline with margin');
 worker=createWorker({token,image,runner:{run:async job=>{
  if(job.source.includes('PROXY-EXPECTED-FAILURE'))throw fault(422,'Controlled compile error');
  await wait(16000);
  return {pdf:Buffer.from('%PDF-1.4\n% Controlled proxy test fixture\n%%EOF').toString('base64')};
 }}});
 await new Promise(r=>worker.server.listen(0,'127.0.0.1',r));
 const compiler=createIsolatedCompiler(dir,{url:'http://127.0.0.1:'+worker.server.address().port,tokenFile,runtime:image});
 app=await start(path.join(dir,'library.sqlite'),{dataDir:dir,compiler});
 const user=await app.register('代理超时验收');app.db.prepare("UPDATE users SET role='editor' WHERE id=?").run(user.id);
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 const location=template.match(/    location \/ \{[\s\S]*?\n    \}/)?.[0];assert.ok(location);
 const adjusted=location.replace('http://127.0.0.1:4318',app.base).replace('Host math.example.org','Host '+new URL(app.base).host);
 fs.mkdirSync(path.join(dir,'logs'));fs.mkdirSync(path.join(dir,'temp'));
 fs.writeFileSync(path.join(dir,'nginx.conf'),`daemon off;\nmaster_process off;\npid logs/nginx.pid;\nerror_log logs/error.log notice;\nevents { worker_connections 128; }\nhttp { access_log logs/access.log; server { listen 127.0.0.1:${port};\n${adjusted}\n} }\n`);
 const args=['-p',dir.replaceAll('\\','/')+'/','-c','nginx.conf'];
 await run(nginx,[...args,'-t'],{windowsHide:true,timeout:10000});
 proxy=spawn(nginx,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
 proxy.on('error',e=>proxyError+=e.message);proxy.stderr.on('data',b=>proxyError+=b);proxy.stdout.resume();
 const base='http://127.0.0.1:'+port;
 async function call(route,{method='GET',body,authenticated=false}={}){
  const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:app.base,...(authenticated?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(190000)});
  const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error('Non-JSON proxy response '+response.status+': '+text.slice(0,200))}
  return {status:response.status,data};
 }
 let ready=false;
 for(let i=0;i<50;i++){try{if((await call('/courses/topology')).status===200){ready=true;break}}catch{}await wait(100)}
 assert.ok(ready,'Nginx did not start: '+proxyError);
 const began=performance.now();
 pending=Array.from({length:5},(_,i)=>call('/courses/topology/documents',{method:'POST',authenticated:true,body:{title:'代理排队 '+i,tex:'Proxy queue job '+i,preamble:'',render_mode:'latex',position:i}}).then(r=>({...r,elapsedMs:Math.round(performance.now()-began)})));
 await wait(1000);assert.equal(worker.queue.active,true);assert.equal(worker.queue.pending,4);
 const reading=await call('/courses/topology');assert.equal(reading.status,200);
 console.log('Real Nginx is serving reads while five controlled save jobs run; last save takes about 80 seconds.');
 const settled=await Promise.allSettled(pending);
 for(const r of settled)assert.equal(r.status,'fulfilled',r.reason?.stack);
 const results=settled.map(r=>r.value);for(const r of results)assert.equal(r.status,201,JSON.stringify(r.data));
 const longest=Math.max(...results.map(r=>r.elapsedMs));assert.ok(longest>75000,'Must cross the former 75 second timeout');
 for(const r of results){const doc=r.data.document;const read=await call('/documents/'+doc.id);assert.equal(read.status,200);assert.equal(read.data.document.version,1);assert.equal(read.data.document.artifact,doc.artifact)}
 const doc=results.at(-1).data.document;
 const failed=await call('/documents/'+doc.id,{method:'PUT',authenticated:true,body:{...doc,tex:'PROXY-EXPECTED-FAILURE'}});assert.equal(failed.status,422);
 const unchanged=(await call('/documents/'+doc.id)).data.document;assert.equal(unchanged.version,1);assert.equal(unchanged.artifact,doc.artifact);
 const version=await run(nginx,['-v'],{windowsHide:true,timeout:10000});
 const result={checkedAt:new Date().toISOString(),scope:'Real loopback HTTP Nginx, real app and broker queue, controlled 16s runner; not TLS, SMTP, real TeX or remote capacity',nginx:version.stderr.trim(),proxyReadTimeoutSeconds:proxySeconds,compilerClientDeadlineMs:clientMs,saveStatuses:results.map(r=>r.status),saveElapsedMs:results.map(r=>r.elapsedMs),peakActive:1,peakPending:4,readingDuringQueueStatus:reading.status,allPublishedVersions:1,compileFailureStatus:failed.status,failedSavePreservesPublishedVersion:true};
 if(process.env.FUDAN_PROXY_EVIDENCE)fs.writeFileSync(process.env.FUDAN_PROXY_EVIDENCE,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{
 await Promise.allSettled(pending);
 if(proxy&&proxy.exitCode===null){const stopped=new Promise(r=>proxy.once('close',r));proxy.kill();await stopped}
 await app?.close();await worker?.close();
 if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fudan-proxy-rehearsal-'))fs.rmSync(dir,{recursive:true,force:true});
}
