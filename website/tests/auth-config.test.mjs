import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,scryptSync} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {migrateAuth,normalizeEmail} from '../auth.mjs';
import {loadConfig,requestContext} from '../config.mjs';
import {createMailer} from '../mailer.mjs';
import {start} from './helpers.mjs';

const password='synthetic-test-password';
const asUser=r=>({...r.data.user,cookie:r.cookie});
async function pending(a,name='学生用户',email=randomUUID()+'@m.fudan.edu.cn'){
 const r=await a.call('/auth/register',{method:'POST',body:{username:name,email,password}});
 assert.equal(r.status,201,JSON.stringify(r.data));return asUser(r);
}
async function verify(a,user,token=a.token()){
 const r=await a.call('/auth/verify-email',{method:'POST',user,body:{token}});assert.equal(r.status,200,JSON.stringify(r.data));return asUser(r);
}
const production=()=>loadConfig({FUDAN_MODE:'production',FUDAN_PUBLIC_ORIGIN:'https://math.example.test',FUDAN_TRUSTED_PROXIES:'127.0.0.1',FUDAN_SMTP_HOST:'smtp.example.test',FUDAN_SMTP_USER:'synthetic',FUDAN_SMTP_PASS:'synthetic-not-real',FUDAN_MAIL_FROM:'site@example.test'});

test('operator CLI promotes only verified unblocked users and revokes sessions',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-admin-'));const dbPath=path.join(dir,'library.sqlite');
 const a=await start(dbPath);t.after(async()=>{await a.close();fs.rmSync(dir,{recursive:true,force:true})});
 const u=await pending(a);const run=()=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/admin.mjs',import.meta.url)),'promote',u.username],{env:{...process.env,FUDAN_MODE:'local',FUDAN_DB:dbPath,FUDAN_DATA_DIR:dir},encoding:'utf8'});
 assert.notEqual(run().status,0);const v=await verify(a,u);assert.equal(run().status,0);
 assert.equal(a.db.prepare('SELECT role FROM users WHERE id=?').get(u.id).role,'admin');assert.equal((await a.call('/state',{user:v})).data.user,null);
 a.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(u.id);assert.notEqual(run().status,0);
});

test('legacy account migration is idempotent, preserving credentials, role and author IDs',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,username_key TEXT,salt TEXT,password_hash TEXT,role TEXT,blocked INTEGER,created TEXT); CREATE TABLE revisions(id INTEGER,user_id TEXT);');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('original','原账号','原账号','original-salt','original-hash','admin',0,'original-time');db.exec("INSERT INTO revisions VALUES(1,'original')");
  const before=db.prepare('SELECT * FROM users').get();migrateAuth(db);migrateAuth(db);
  const after=db.prepare('SELECT * FROM users').get();for(const [k,v] of Object.entries(before))assert.equal(after[k],v);
  assert.equal(after.email,null);assert.equal(after.email_verified_at,null);assert.equal(db.prepare('SELECT user_id FROM revisions').get().user_id,'original');
 }finally{db.close()}
});

test('Fudan email allowlist matches exact domains, rejects spoofed suffixes and normalizes case',()=>{
 const domains=loadConfig().emailDomains;
 assert.equal(normalizeEmail(' Student@M.FUDAN.EDU.CN ',domains),'student@m.fudan.edu.cn');
 assert.equal(normalizeEmail('teacher@fudan.edu.cn',domains),'teacher@fudan.edu.cn');
 for(const e of ['a@fudan.edu.cn.evil.test','a@evilfudan.edu.cn','a@sub.fudan.edu.cn','a@@fudan.edu.cn','a\r\n@fudan.edu.cn','a..b@fudan.edu.cn','<a@fudan.edu.cn>'])assert.throws(()=>normalizeEmail(e,domains));
});

