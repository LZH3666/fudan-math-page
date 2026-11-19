import {createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual} from 'node:crypto';

const hash=s=>createHash('sha256').update(s).digest('hex');
const problem=(status,message)=>Object.assign(new Error(message),{status});
export function migrateAuth(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  const columns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
  for(const [name,type] of [['email','TEXT'],['email_verified_at','TEXT']])if(!columns.includes(name))db.exec('ALTER TABLE users ADD COLUMN '+name+' '+type);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;
   CREATE TABLE IF NOT EXISTS auth_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,email TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id,purpose);
   CREATE TABLE IF NOT EXISTS auth_limits(bucket TEXT PRIMARY KEY,n INTEGER NOT NULL,until INTEGER NOT NULL);`);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
export function normalizeEmail(value,domains){
 if(typeof value!=='string'||value.length>254)throw problem(400,'请输入有效的复旦邮箱');
 const email=value.trim().toLowerCase(),parts=email.split('@');
 if(parts.length!==2||!domains.includes(parts[1])||! /^[a-z0-9][a-z0-9._+-]{0,63}$/.test(parts[0])||parts[0].endsWith('.')||parts[0].includes('..'))throw problem(400,'请使用允许的复旦邮箱域名：'+domains.join('、'));
 return email;
}
const cookie=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fudan_session='))?.slice(14)||'';
const passwordValue=value=>{if(typeof value!=='string'||value.length<8||value.length>200)throw problem(400,'密码需为 8–200 位');return value};
function passwordMatches(user,password){
 const derived=scryptSync(typeof password==='string'&&password.length<=200?password:'',user?.salt||'unknown-user',64);
 return !!user&&timingSafeEqual(derived,Buffer.from(user.password_hash,'hex'));
}
export function createAuth({db,config,mailer,clock=Date.now}){
 migrateAuth(db);
 const userById=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
 const localEdit=config.localEdit===true&&config.mode==='local'&&!config.production&&config.mailMode==='file'&&!config.trustedProxies?.length;
 const own=u=>({id:u.id,username:u.username,role:u.role,email:u.email||null,emailVerified:!!u.email_verified_at,localEdit,canEdit:(!!u.email_verified_at||localEdit)&&!u.blocked});
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}};
 function current(req){
  const token=cookie(req);if(!token)return null;
  const u=db.prepare('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.blocked=0').get(hash(token),clock());
  return u?{...own(u),csrf:u.csrf}:null;
 }
 function requireSession(req){const u=current(req);if(!u)throw problem(401,'请先登录');if(req.headers['x-csrf-token']!==u.csrf)throw problem(403,'页面已过期，请刷新后重试');return u}
 function requireEditor(req){const u=requireSession(req);if(!u.canEdit)throw problem(403,'请先绑定并验证复旦邮箱');return u}
 function setCookie(res,value,maxAge){res.setHeader('Set-Cookie',`fudan_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.production?'; Secure':''}`)}
 function session(id,res){
  const u=userById(id);if(!u||u.blocked)throw problem(401,'账号不可用');
  db.prepare('DELETE FROM sessions WHERE expires<?').run(clock());
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,csrf,clock()+7*86400000);setCookie(res,token,604800);
  return {...own(u),csrf};
 }
 function limit(key,max,window){
  const t=clock(),bucket=hash(key);
  db.prepare('DELETE FROM auth_limits WHERE until<=?').run(t);
  const row=db.prepare('SELECT * FROM auth_limits WHERE bucket=?').get(bucket);
  if(row&&row.n>=max)throw problem(429,'操作过于频繁，请稍后重试');
  db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=n+1').run(bucket,t+window);
 }
 function reserveMail(user){
  limit('mail-cooldown:'+user.email,1,60000);
  limit('mail-hour:'+user.email,5,3600000);
 }
 async function issue(user,purpose,origin,reserved=false){
  if(!reserved)reserveMail(user);
  const token=randomBytes(32).toString('hex'),digest=hash(token);
  transaction(()=>{
   db.prepare('DELETE FROM auth_tokens WHERE expires<=? OR (user_id=? AND purpose=?)').run(clock(),user.id,purpose);
   db.prepare('INSERT INTO auth_tokens VALUES(?,?,?,?,?)').run(digest,user.id,purpose,user.email,clock()+(purpose==='verify'?30:15)*60000);
  });
  const url=origin+'/#/account/'+purpose+'/'+token;
  try{await mailer.send({to:user.email,subject:purpose==='verify'?'验证复旦数学资源库邮箱':'重设复旦数学资源库密码',text:(purpose==='verify'?'请在登录该账号后确认邮箱。链接 30 分钟内有效：':'请设置新的登录密码。链接 15 分钟内有效：')+'\n'+url+'\n如非本人操作，请忽略。'})}
  catch{db.prepare('DELETE FROM auth_tokens WHERE token_hash=?').run(digest);throw problem(503,'邮件发送失败，请稍后登录账号重发验证邮件，或重新申请密码恢复。')}
 }
 function tokenRow(value,purpose){
  if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))throw problem(400,'链接无效或已过期');
  const row=db.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND purpose=? AND expires>?').get(hash(value),purpose,clock());
  const u=row&&userById(row.user_id);
  if(!row||!u||u.blocked||u.email!==row.email)throw problem(400,'链接无效或已过期');
  return {row,u};
 }
 async function handle(action,b,req,res,ctx){
  limit('auth-ip:'+ctx.clientIP,30,10*60000);
  if(action==='logout'){
   requireSession(req);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookie(req)));setCookie(res,'',0);return {status:200,data:{ok:true}};
  }
  if(action==='register'||action==='login'){
   if(typeof b.username!=='string'||! /^[\p{L}\p{N}_-]{2,40}$/u.test(b.username.trim()))throw problem(400,'用户名需为 2–40 位文字、数字、下划线或短横线');
   const username=b.username.trim(),key=username.normalize('NFKC').toLowerCase(),password=passwordValue(b.password);
   let u=db.prepare('SELECT * FROM users WHERE username_key=?').get(key);
   if(action==='login'){
    limit('login-name:'+key,10,10*60000);
    if(!passwordMatches(u,password)||u.blocked)throw problem(401,'用户名或密码不正确');
    return {status:200,data:{user:session(u.id,res)}};
   }
   const email=normalizeEmail(b.email,config.emailDomains);
   if(u||db.prepare('SELECT 1 FROM users WHERE email=?').get(email))throw problem(409,'用户名或邮箱已被使用；如邮箱属于你，可使用密码恢复');
   const id=randomUUID(),salt=randomBytes(16).toString('hex'),pw=scryptSync(password,salt,64).toString('hex');
   db.prepare("INSERT INTO users(id,username,username_key,salt,password_hash,role,created,email) VALUES(?,?,?,?,?,'editor',?,?)").run(id,username,key,salt,pw,new Date(clock()).toISOString(),email);
   u=userById(id);await issue(u,'verify',ctx.origin);
   return {status:201,data:{user:session(id,res),message:'请查收验证邮件，验证后即可编辑。'}};
  }
  if(action==='bind-email'){
   const identity=requireSession(req),u=userById(identity.id);
   if(u.email_verified_at)throw problem(409,'邮箱已验证；更换已验证邮箱请联系管理员');
   limit('bind-user:'+u.id,5,3600000);
   if(!passwordMatches(u,b.password))throw problem(401,'当前密码不正确');
   const email=normalizeEmail(b.email,config.emailDomains);
   if(db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email,u.id))throw problem(409,'此邮箱已被使用');
   reserveMail({email});
   transaction(()=>{db.prepare('UPDATE users SET email=?,email_verified_at=NULL WHERE id=?').run(email,u.id);db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(u.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(u.id,hash(cookie(req)))});
   await issue(userById(u.id),'verify',ctx.origin,true);
   return {status:200,data:{user:current(req),message:'请查收验证邮件。'}};
  }
  if(action==='resend-verification'){
   const identity=requireSession(req),u=userById(identity.id);
   if(!u.email)throw problem(400,'请先绑定复旦邮箱');
   if(u.email_verified_at)throw problem(409,'邮箱已验证');
   await issue(u,'verify',ctx.origin);return {status:202,data:{message:'验证邮件已发送。'}};
  }
  if(action==='verify-email'){
   const identity=requireSession(req);
   transaction(()=>{const {u,row}=tokenRow(b.token,'verify');if(u.id!==identity.id)throw problem(403,'请登录申请此验证邮件的账号');db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(new Date(clock()).toISOString(),u.id);db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id)});
   return {status:200,data:{user:session(identity.id,res),message:'邮箱已验证，可以编辑和发布。'}};
  }
  if(action==='forgot-password'){
   let email;try{email=normalizeEmail(b.email,config.emailDomains)}catch{return {status:202,data:{message:'如果邮箱已登记，将收到密码恢复邮件。'}}}
   limit('recovery-email:'+email,5,3600000);
   const u=db.prepare('SELECT * FROM users WHERE email=? AND blocked=0').get(email);
   if(u){try{await issue(u,'reset',ctx.origin)}catch(e){if(![429,503].includes(e.status))throw e}}
   return {status:202,data:{message:'如果邮箱已登记，将收到密码恢复邮件。'}};
  }
  if(action==='reset-password'){
   const password=passwordValue(b.password),salt=randomBytes(16).toString('hex'),pw=scryptSync(password,salt,64).toString('hex');
   transaction(()=>{const {u}=tokenRow(b.token,'reset');db.prepare('UPDATE users SET salt=?,password_hash=?,email_verified_at=coalesce(email_verified_at,?) WHERE id=?').run(salt,pw,new Date(clock()).toISOString(),u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(u.id)});
   setCookie(res,'',0);return {status:200,data:{ok:true,message:'密码已更新，请重新登录。'}};
  }
  throw problem(404,'接口不存在');
 }
 return {current,requireSession,requireEditor,handle};
}
