import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createWorker,containerArgs} from '../compile-worker.mjs';
import {createIsolatedCompiler,prepareJob} from '../isolated-compiler.mjs';
import {validateJob,jobKey,digest,boundedQueue,fault} from '../compile-protocol.mjs';
import {loadConfig} from '../config.mjs';
import {exportSource} from '../dist/source-export.js';
import {start} from './helpers.mjs';
const image='sha256:'+'a'.repeat(64),pdf=Buffer.from('%PDF-1.7\nsynthetic fixture').toString('base64');
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-isolation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir}

test('content-addressed dependencies reject traversal, missing/mutated bytes and unsafe remote downloads',t=>{
 const dir=temp(t);fs.mkdirSync(path.join(dir,'assets'));const a=path.join(dir,'assets');
 const bytes=Buffer.from('synthetic-png'),name=digest(bytes)+'.png';fs.writeFileSync(path.join(a,name),bytes);
 const job=prepareJob('\\includegraphics{/media/'+name+'}','',a);assert.equal(job.assets.length,1);assert.ok(job.source.includes('{'+name+'}'));assert.ok(!job.source.includes('/media/'));
 assert.notEqual(jobKey(job,image),jobKey(job,'sha256:'+'b'.repeat(64)));
 assert.throws(()=>validateJob({source:'x',assets:[{name:'../secret',data:''}]}));
 fs.writeFileSync(path.join(a,name),'mutated');assert.throws(()=>prepareJob('\\includegraphics{/media/'+name+'}','',a),/校验/);
 assert.throws(()=>prepareJob('\\includegraphics{https://example.test/x.png}','',a),/上传/);
 const exported=exportSource({tex:'\\includegraphics{/media/'+name+'}',preamble:'',render_mode:'latex'},'https://math.example');
 assert.ok(exported.includes('% '+name+' : https://math.example/media/'+name));assert.ok(exported.includes('\\includegraphics{'+name+'}'));
});

test('bounded queue enforces one active task, rejects overflow and proceeds after failure',async()=>{
 const q=boundedQueue({limit:1});let release;const events=[];
 const first=q.run(()=>new Promise(r=>{release=r;events.push('first')}));
 const second=q.run(async()=>{events.push('second');throw fault(422,'invalid')});const rejected=assert.rejects(second,/invalid/);
 await assert.rejects(q.run(async()=>{}),e=>e.status===429);assert.deepEqual(events,['first']);release('ok');assert.equal(await first,'ok');await rejected;assert.deepEqual(events,['first','second']);assert.equal(await q.run(async()=>42),42);
});

test('broker authenticates, validates fixed runtime and client caches/deduplicates exact results',async t=>{
 const dir=temp(t),token=randomBytes(32).toString('hex'),tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,token);let calls=0;
 const worker=createWorker({token,image,runner:{run:async()=>{calls++;return {pdf}}}});
 await new Promise(r=>worker.server.listen(0,'127.0.0.1',r));t.after(()=>worker.close());const url='http://127.0.0.1:'+worker.server.address().port;
 assert.equal((await fetch(url+'/health')).status,401);
 const c=createIsolatedCompiler(dir,{url,tokenFile,runtime:image});const [a,b]=await Promise.all([c.compile('x'),c.compile('x')]);assert.equal(a.artifact,b.artifact);assert.equal(calls,1);assert.equal((await c.compile('x')).cached,true);
 const manifest=JSON.parse(fs.readFileSync(path.join(c.output,a.artifact+'.json')));assert.equal(manifest.runtime,image);
 const wrong=createIsolatedCompiler(dir,{url,tokenFile,runtime:'sha256:'+'b'.repeat(64)});await assert.rejects(wrong.compile('x'),/版本不一致/);
 assert.equal(calls,1);
});

test('unavailable broker and mismatched result cannot publish a PDF',async t=>{
 const dir=temp(t),tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,'c'.repeat(64));
 const bad=createIsolatedCompiler(dir,{url:'http://127.0.0.1:1',tokenFile,runtime:image,request:async()=>new Response(JSON.stringify({key:'wrong',runtime:image,pdf}))});
 await assert.rejects(bad.compile('x'),e=>e.status===502);assert.deepEqual(fs.readdirSync(bad.output),[]);
 const down=createIsolatedCompiler(dir,{url:'http://127.0.0.1:1',tokenFile,runtime:image,request:async()=>{throw Error('private transport detail')}});await assert.rejects(down.compile('x'),e=>e.status===503&&!e.message.includes('private'));
});

test('isolated mode needs fixed image/private credential; container contract gives no host mounts/network/root',()=>{
 assert.throws(()=>loadConfig({FUDAN_COMPILE_MODE:'isolated'}));
 const c=loadConfig({FUDAN_COMPILE_MODE:'isolated',FUDAN_COMPILE_URL:'http://127.0.0.1:4322',FUDAN_COMPILE_TOKEN_FILE:'private-token',FUDAN_TEX_IMAGE:image});assert.equal(c.compileService.runtime,image);
 const args=containerArgs(image,'fudan-test');for(const option of ['--network=none','--read-only','--user=10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--pids-limit=64'])assert.ok(args.includes(option));
 assert.ok(!args.some(x=>x==='--mount'||x==='-v'||x.includes('docker.sock')));assert.equal(args.at(-1),image);
});

test('failed/concurrent compile preserves public revision; restore uses exact prior artifact and detects missing PDF',async t=>{
 const dir=temp(t),output=path.join(dir,'compiled'),assets=path.join(dir,'assets');fs.mkdirSync(output);fs.mkdirSync(assets);let finish,begin;
 const started=new Promise(r=>begin=r);
 const compiler={output,assets,compile:async tex=>{
  if(tex==='invalid')throw fault(422,'LaTeX error');
  if(tex==='slow')await new Promise(r=>{finish=r;begin()});
  const artifact=digest(tex);fs.writeFileSync(path.join(output,artifact+'.pdf'),Buffer.from(pdf,'base64'));return {artifact};
 }};
 const a=await start(':memory:',{dataDir:dir,compiler});t.after(()=>a.close());const user=await a.register('编译用户');
 const first=await a.call('/courses/topology/documents',{method:'POST',user,body:{title:'版本对应',tex:'first',preamble:'',position:0,render_mode:'latex'}});assert.equal(first.status,201);const d=first.data.document;
 const history=(await a.call('/documents/'+d.id+'/history')).data.revisions;
 assert.equal((await a.call('/documents/'+d.id,{method:'PUT',user,body:{...d,tex:'invalid'}})).status,422);
 assert.equal((await a.call('/documents/'+d.id)).data.document.artifact,d.artifact);
 const slow=a.call('/documents/'+d.id,{method:'PUT',user,body:{...d,tex:'slow'}});await started;
 const newer=await a.call('/documents/'+d.id,{method:'PUT',user,body:{...d,tex:'newer',render_mode:'web'}});assert.equal(newer.status,200);finish();assert.equal((await slow).status,409);
 const restored=await a.call('/documents/'+d.id+'/restore',{method:'POST',user,body:{version:newer.data.document.version,revisionId:history[0].id}});assert.equal(restored.status,200);assert.equal(restored.data.document.artifact,d.artifact);assert.equal(restored.data.document.tex,'first');
 fs.unlinkSync(path.join(output,d.artifact+'.pdf'));assert.equal((await a.call('/documents/'+d.id+'/restore',{method:'POST',user,body:{version:restored.data.document.version,revisionId:history[0].id}})).status,409);
});
