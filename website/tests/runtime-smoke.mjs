import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-runtime-smoke-'));
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base='http://127.0.0.1:'+port;
const env={...process.env,FUDAN_MODE:'local',FUDAN_BIND:'127.0.0.1',PORT:String(port),FUDAN_PUBLIC_ORIGIN:base,FUDAN_TRUSTED_PROXIES:'',FUDAN_EMAIL_DOMAINS:'fudan.edu.cn,m.fudan.edu.cn',FUDAN_DATA_DIR:dir,FUDAN_DB:path.join(dir,'library.sqlite'),FUDAN_MAIL_MODE:'file',FUDAN_COMPILE_MODE:'disabled'};
let child,user;
async function boot(){
 child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('服务启动超时')),15000);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',code=>{clearTimeout(timer);reject(Error('服务提前退出 '+code))});child.stdout.on('data',()=>{clearTimeout(timer);resolve()});child.stderr.on('data',()=>{})});
}
async function stop(){if(!child||child.exitCode!==null)return;const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped}
async function call(route,method='GET',body){
 const r=await fetch(base+'/api'+route,{method,headers:{Origin:base,'Content-Type':'application/json',...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{})},body:method==='GET'?undefined:JSON.stringify(body)});
 const data=await r.json();assert.ok(r.ok,JSON.stringify(data));if(data.user)user={...data.user,cookie:r.headers.get('set-cookie')?.split(';')[0]||user?.cookie};return data;
}
try{
 await boot();assert.equal((await call('/health')).ok,true);
 await call('/auth/register','POST',{username:'进程测试',password:'synthetic-only-password',email:'runtime-test@m.fudan.edu.cn'});
 const file=fs.readdirSync(path.join(dir,'mail-outbox'))[0],message=JSON.parse(fs.readFileSync(path.join(dir,'mail-outbox',file),'utf8'));
 await call('/auth/verify-email','POST',{token:message.text.match(/verify\/([a-f0-9]{64})/)[1]});assert.equal(user.canEdit,true);
 const {document}=await call('/courses/topology/documents','POST',{title:'重启持久性',tex:'进程重启后仍保留',position:0});
 await stop();user=null;await boot();
 assert.equal((await call('/documents/'+document.id)).document.tex,'进程重启后仍保留');
 await call('/auth/login','POST',{username:'进程测试',password:'synthetic-only-password'});assert.equal(user.canEdit,true);
 console.log('PASS: clean process startup, file-mail verification, direct publication, restart and persistent login/content');
}finally{await stop();if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('fudan-runtime-smoke-'))fs.rmSync(dir,{recursive:true,force:true})}
