import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isIP} from 'node:net';

const root=path.dirname(fileURLToPath(import.meta.url));
const fail=message=>{throw new Error('配置错误：'+message)};
const list=value=>String(value||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
export const normalizeIP=value=>String(value||'').replace(/^::ffff:/,'');
function integer(value,fallback,label,min=1,max=65535){
 const n=value===undefined||value===''?fallback:Number(value);
 if(!Number.isInteger(n)||n<min||n>max)fail(label+'不正确');
 return n;
}
export function loadConfig(env={}){
 const mode=env.FUDAN_MODE||'local';
 if(!['local','production'].includes(mode))fail('FUDAN_MODE 只能为 local 或 production');
 const production=mode==='production';
 const bind=env.FUDAN_BIND||'127.0.0.1';
 if(!['127.0.0.1','::1'].includes(bind))fail('当前阶段仅允许回环监听；正式环境通过反向代理接入');
 let publicOrigin='';
 if(env.FUDAN_PUBLIC_ORIGIN){
  let u;try{u=new URL(env.FUDAN_PUBLIC_ORIGIN)}catch{fail('站点地址无效')}
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail('站点地址只能包含协议、主机和端口');
  if(production?u.protocol!=='https:':!['http:','https:'].includes(u.protocol))fail('正式站点必须使用 HTTPS');
  if(!production&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))fail('本机模式仅允许回环站点地址');
  publicOrigin=u.origin;
 }
 if(production&&!publicOrigin)fail('正式模式需要 FUDAN_PUBLIC_ORIGIN');
 const trustedProxies=list(env.FUDAN_TRUSTED_PROXIES).map(normalizeIP);
 if(trustedProxies.some(ip=>!isIP(ip)))fail('可信代理必须是精确 IP，不接受通配或网段');
 if(production&&!trustedProxies.length)fail('正式模式需要明确配置可信反向代理 IP');
 const emailDomains=list(env.FUDAN_EMAIL_DOMAINS||'fudan.edu.cn,m.fudan.edu.cn');
 if(!emailDomains.length||emailDomains.some(d=>! /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)))fail('邮箱域名清单无效');
 const mailMode=env.FUDAN_MAIL_MODE||(production?'smtp':'file');
 if(env.FUDAN_LOCAL_EDIT!==undefined&&!['0','1'].includes(env.FUDAN_LOCAL_EDIT))fail('FUDAN_LOCAL_EDIT 只能为 0 或 1');
 const localEdit=env.FUDAN_LOCAL_EDIT==='1';
 if(localEdit&&(production||mailMode!=='file'||trustedProxies.length))fail('本机免邮箱编辑仅允许 local 文件邮件且无反向代理');
 if(!['file','smtp'].includes(mailMode)||production&&mailMode!=='smtp')fail('正式模式必须使用 SMTP，测试邮件仅限本机');
 const smtp={host:env.FUDAN_SMTP_HOST||'',port:integer(env.FUDAN_SMTP_PORT,587,'SMTP端口'),user:env.FUDAN_SMTP_USER||'',pass:env.FUDAN_SMTP_PASS||'',from:env.FUDAN_MAIL_FROM||''};
 if(mailMode==='smtp'&&(!smtp.host||!smtp.user||!smtp.pass||!smtp.from))fail('SMTP 需要主机、用户名、密码和发件地址');
 if(/[\r\n]/.test(smtp.from)||/[\r\n\s/]/.test(smtp.host))fail('邮件配置格式无效');
 const compileMode=env.FUDAN_COMPILE_MODE||(production?'disabled':'native');
 if(!['native','disabled','isolated'].includes(compileMode)||production&&compileMode==='native')fail('正式环境只允许 isolated 隔离编译或 disabled');
 let compileService;
 if(compileMode==='isolated'){
  let u;try{u=new URL(env.FUDAN_COMPILE_URL)}catch{fail('隔离编译需要 FUDAN_COMPILE_URL')}
  if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail('编译服务必须为独立的本机回环 HTTP 服务');
  if(!env.FUDAN_COMPILE_TOKEN_FILE||!/^sha256:[a-f0-9]{64}$/.test(env.FUDAN_TEX_IMAGE||''))fail('隔离编译需要私有凭据文件及固定镜像ID');
  compileService={url:u.origin,tokenFile:path.resolve(env.FUDAN_COMPILE_TOKEN_FILE),runtime:env.FUDAN_TEX_IMAGE};
 }
 const dataDir=path.resolve(env.FUDAN_DATA_DIR||path.join(root,'data'));
 return {mode,production,bind,port:integer(env.PORT,4318,'服务端口'),publicOrigin,trustedProxies,emailDomains,mailMode,localEdit,smtp,compileMode,compileService,dataDir,dbPath:path.resolve(env.FUDAN_DB||path.join(dataDir,'library.sqlite'))};
}

export function requestContext(req,port,config){
 const deny=(status,message)=>{throw Object.assign(new Error(message),{status})};
 const host=req.headers.host||'';
 const allowed=config.publicOrigin?[new URL(config.publicOrigin).host]:['127.0.0.1:'+port,'localhost:'+port,'[::1]:'+port];
 if(!allowed.includes(host))deny(403,'不允许的主机地址');
 const peer=normalizeIP(req.socket.remoteAddress),trusted=config.trustedProxies.includes(peer);
 if(config.production&&(!trusted||req.headers['x-forwarded-proto']!=='https'))deny(403,'请通过站点 HTTPS 入口访问');
 let clientIP=peer;
 if(trusted&&req.headers['x-forwarded-for']){
  const forwarded=req.headers['x-forwarded-for'];
  if(typeof forwarded!=='string'||!isIP(forwarded))deny(400,'代理客户端地址无效');
  clientIP=normalizeIP(forwarded);
 }
 const origin=config.publicOrigin||'http://'+host;
 if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)deny(403,'请求来源不允许');
 return {origin,clientIP};
}
