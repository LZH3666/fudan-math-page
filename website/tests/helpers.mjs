import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {createApp} from '../server.mjs';

export async function start(dbPath=':memory:',options={}){
 const messages=[];
 const app=createApp({dbPath,test:true,mailer:{send:async m=>messages.push(m)},...options});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(route,{method='GET',body,user,origin=options.config?.publicOrigin||base,csrf=user?.csrf,headers={}}={}){
  return new Promise((resolve,reject)=>{
   const req=http.request(base+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:origin,...(options.config?.production?{Host:new URL(options.config.publicOrigin).host,'X-Forwarded-Proto':'https'}:{}),...(user?{Cookie:user.cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers}},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{const setCookie=res.headers['set-cookie']?.[0];resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString()),cookie:setCookie?.split(';')[0],setCookie})}catch(e){reject(e)}});
   });req.on('error',reject);req.end(method==='GET'?undefined:JSON.stringify(body??{}));
  });
 }
 const token=()=>messages.at(-1).text.match(/\/(?:verify|reset)\/([a-f0-9]{64})/)[1];
 async function register(username){
  const r=await call('/auth/register',{method:'POST',body:{username,email:randomUUID()+'@m.fudan.edu.cn',password:'test-only-password-123'}});assert.equal(r.status,201,JSON.stringify(r.data));
  const verified=await call('/auth/verify-email',{method:'POST',user:{...r.data.user,cookie:r.cookie},body:{token:token()}});assert.equal(verified.status,200,JSON.stringify(verified.data));
  // These CRUD tests explicitly provision an administrator fixture, never via public registration.
  if(!app.db.prepare("SELECT 1 FROM users WHERE role='admin'").get())app.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(r.data.user.id);
  const user={...verified.data.user,cookie:verified.cookie};
  return {...(await call('/state',{user})).data.user,cookie:verified.cookie};
 }
 return {...app,base,call,register,messages,token};
}
