// Opt-in real Docker acceptance: FUDAN_TEX_IMAGE and FUDAN_DOCKER must be set.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {dockerRunner,createWorker,containerArgs} from '../compile-worker.mjs';
import {createIsolatedCompiler} from '../isolated-compiler.mjs';
import {start} from './helpers.mjs';

const image=process.env.FUDAN_TEX_IMAGE,docker=process.env.FUDAN_DOCKER||'docker';
assert.match(image||'',/^sha256:[a-f0-9]{64}$/,'Set the tested immutable FUDAN_TEX_IMAGE');
function temp(t,beforeCleanup=async()=>{}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-docker-'));t.after(async()=>{await beforeCleanup();fs.rmSync(dir,{recursive:true,force:true})});return dir}
function command(args,input){return new Promise((resolve,reject)=>{
 const child=spawn(docker,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const timer=setTimeout(()=>child.kill(),45000);
 child.on('error',reject);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 child.stdin.on('error',()=>{});child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr})});child.stdin.end(input);
})}
async function probe(script){
 const name='fudan-probe-'+randomUUID(),args=containerArgs(image,name);args.splice(-1,0,'--entrypoint=python3');
 try{return await command([...args,'-I','-c',script])}finally{await command(['rm','-f',name])}
}
test('real broker: Chinese/math/TikZ/plots/image; direct publication, failed save, cache, conflict, restore and restart',async t=>{
 let a,worker;
 const dir=temp(t,async()=>{await a?.close();await worker?.close()}),token=randomBytes(32).toString('hex'),tokenFile=path.join(dir,'token');fs.writeFileSync(tokenFile,token);
 const actual=dockerRunner({docker,image});let calls=0,signal;const started=new Promise(r=>signal=r);
 worker=createWorker({token,image,runner:{run:job=>{calls++;if(job.source.includes('CONFLICT-PROBE'))signal();return actual.run(job)},close:()=>actual.close()}});
 await new Promise(r=>worker.server.listen(0,'127.0.0.1',r));
 const compiler=createIsolatedCompiler(dir,{url:'http://127.0.0.1:'+worker.server.address().port,tokenFile,runtime:image});
 const dbPath=path.join(dir,'library.sqlite');a=await start(dbPath,{dataDir:dir,compiler});
 const user=await a.register('容器排版验收');a.db.prepare("UPDATE users SET role='editor' WHERE id=?").run(user.id);
 const upload=await a.call('/assets',{method:'POST',user,body:{data:fs.readFileSync(new URL('./fixtures/image.png',import.meta.url)).toString('base64')}});assert.equal(upload.status,201);
 const tex=String.raw`\section{数学排版}\begin{theorem}对 $x\in\RR$，有 $x^2\geq0$。\end{theorem}
\begin{proof}由实数的序性质可得。\end{proof}
\[\mathds{1}_A,\quad\bm{x},\quad\mathscr{F},\quad\int_0^1x^2\,dx=\frac13.\]
\begin{tikzpicture}\draw[->,thick](0,0)--(2,1);\end{tikzpicture}
\begin{tikzcd}A\arrow[r,"f"]&B\\C\arrow[r,"g"]&D\end{tikzcd}
\begin{tikzpicture}\begin{axis}[width=5cm,height=4cm]\addplot[domain=0:1]{x^2};\end{axis}\end{tikzpicture}
\href{https://example.org}{链接}\includegraphics[width=2cm]{IMAGE}`.replace('IMAGE',upload.data.url);
 const preamble=String.raw`\newcommand{\RR}{\mathbb{R}}`;
 const created=await a.call('/courses/topology/documents',{method:'POST',user,body:{title:'容器实际编译',tex,preamble,render_mode:'latex',position:0}});
 assert.equal(created.status,201,JSON.stringify(created.data));const d=created.data.document;
 const read=await a.call('/documents/'+d.id);assert.equal(read.data.document.tex,tex);
 const pdf=Buffer.from(await (await fetch(a.base+'/compiled/'+d.artifact+'.pdf')).arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>10000);
 const manifest=JSON.parse(fs.readFileSync(path.join(compiler.output,d.artifact+'.json')));assert.equal(manifest.runtime,image);assert.equal(manifest.dependencies.length,1);
 const before=calls;assert.equal((await compiler.compile(tex,preamble)).cached,true);assert.equal(calls,before);
 const history=(await a.call('/documents/'+d.id+'/history')).data.revisions;
 const failed=await a.call('/documents/'+d.id,{method:'PUT',user,body:{...d,tex:'\\undefinedControlSequenceForTest'}});assert.equal(failed.status,422);
 assert.equal((await a.call('/documents/'+d.id)).data.document.artifact,d.artifact);
 const slow=a.call('/documents/'+d.id,{method:'PUT',user,body:{...d,tex:tex+'\n% CONFLICT-PROBE'}});await started;
 const newer=await a.call('/documents/'+d.id,{method:'PUT',user,body:{...d,tex:'并发的新公开版本',render_mode:'web'}});assert.equal(newer.status,200);assert.equal((await slow).status,409);
 const restored=await a.call('/documents/'+d.id+'/restore',{method:'POST',user,body:{version:newer.data.document.version,revisionId:history[0].id}});assert.equal(restored.status,200);assert.equal(restored.data.document.artifact,d.artifact);
 await a.close();a=await start(dbPath,{dataDir:dir,compiler});assert.equal((await a.call('/documents/'+d.id)).data.document.artifact,d.artifact);
 assert.deepEqual(Buffer.from(await (await fetch(a.base+'/compiled/'+d.artifact+'.pdf')).arrayBuffer()),pdf);
 if(process.env.FUDAN_EVIDENCE_DIR){fs.mkdirSync(process.env.FUDAN_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.FUDAN_EVIDENCE_DIR,'math-sample.pdf'),pdf)}
 if(process.env.FUDAN_EXAM_SOURCE){
  const exam=JSON.parse(fs.readFileSync(process.env.FUDAN_EXAM_SOURCE)),result=await compiler.compile(exam.tex,exam.preamble||'');
  if(process.env.FUDAN_EVIDENCE_DIR)fs.copyFileSync(path.join(compiler.output,result.artifact+'.pdf'),path.join(process.env.FUDAN_EVIDENCE_DIR,'existing-exam.pdf'));
 }
 console.log('Actual isolated PDF bytes:',pdf.length,'Docker calls:',calls);
});