test('registration never grants admin; verified editors publish directly while pending users cannot write',async t=>{
 const a=await start();t.after(()=>a.close());const u=await pending(a);
 assert.equal(u.role,'editor');assert.equal(u.canEdit,false);assert.equal(u.emailVerified,false);
 for(const [route,body] of [['/courses',{title:'拒绝',subject:'analysis'}],['/assets',{data:''}],['/preview',{tex:'test'}],['/documents/'+(await a.call('/courses/topology')).data.home.id+'/comments',{body:'拒绝'}]])assert.equal((await a.call(route,{method:'POST',user:u,body})).status,403);
 const token=a.token();assert.doesNotMatch(JSON.stringify(u),new RegExp(token));assert.equal(a.db.prepare('SELECT token_hash FROM auth_tokens').get().token_hash.length,64);assert.notEqual(a.db.prepare('SELECT token_hash FROM auth_tokens').get().token_hash,token);
 const editor=await verify(a,u,token);assert.equal(editor.canEdit,true);
 assert.equal((await a.call('/state',{user:u})).data.user,null,'verification invalidates pending sessions');
 assert.equal((await a.call('/auth/verify-email',{method:'POST',user:editor,body:{token}})).status,400);
 const created=await a.call('/courses/topology/documents',{method:'POST',user:editor,body:{title:'直接发布',tex:'公开正文',position:0}});assert.equal(created.status,201);
 assert.equal((await a.call('/documents/'+created.data.document.id)).data.document.tex,'公开正文');
 assert.equal((await a.call('/documents/'+created.data.document.id+'/protect',{method:'POST',user:editor,body:{version:1,protected:true}})).status,403);
 a.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(editor.id);
 assert.equal((await a.call('/courses',{method:'POST',user:editor,body:{title:'拒绝',subject:'analysis'}})).status,401);
});

test('email tokens require correct account, expire, and resend invalidates earlier links',async t=>{
 let time=Date.now();const a=await start(':memory:',{clock:()=>time});t.after(()=>a.close());
 const u=await pending(a,'用户甲'),first=a.token(),v=await pending(a,'用户乙');
 assert.equal((await a.call('/auth/verify-email',{method:'POST',user:v,body:{token:first}})).status,403);
 assert.equal((await a.call('/auth/resend-verification',{method:'POST',user:u})).status,429);
 assert.equal((await a.call('/auth/bind-email',{method:'POST',user:u,body:{email:u.email,password}})).status,429);
 assert.ok(a.db.prepare('SELECT 1 FROM auth_tokens WHERE user_id=?').get(u.id),'throttled binding retains the existing token');
 time+=61000;assert.equal((await a.call('/auth/resend-verification',{method:'POST',user:u})).status,202);
 const second=a.token();assert.notEqual(first,second);
 assert.equal((await a.call('/auth/verify-email',{method:'POST',user:u,body:{token:first}})).status,400);
 time+=31*60000;assert.equal((await a.call('/auth/verify-email',{method:'POST',user:u,body:{token:second}})).status,400);
 time+=61000;await a.call('/auth/resend-verification',{method:'POST',user:u});assert.equal((await verify(a,u)).canEdit,true);
});

test('old accounts bind with their original password and retain ID and administrator role',async t=>{
 const a=await start();t.after(()=>a.close());const salt='synthetic-salt';
 a.db.prepare("INSERT INTO users(id,username,username_key,salt,password_hash,role,created) VALUES(?,?,?,?,?,'admin',?)").run('legacy-id','旧账号','旧账号',salt,scryptSync(password,salt,64).toString('hex'),'old-time');
 const login=await a.call('/auth/login',{method:'POST',body:{username:'旧账号',password}}),u=asUser(login);assert.equal(u.canEdit,false);
 assert.equal((await a.call('/auth/bind-email',{method:'POST',user:u,body:{email:'legacy@fudan.edu.cn',password:'wrong-password'}})).status,401);
 const bound=await a.call('/auth/bind-email',{method:'POST',user:u,body:{email:'legacy@fudan.edu.cn',password}});assert.equal(bound.status,200);
 const editor=await verify(a,u);assert.equal(editor.id,'legacy-id');assert.equal(editor.role,'admin');
 assert.equal((await a.call('/subjects',{method:'POST',user:editor,body:{title:'管理员操作',position:50}})).status,201);
 assert.equal((await a.call('/auth/register',{method:'POST',body:{username:'重复邮箱',password,email:'LEGACY@FUDAN.EDU.CN'}})).status,409);
});

