import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {createCompiler} from '../compiler.mjs';
test('native LaTeX: math packages, Chinese proof, TikZ, pgfplots, image, link, version and restore',async()=>{
 const messages=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-tex-integration-')),app=createApp({dbPath:':memory:',dataDir:dir,test:true,mailer:{send:async m=>messages.push(m)}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;let user;
 async function call(route,method='GET',body){
  const r=await fetch(base+'/api'+route,{method,headers:{Origin:base,'Content-Type':'application/json',...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{})},body:method==='GET'?undefined:JSON.stringify(body)});
  const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  const registered=await call('/auth/register','POST',{username:'完整排版测试',email:'tex-integration@m.fudan.edu.cn',password:'synthetic-test-password'});user={...registered.data.user,cookie:registered.cookie};
  const verified=await call('/auth/verify-email','POST',{token:messages.at(-1).text.match(/verify\/([a-f0-9]{64})/)[1]});user={...verified.data.user,cookie:verified.cookie};
  const png=fs.readFileSync(new URL('./fixtures/image.png',import.meta.url));
  const {data:image}=await call('/assets','POST',{data:png.toString('base64')});
  const tex=String.raw`\section{数学排版}\begin{theorem}对 $x\in\RR$，有 $x^2\geq0$。\end{theorem}
\begin{proof}由实数的序性质可得。\end{proof}
\[\mathds{1}_A,\quad\bm{x},\quad\mathscr{F},\quad\int_0^1x^2\,dx=\frac13.\]
\begin{tikzpicture}\draw[->,thick](0,0)--(2,1);\end{tikzpicture}
\begin{tikzcd}A\arrow[r,"f"]&B\\C\arrow[r,"g"]&D\end{tikzcd}
\begin{tikzpicture}\begin{axis}[width=5cm,height=4cm]\addplot[domain=0:1]{x^2};\end{axis}\end{tikzpicture}
\href{https://example.org}{链接}\includegraphics[width=2cm]{IMAGE}
`.replace('IMAGE',image.url),preamble=String.raw`\newcommand{\RR}{\mathbb{R}}`;
  const {data:created}=await call('/courses/topology/documents','POST',{title:'实际编译',tex,preamble,render_mode:'latex',position:0});
  const d=created.document;assert.ok(d.artifact);assert.equal(d.preamble,preamble);
  const response=await fetch(base+'/compiled/'+d.artifact+'.pdf'),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>5000);
  const {data:history}=await call('/documents/'+d.id+'/history');
  const {data:edited}=await call('/documents/'+d.id,'PUT',{...d,tex:'第二版本',render_mode:'web',summary:'切换排版'});
  const {data:restored}=await call('/documents/'+d.id+'/restore','POST',{version:edited.document.version,revisionId:history.revisions[0].id});
  assert.equal(restored.document.tex,tex);assert.equal(restored.document.preamble,preamble);assert.equal(restored.document.artifact,d.artifact);assert.equal(restored.document.render_mode,'latex');
  console.log('Native PDF bytes:',bytes.length);
 }finally{await app.close();if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fudan-tex-integration-'))fs.rmSync(dir,{recursive:true,force:true})}
});
test('native compiler rejects paths outside its job and stops endless TeX',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-tex-boundary-'));
 try{
  const c=createCompiler(dir),sentinel=path.join(dir,'sentinel.tex');fs.writeFileSync(sentinel,'SYNTHETIC TEST ONLY');
  await assert.rejects(c.compile('\\input{'+sentinel.replaceAll('\\','/')+'}'),e=>e.status===422);
  await assert.rejects(c.compile(String.raw`\newwrite\out\immediate\openout\out=../escape.txt\immediate\write\out{TEST}\immediate\closeout\out`),e=>e.status===422);
  assert.equal(fs.existsSync(path.join(dir,'tex-jobs','escape.txt')),false);
  const fast=createCompiler(dir,{timeout:700});
  await assert.rejects(fast.compile(String.raw`\loop\iftrue\repeat`),e=>e.status===422);
  assert.deepEqual(fs.readdirSync(path.join(dir,'tex-jobs')),[]);
 }finally{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fudan-tex-boundary-'))fs.rmSync(dir,{recursive:true,force:true})}
});