test('actual task settings and filesystem/network/cross-task/output isolation',async()=>{
 const name='fudan-inspect-'+randomUUID(),args=containerArgs(image,name);args.splice(-1,0,'--entrypoint=python3');
 const running=command([...args,'-I','-c','import time;time.sleep(8)']);let details;
 try{
  for(let i=0;i<20;i++){const r=await command(['inspect',name]);if(r.code===0){details=JSON.parse(r.stdout)[0];break}await new Promise(r=>setTimeout(r,150))}
  assert.ok(details);const h=details.HostConfig;
  assert.equal(details.Config.User,'10001:10001');assert.equal(h.NetworkMode,'none');assert.equal(h.ReadonlyRootfs,true);assert.equal(h.Memory,512*1024*1024);assert.equal(h.MemorySwap,h.Memory);assert.equal(h.NanoCpus,1e9);assert.equal(h.PidsLimit,64);assert.ok(h.CapDrop.includes('ALL'));assert.ok(h.SecurityOpt.includes('no-new-privileges'));assert.deepEqual(details.Mounts,[]);assert.equal(h.Binds,null);assert.match(h.Tmpfs['/work'],/size=67108864/);
 }finally{await command(['rm','-f',name]);await running}
 const r=await probe(`import os,socket,json,resource,errno
from pathlib import Path
assert os.getuid()==10001
assert not Path('/var/run/docker.sock').exists()
try: Path('/opt/escape').write_text('x'); raise AssertionError('root writable')
except OSError as e: assert e.errno in (errno.EROFS,errno.EACCES)
assert not Path('/work/previous-task').exists()
Path('/work/previous-task').write_text('only this task')
s=socket.socket();s.settimeout(1)
try: s.connect(('1.1.1.1',443)); raise AssertionError('network allowed')
except OSError: pass
assert resource.getrlimit(resource.RLIMIT_FSIZE)==(20971520,20971520)
try: Path('/work/oversize').write_bytes(b'x'*(22*1024*1024)); raise AssertionError('unlimited file')
except OSError as e: assert e.errno==errno.EFBIG
assert 'NoNewPrivs:\t1' in Path('/proc/self/status').read_text()
print(json.dumps({'uid':os.getuid(),'network':'denied','root':'readonly','file_limit':'enforced'}))`);
 assert.equal(r.code,0,r.stderr);console.log(r.stdout.trim());
 const next=await probe("from pathlib import Path;assert not Path('/work/previous-task').exists();print('fresh workdir')");assert.equal(next.code,0,next.stderr);
 const memory=await probe("x=bytearray(700*1024*1024);print('unexpected allocation')");assert.equal(memory.code,137,memory.stderr);assert.equal(memory.stdout.trim(),'');
});

test('real TeX rejects external reads, disables shell escape and removes timed-out tasks',async t=>{
 const dir=temp(t),tokenFile=path.join(dir,'token'),token=randomBytes(32).toString('hex');fs.writeFileSync(tokenFile,token);
 const runner=dockerRunner({docker,image}),worker=createWorker({token,image,runner});
 await new Promise(r=>worker.server.listen(0,'127.0.0.1',r));t.after(()=>worker.close());
 const c=createIsolatedCompiler(dir,{url:'http://127.0.0.1:'+worker.server.address().port,tokenFile,runtime:image});
 await assert.rejects(c.compile(String.raw`\input{/etc/passwd}`),e=>e.status===422);
 await c.compile(String.raw`\immediate\write18{touch /work/escaped}\IfFileExists{escaped}{\errmessage{shell escape enabled}}{Shell escape disabled}`);
 const fast=dockerRunner({docker,image,timeout:2000});
 await assert.rejects(fast.run({source:String.raw`\documentclass{article}\begin{document}\loop\iftrue\repeat\end{document}`,assets:[]}),e=>e.status===422);assert.equal(fast.active.size,0);
 assert.equal(runner.active.size,0);
 const leftovers=await command(['ps','-aq','--filter','label=fudan.role=tex-job']);assert.equal(leftovers.stdout.trim(),'');
});
