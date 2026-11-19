// Bounded local rehearsal; rerun on the selected server before release.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWorker,dockerRunner} from '../compile-worker.mjs';
import {createIsolatedCompiler} from '../isolated-compiler.mjs';
import {start} from './helpers.mjs';

const image=process.env.FUDAN_TEX_IMAGE,docker=process.env.FUDAN_DOCKER||'docker';
assert.match(image||'',/^sha256:[a-f0-9]{64}$/,'Set the tested immutable FUDAN_TEX_IMAGE');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-release-load-'));
const token=randomBytes(32).toString('hex'),tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,token);
const runner=dockerRunner({docker,image}),worker=createWorker({token,image,runner});
let app,monitor,peakRss=0,peakPending=0,peakActive=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),run=promisify(execFile);
try{
 await new Promise(r=>worker.server.listen(0,'127.0.0.1',r));
 const compiler=createIsolatedCompiler(dir,{url:'http://127.0.0.1:'+worker.server.address().port,tokenFile,runtime:image});
 app=await start(path.join(dir,'library.sqlite'),{dataDir:dir,compiler});
 const user=await app.register('负载验收');app.db.prepare("UPDATE users SET role='editor' WHERE id=?").run(user.id);
 const times=[];const statuses=[];
 async function reading(n){for(let i=0;i<n;i++){const t=performance.now(),r=await app.call('/courses/topology');assert.equal(r.status,200);times.push(performance.now()-t);await wait(30)}}
 monitor=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);peakPending=Math.max(peakPending,worker.queue.pending);peakActive=Math.max(peakActive,runner.active.size)},10);
 const began=performance.now();
 const jobs=Array.from({length:6},(_,i)=>app.call('/preview',{method:'POST',user,body:{tex:'\\section{并发验收 '+i+'} $x^2\\geq0$。',preamble:''}}).then(r=>{statuses.push(r.status);return r}));
 const reads=Array.from({length:8},()=>reading(20));
 await wait(1200);
 const name=[...runner.active][0];let containerSample=null;
 if(name){try{const out=await run(docker,['stats','--no-stream','--format','{{json .}}',name],{timeout:10000,windowsHide:true});containerSample=JSON.parse(out.stdout.trim())}catch{containerSample={unavailable:true}}}
 await Promise.all([...jobs,...reads]);
 assert.deepEqual([...statuses].sort(),[200,200,200,200,200,429]);
 assert.equal(peakActive,1);assert.equal(peakPending,4);assert.equal(runner.active.size,0);
 const sorted=times.toSorted((a,b)=>a-b),p95=sorted[Math.ceil(sorted.length*.95)-1];
 assert.ok(p95<2000,'Local reading p95 must remain below 2 seconds');
 assert.equal((await app.call('/preview',{method:'POST',user,body:{tex:'失败测试 \\missingLoadProbe'}})).status,422);
 assert.equal((await app.call('/preview',{method:'POST',user,body:{tex:'错误后仍可正常编译 $1+1=2$。'}})).status,200);
 const result={checkedAt:new Date().toISOString(),scope:'local synthetic data; not remote or campus performance',platform:process.platform,node:process.version,image,readRequests:times.length,readConcurrency:8,readErrors:0,readP95Ms:Math.round(p95),readMaxMs:Math.round(Math.max(...times)),compileRequests:6,compileStatuses:statuses,peakActive,peakPending,combinedNodeRssMiB:Math.round(peakRss/1024/1024),containerSample,durationSeconds:Math.round((performance.now()-began)/1000),recoversAfterCompileError:true,taskLimits:{cpu:1,memoryMiB:512,pids:64,timeoutSeconds:30}};
 if(process.env.FUDAN_LOAD_EVIDENCE)fs.writeFileSync(process.env.FUDAN_LOAD_EVIDENCE,JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{
 clearInterval(monitor);await worker.close();await app?.close();
 if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fudan-release-load-'))fs.rmSync(dir,{recursive:true,force:true});
}