test('recovery is generic; reset is single-use, proves email ownership and invalidates all old sessions',async t=>{
 let time=Date.now();const a=await start(':memory:',{clock:()=>time});t.after(()=>a.close());const u=await pending(a,'找回用户');
 time+=61000;
 const known=await a.call('/auth/forgot-password',{method:'POST',body:{email:u.email}}),token=a.token();
 const unknown=await a.call('/auth/forgot-password',{method:'POST',body:{email:'not-registered@fudan.edu.cn'}});assert.deepEqual(known.data,unknown.data);assert.equal(known.status,202);
 const results=await Promise.all([1,2].map(()=>a.call('/auth/reset-password',{method:'POST',body:{token,password:'updated-synthetic-password'}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal((await a.call('/state',{user:u})).data.user,null);
 assert.equal((await a.call('/auth/login',{method:'POST',body:{username:u.username,password}})).status,401);
 const login=await a.call('/auth/login',{method:'POST',body:{username:u.username,password:'updated-synthetic-password'}});assert.equal(login.status,200);assert.equal(login.data.user.canEdit,true);
 assert.equal(a.db.prepare('SELECT count(*) n FROM auth_tokens').get().n,0);
 time+=61000;await a.call('/auth/forgot-password',{method:'POST',body:{email:u.email}});const expired=a.token();time+=16*60000;
 assert.equal((await a.call('/auth/reset-password',{method:'POST',body:{token:expired,password}})).status,400);
});

test('mail failures leave a recoverable pending account without usable token or exposed transport details',async t=>{
 const a=await start(':memory:',{mailer:{send:async()=>{throw Error('synthetic-SMTP-password-must-not-leak')}}});t.after(()=>a.close());
 const r=await a.call('/auth/register',{method:'POST',body:{username:'失败用户',password,email:'failed@fudan.edu.cn'}});
 assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r.data),/synthetic-SMTP/);assert.equal(a.db.prepare('SELECT count(*) n FROM auth_tokens').get().n,0);
 const login=await a.call('/auth/login',{method:'POST',body:{username:'失败用户',password}});assert.equal(login.status,200);assert.equal(login.data.user.canEdit,false);
});

test('file mail transport is local only and its token-bearing output is not served over HTTP',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-mail-test-'));
 const mailer=createMailer(loadConfig(),dir);await mailer.send({to:'synthetic@fudan.edu.cn',subject:'测试',text:'SYNTHETIC-TOKEN'});
 const files=fs.readdirSync(path.join(dir,'mail-outbox'));assert.equal(files.length,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'mail-outbox',files[0]),'utf8')).text,'SYNTHETIC-TOKEN');
 await assert.rejects(createMailer({...loadConfig(),production:true},dir).send({}),/禁止/);
 const a=await start(':memory:',{dataDir:dir});t.after(async()=>{await a.close();fs.rmSync(dir,{recursive:true,force:true})});
 assert.equal((await fetch(a.base+'/mail-outbox/'+files[0])).status,404);
});

test('production configuration fails closed for insecure origins, mail, proxies, and native compilation',()=>{
 const cfg=production();assert.equal(cfg.compileMode,'disabled');
 for(const env of [{FUDAN_MODE:'production'},{FUDAN_MODE:'oops'},{FUDAN_BIND:'0.0.0.0'},{FUDAN_PUBLIC_ORIGIN:'http://evil.test'},{FUDAN_PUBLIC_ORIGIN:'http://localhost/path'},{FUDAN_TRUSTED_PROXIES:'*'},{FUDAN_EMAIL_DOMAINS:'*.fudan.edu.cn'}])assert.throws(()=>loadConfig(env));
 const env={FUDAN_MODE:'production',FUDAN_PUBLIC_ORIGIN:'https://math.example.test',FUDAN_TRUSTED_PROXIES:'127.0.0.1',FUDAN_SMTP_HOST:'smtp.example.test',FUDAN_SMTP_USER:'test',FUDAN_SMTP_PASS:'test',FUDAN_MAIL_FROM:'test@example.test'};
 for(const extra of [{FUDAN_PUBLIC_ORIGIN:'http://math.example.test'},{FUDAN_MAIL_MODE:'file'},{FUDAN_COMPILE_MODE:'native'},{FUDAN_TRUSTED_PROXIES:''}])assert.throws(()=>loadConfig({...env,...extra}));
});

test('forwarding headers only come from exact trusted proxies and one client IP',()=>{
 const cfg=production(),base={method:'POST',socket:{remoteAddress:'::ffff:127.0.0.1'},headers:{host:'math.example.test',origin:'https://math.example.test','x-forwarded-proto':'https','x-forwarded-for':'203.0.113.20'}};
 assert.equal(requestContext(base,4318,cfg).clientIP,'203.0.113.20');
 assert.throws(()=>requestContext({...base,socket:{remoteAddress:'203.0.113.99'}},4318,cfg));
 for(const extra of [{host:'evil.test'},{origin:'https://evil.test'},{'x-forwarded-proto':'http'},{'x-forwarded-for':'203.0.113.20, 127.0.0.1'}])assert.throws(()=>requestContext({...base,headers:{...base.headers,...extra}},4318,cfg));
 const local={method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:4318','x-forwarded-for':'203.0.113.99'}};
 assert.equal(requestContext(local,4318,loadConfig()).clientIP,'127.0.0.1');
});

test('production proxy integration provides Secure cookies, HTTPS mail links and separate client rate limits',async t=>{
 const a=await start(':memory:',{config:production()});t.after(()=>a.close());const u=await pending(a,'正式测试');
 assert.match(a.messages[0].text,/https:\/\/math.example.test\/#\/account\/verify\//);
 const r=await a.call('/auth/verify-email',{method:'POST',user:u,body:{token:a.token()}});assert.match(r.setCookie,/; Secure/);
 const editor=asUser(r);assert.equal((await a.call('/preview',{method:'POST',user:editor,body:{tex:'test'}})).status,503);
 assert.equal((await a.call('/state',{headers:{Host:'evil.test'}})).status,403);
 for(let i=0;i<30;i++)assert.equal((await a.call('/auth/forgot-password',{method:'POST',body:{email:'invalid'},headers:{'X-Forwarded-For':'203.0.113.10'}})).status,202);
 assert.equal((await a.call('/auth/forgot-password',{method:'POST',body:{email:'invalid'},headers:{'X-Forwarded-For':'203.0.113.10'}})).status,429);
 assert.equal((await a.call('/auth/forgot-password',{method:'POST',body:{email:'invalid'},headers:{'X-Forwarded-For':'203.0.113.11'}})).status,202);
});

test('rate limits persist across restart and untrusted forwarding cannot evade them',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-auth-restart-')),file=path.join(dir,'site.sqlite');let a=await start(file);
 try{
  for(let i=0;i<30;i++)assert.equal((await a.call('/auth/forgot-password',{method:'POST',body:{email:'invalid'},headers:{'X-Forwarded-For':'203.0.113.'+i}})).status,202);
  await a.close();a=await start(file);
  assert.equal((await a.call('/auth/forgot-password',{method:'POST',body:{email:'invalid'}})).status,429);
 }finally{await a.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('explicit local editing preserves unverified identity, CSRF, bans and page protection',async t=>{
 const config=loadConfig({FUDAN_LOCAL_EDIT:'1'});
 const a=await start(':memory:',{config});t.after(()=>a.close());
 const salt='local-test';
 a.db.prepare("INSERT INTO users(id,username,username_key,salt,password_hash,role,created) VALUES(?,?,?,?,?,'editor',?)").run('local-id','本机用户','本机用户',salt,scryptSync(password,salt,64).toString('hex'),'old-time');
 const r=await a.call('/auth/login',{method:'POST',body:{username:'本机用户',password}}),u=asUser(r);
 assert.equal(u.canEdit,true);assert.equal(u.emailVerified,false);assert.equal(u.email,null);
 const course=(await a.call('/courses/topology')).data;
 assert.equal((await a.call('/courses/topology/documents',{method:'POST',user:u,body:{title:'本机测试',tex:'测试正文',position:0}})).status,201);
 assert.equal((await a.call('/courses',{method:'POST',user:u,csrf:'wrong',body:{title:'拒绝',subject:'analysis'}})).status,403);
 assert.equal((await a.call('/documents/'+course.home.id+'/protect',{method:'POST',user:u,body:{version:1,protected:true}})).status,403);
 assert.equal(a.db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(u.id).email_verified_at,null);
 a.db.prepare('UPDATE users SET blocked=1 WHERE id=?').run(u.id);
 assert.equal((await a.call('/courses',{method:'POST',user:u,body:{title:'拒绝',subject:'analysis'}})).status,401);
});
test('local editing is opt-in and refuses production, SMTP and proxy configuration',()=>{
 assert.equal(loadConfig().localEdit,false);
 assert.throws(()=>loadConfig({FUDAN_LOCAL_EDIT:'yes'}));
 assert.throws(()=>loadConfig({FUDAN_LOCAL_EDIT:'1',FUDAN_TRUSTED_PROXIES:'127.0.0.1'}));
 assert.throws(()=>loadConfig({FUDAN_LOCAL_EDIT:'1',FUDAN_MAIL_MODE:'smtp'}));
 assert.throws(()=>loadConfig({FUDAN_LOCAL_EDIT:'1',FUDAN_MODE:'production',FUDAN_PUBLIC_ORIGIN:'https://math.example.test',FUDAN_TRUSTED_PROXIES:'127.0.0.1'}));
});
