import {readingHTML} from './reader-layout.mjs';
import {editableFields,pageHistory} from './page-history.mjs';
import {listRecent,undoRecent} from './recent-changes.mjs';
import {createDiffCache} from './diff-cache.mjs';
import {createDiscussion} from './discussion.mjs';
import {createCourseAtlas} from './course-atlas.mjs';
import http from 'node:http';
import os from 'node:os';
import {migratePages,initialSubjects} from './model.mjs';
import {createCompiler,commonPackages} from './compiler.mjs';
import {createIsolatedCompiler} from './isolated-compiler.mjs';
import {createMarkdownRenderer} from './banana-markdown.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {loadConfig,requestContext} from './config.mjs';
import {createMailer} from './mailer.mjs';
import {createAuth} from './auth.mjs';
import {migrateGovernance,createGovernance,recordGovernanceAction as recordAction} from './governance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export const subjects=initialSubjects;
const seed=[
 ['calculus','数学分析','analysis'],['real','实分析','analysis'],['complex','复分析','analysis'],['functional','泛函分析','analysis'],['ode','常微分方程','analysis'],['pde','偏微分方程','analysis'],
 ['linear','线性代数','algebra'],['abstract','抽象代数','algebra'],['number','初等数论','algebra'],['algebraic-number','代数数论','algebra'],
 ['topology','拓扑学','geometry'],['differential-geometry','微分几何','geometry'],['algebraic-topology','代数拓扑','geometry'],['riemann','黎曼几何','geometry'],
 ['commutative','交换代数','ag'],['ag-intro','代数几何基础','ag'],['schemes','概形论','ag'],['sheaves','层与上同调','ag'],
 ['probability-theory','概率论','probability'],['statistics','数理统计','probability'],['stochastic','随机过程','probability'],['stochastic-analysis','随机分析','probability'],
 ['numerical','数值分析','applied'],['optimization','最优化方法','applied'],['scientific','科学计算','applied'],['modeling','数学建模','applied']
];

const hash=s=>createHash('sha256').update(s).digest('hex');
const now=()=>new Date().toISOString();
function problem(status,message){return Object.assign(new Error(message),{status})}
function text(value,label,max=120,allowEmpty=false){
 if(typeof value!=='string'||(!allowEmpty&&!value.trim())||value.length>max)throw problem(400,label+'格式不正确');
 return allowEmpty?value:value.trim();
}
function version(value){if(!Number.isSafeInteger(value)||value<0)throw problem(400,'缺少正确的版本号');return value}
function cookieValue(req,name){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||''}
export function createApp({dbPath,test=false,dataDir,config=loadConfig(),mailer,clock,compiler:providedCompiler,atlasCatalogPath}={}){
 dbPath??=config.dbPath;
 if(dbPath!==':memory:')fs.mkdirSync(path.dirname(dbPath),{recursive:true});
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;');
 db.exec([
 "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'editor',blocked INTEGER DEFAULT 0,created TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);",
 "CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,title TEXT NOT NULL,subject TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);",
 "CREATE TABLE IF NOT EXISTS course_history(id INTEGER PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),type TEXT NOT NULL,title TEXT NOT NULL,tex TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,position INTEGER NOT NULL DEFAULT 0,protected INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,updated TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),version INTEGER NOT NULL,title TEXT NOT NULL,tex TEXT NOT NULL,type TEXT NOT NULL,position INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),summary TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(document_id,version));",
 "CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created TEXT NOT NULL);",
 "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);"
 ].join('\n'));
 if(!db.prepare("SELECT value FROM settings WHERE key='seeded'").get()){
  db.exec('BEGIN');
  try{const ins=db.prepare('INSERT INTO courses(id,title,subject,position) VALUES(?,?,?,?)');seed.forEach((c,i)=>ins.run(...c,i));db.prepare('INSERT INTO settings VALUES(?,?)').run('seeded','1');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 }
 migratePages(db);
 const storageDir=dataDir|| (dbPath===':memory:'?fs.mkdtempSync(path.join(os.tmpdir(),'fudan-site-')):path.dirname(dbPath));
 const mediaPrivacy=db.prepare("SELECT 1 FROM settings WHERE key=? AND value='1'");
 const isPrivateMedia=name=>!!mediaPrivacy.get('private-media:'+name);
 const compiler=providedCompiler||(config.compileMode==='isolated'?createIsolatedCompiler(storageDir,{...config.compileService,isPrivateMedia}):createCompiler(storageDir));
 const markdown=createMarkdownRenderer(storageDir);
 const identity=createAuth({db,config,mailer:mailer||createMailer(config,storageDir),clock});
 migrateGovernance(db);
 const diffCache=createDiffCache(db);
 const listSubjects=()=>db.prepare('SELECT * FROM subjects WHERE archived=0 ORDER BY position,title').all();
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}};
 const auth=req=>identity.current(req);
 const requireUser=req=>{req.requireEditor=true;return identity.requireEditor(req)};
 const requireAdmin=u=>{if(u.role!=='admin')throw problem(403,'此操作需要管理员权限')};
 const course=id=>{const c=db.prepare('SELECT * FROM courses WHERE id=?').get(id);if(!c)throw problem(404,'课程不存在');return c};
 const doc=id=>{const d=db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!d)throw problem(404,'资料不存在');if(d.is_course_home)d.title=course(d.course_id).title;const source=db.prepare('SELECT * FROM legacy_sources WHERE document_id=?').get(id);if(source)d.source=source;return d};
 const visible=d=>{
  const seen=new Set();let current=d;
  while(current){if(current.archived||seen.has(current.id))return false;seen.add(current.id);current=current.parent_id?db.prepare('SELECT * FROM documents WHERE id=?').get(current.parent_id):null}
  return true;
 };
 const writable=(d,u,allowArchived=false)=>{if(d.protected&&u.role!=='admin')throw problem(403,'此页面已被保护');if(course(d.course_id).archived)throw problem(409,'所属课程已移除，请先恢复课程');if(!allowArchived&&!visible(d))throw problem(409,'此页面或上级页面已移除，请先恢复')};
 function parentFor(value,courseId,selfId=null){
  const c=course(courseId),id=value||c.home_id;
  let parent=doc(id);if(parent.course_id!==courseId||!visible(parent))throw problem(400,'请选择本课程中未移除的上级页面');
  const seen=new Set();let depth=0;
  while(parent){if(parent.id===selfId||seen.has(parent.id))throw problem(400,'不能将页面放到自身或其子页面下');if(++depth>30)throw problem(400,'页面层级超过上限');seen.add(parent.id);parent=parent.parent_id?doc(parent.parent_id):null}
  return id;
 }
 const revision=(d,u,summary)=>{setImmediate(()=>diffCache.refresh());return db.prepare('INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created,parent_id,preamble,render_mode,artifact,archived) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(d.id,d.version,d.title,d.tex,d.type,d.position,u.id,summary,now(),d.parent_id,d.preamble,d.render_mode,d.artifact,d.archived)};
 const audit=(c,u,action)=>{db.prepare('INSERT INTO course_history(course_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(c.id,u.id,action,JSON.stringify(c),now());recordAction(db,{actorId:u.id,action:'course.'+action,targetType:'course',targetId:c.id,after:c})};
 const documentAction=(d,u,action,reason='')=>{const current=doc(d.id),fields=x=>({version:x.version,protected:!!x.protected,archived:!!x.archived,artifact:x.artifact});recordAction(db,{actorId:u.id,action:'document.'+action,targetType:'document',targetId:d.id,before:fields(d),after:fields(current),reason})};
 async function body(req,max=600000){
  let buffer=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>max)throw problem(413,'内容过大，请拆分为多个章节');buffer.push(chunk)}
  if(req.requireEditor)identity.requireEditor(req);
  try{const parsed=JSON.parse(Buffer.concat(buffer).toString('utf8')||'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed}catch{throw problem(400,'请求内容格式不正确')}
 }
 function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
 const artifactAvailable=r=>r.render_mode==='latex'?/^[a-f0-9]{64}$/.test(r.artifact||'')&&fs.existsSync(path.join(compiler.output,r.artifact+'.pdf')):r.render_mode==='markdown'?/^[a-f0-9]{64}$/.test(r.artifact||'')&&fs.existsSync(path.join(markdown.output,r.artifact,'.complete')):true;
 const recentUndo=(source,eventId,actor,reason)=>undoRecent({db,source,eventId,actor,reason,transaction,document:doc,course,parentFor,revision,documentAction,audit,recordAction,fail:(status,message)=>{throw problem(status,message)},now,artifactAvailable});
 const govern=createGovernance({db,identity,body,send,recent:(before,options)=>{diffCache.refresh();return listRecent(db,before,options)},undoRecent:recentUndo});
 const discussion=createDiscussion({db,identity,body,send});
 const atlas=createCourseAtlas({db,identity,body,send,dataDir:storageDir,catalogPath:atlasCatalogPath||path.join(root,'dist','course-atlas','data','catalog.json')});
 function validateCourse(b){if(!listSubjects().some(s=>s.id===b.subject))throw problem(400,'请选择学科');return{title:text(b.title,'课程名称'),subject:b.subject}}
 function validateDoc(b){
  if(!Number.isSafeInteger(b.position)||Math.abs(b.position)>100000)throw problem(400,'目录顺序应为整数');
  const mode=b.render_mode||'web';if(!['web','latex','markdown'].includes(mode))throw problem(400,'排版方式不正确');
  return{title:text(b.title,'页面标题'),tex:text(b.tex,'TeX 源码',200000,true),type:typeof b.type==='string'?b.type:'page',position:b.position,preamble:text(b.preamble??'','导言区',30000,true),render_mode:mode,parent_id:b.parent_id??null,artifact:''};
 }
 async function compile(tex,preamble){if(config.compileMode==='disabled')throw problem(503,'此环境尚未启用隔离 LaTeX 编译，现有 PDF 仍可阅读。');return compiler.compile(tex,preamble)}
 async function prepare(b,req,current){if(b.render_mode==='latex'){const out=await compile(b.tex,b.preamble);identity.requireEditor(req);b.artifact=out.artifact}if(b.render_mode==='markdown'){if(b.preamble)throw problem(400,'Markdown公式不使用LaTeX导言区。');let out;if(current){const peers=db.prepare("SELECT * FROM documents WHERE course_id=? AND archived=0 AND render_mode='markdown'").all(current.course_id).filter(p=>p.id!==current.id);const pages=[...peers,{...current,...b}];const ids=new Set(pages.map(p=>p.id));for(const p of pages)if(!ids.has(p.parent_id))p.parent_id=null;const snapshot=peers.map(p=>[p.id,p.version]);out=(await markdown.renderGroup(pages,{id:current.course_id,title:course(current.course_id).title})).pages[current.id];for(const [id,v] of snapshot)if(doc(id).version!==v)throw problem(409,'讲义其他页面已有新版本，请重新预览后保存。')}else out=await markdown.render(b.tex,b.title);identity.requireEditor(req);b.artifact=out.artifact}return b}
 function publicFile(res,target,mime,method){
  if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw problem(404,'文件不存在');
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'public, max-age=31536000, immutable','Content-Length':fs.statSync(target).size});
  if(method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob: data:; img-src 'self' data: https:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const address=server.address(),port=typeof address==='object'?address.port:4318;
   const request=requestContext(req,port,config);
   if(config.production)res.setHeader('Strict-Transport-Security','max-age=31536000');
   const url=new URL(req.url,'http://'+req.headers.host),p=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
   if(p[0]==='media'&&['GET','HEAD'].includes(req.method)){
    if(p.length!==2||!/^[a-f0-9]{64}\.(png|jpg|webp|pdf)$/.test(p[1]))throw problem(404,'附件不存在');
    if(isPrivateMedia(p[1]))throw problem(404,'附件不存在');
    return publicFile(res,path.join(compiler.assets,p[1]),{png:'image/png',jpg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'}[path.extname(p[1]).slice(1)],req.method);
   }
   if(p[0]==='compiled'&&['GET','HEAD'].includes(req.method)){
    if(p.length!==2||!/^[a-f0-9]{64}\.pdf$/.test(p[1]))throw problem(404,'排版结果不存在');
    return publicFile(res,path.join(compiler.output,p[1]),'application/pdf',req.method);
   }
   if(p[0]!=='api'){
    if(p[0]==='markdown'&&['GET','HEAD'].includes(req.method)){
     res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
     if(!/^[a-f0-9]{64}$/.test(p[1]||''))throw problem(404,'页面不存在');
     const base=path.join(markdown.output,p[1],'public'),relative=p.slice(2).join('/')||'index.html';let target=path.resolve(base,relative);if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
     if(!target.startsWith(base+path.sep)||relative.includes('\0'))throw problem(404,'页面不存在');
     const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'}[path.extname(target)]||'application/octet-stream';if(path.extname(target)==='.html'&&url.searchParams.get('readerLayout')==='1'){if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw problem(404,'页面不存在');const collapseContents=relative==='books/page'&&!!db.prepare('SELECT 1 FROM documents WHERE id=? AND artifact=? AND archived=0').get('algebra-group-notes',p[1]);const content=Buffer.from(readingHTML(fs.readFileSync(target,'utf8'),{parentPage:url.searchParams.get('parentPage')==='1',hideExamContents:url.searchParams.get('hideExamContents')==='1',collapseContents}));res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','Content-Length':content.length});return res.end(req.method==='HEAD'?undefined:content)}return publicFile(res,target,mime,req.method);
    }
    if(!['GET','HEAD'].includes(req.method))throw problem(405,'方法不允许');
    const base=p[0]==='pdfjs'?path.join(root,'node_modules','pdfjs-dist'):p[0]==='vendor'?path.join(root,'node_modules','katex','dist'):path.join(root,'dist');
    const relative=['vendor','pdfjs'].includes(p[0])?p.slice(1).join('/'):p.join('/')||'index.html';
    const target=path.resolve(base,relative);
    if(!target.startsWith(base+path.sep)||relative.includes('\0')||!fs.existsSync(target)||!fs.statSync(target).isFile())throw problem(404,'文件不存在');
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.pdf':'application/pdf','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'}[path.extname(target)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(target).pipe(res);return;
   }
   if(!['GET','HEAD'].includes(req.method)){
    if(!String(req.headers['content-type']).startsWith('application/json'))throw problem(415,'请使用 JSON 请求');
   }
   if(req.method==='GET'&&p[1]==='state'){
    const u=auth(req);
    return send(res,200,{subjects:listSubjects(),packages:commonPackages,courses:db.prepare('SELECT * FROM courses WHERE archived=0 ORDER BY position,title').all(),user:u,emailDomains:config.emailDomains,mailMode:config.mailMode,compilationEnabled:config.compileMode!=='disabled'});
   }
   if(req.method==='GET'&&p[1]==='health')return send(res,200,{ok:true});
   if(await govern(req,res,p,url))return;
   if(await discussion(req,res,p,url))return;
   if(await atlas(req,res,p,url))return;
   if(req.method==='GET'&&p[1]==='search'){
    const q=(url.searchParams.get('q')||'').trim().slice(0,120);
    const documents=q?db.prepare('SELECT d.*,c.title AS course_title FROM documents d JOIN courses c ON c.id=d.course_id WHERE c.archived=0 AND d.archived=0 AND (instr(lower(d.title),lower(?))>0 OR instr(lower(d.tex),lower(?))>0) ORDER BY d.updated DESC LIMIT 100').all(q,q):[];
    return send(res,200,{documents:documents.filter(visible).map(d=>({id:d.id,title:d.is_course_home?d.course_title:d.title,course_title:d.course_title}))});
   }
   if(p[1]==='subjects'){
    if(req.method==='GET'&&p[2]==='archived'){const user=auth(req);if(!user)throw problem(401,'请先登录');requireAdmin(user);return send(res,200,{subjects:db.prepare('SELECT * FROM subjects WHERE archived=1 ORDER BY position,title').all()})}
    if(req.method==='GET'&&p[2]==='history')return send(res,200,{history:db.prepare('SELECT h.*,u.username FROM subject_history h JOIN users u ON u.id=h.user_id ORDER BY h.id DESC LIMIT 200').all()});
    const u=requireUser(req);requireAdmin(u);const b=await body(req);
    const record=(id,action)=>{const snapshot=db.prepare('SELECT * FROM subjects WHERE id=?').get(id);db.prepare('INSERT INTO subject_history(subject_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(id,u.id,action,JSON.stringify(snapshot),now());recordAction(db,{actorId:u.id,action:'subject.'+action,targetType:'subject',targetId:id,after:snapshot})};
    if(req.method==='POST'&&!p[2]){
     if(!Number.isSafeInteger(b.position))throw problem(400,'顺序必须是整数');
     const id=randomUUID(),title=text(b.title,'板块名称',80);
     transaction(()=>{db.prepare('INSERT INTO subjects(id,title,position) VALUES(?,?,?)').run(id,title,b.position);record(id,'create')});return send(res,201,{ok:true});
    }
    const s=db.prepare('SELECT * FROM subjects WHERE id=?').get(p[2]);if(!s)throw problem(404,'板块不存在');
    if(version(b.version)!==s.version)throw problem(409,'板块已被修改，请刷新');
    if(req.method==='POST'&&p[3]==='restore'){
     transaction(()=>{db.prepare('UPDATE subjects SET archived=0,version=version+1 WHERE id=?').run(s.id);record(s.id,'restore')});return send(res,200,{ok:true});
    }
    if(s.archived)throw problem(409,'板块已移除，请先恢复');
    if(req.method==='PATCH'){
     if(!Number.isSafeInteger(b.position))throw problem(400,'顺序必须是整数');
     transaction(()=>{db.prepare('UPDATE subjects SET title=?,position=?,version=version+1 WHERE id=?').run(text(b.title,'板块名称',80),b.position,s.id);record(s.id,'update')});return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&p[3]==='archive'){
     if(db.prepare('SELECT 1 FROM courses WHERE subject=?').get(s.id))throw problem(409,'请先把该板块的课程移至其他板块，包括已移除的课程。');
     transaction(()=>{db.prepare('UPDATE subjects SET archived=1,version=version+1 WHERE id=?').run(s.id);record(s.id,'archive')});return send(res,200,{ok:true});
    }
    throw problem(404,'接口不存在');
   }
   if(req.method==='POST'&&p[1]==='preview'){
    requireUser(req);const b=await body(req);if(b.render_mode==='markdown'&&b.document_id){const current=doc(text(b.document_id,'页面ID',100));const out=await prepare(validateDoc({...current,...b,preamble:'',parent_id:current.parent_id}),req,current);return send(res,200,{artifact:out.artifact,url:'/markdown/'+out.artifact+'/books/page/'})}const result=b.render_mode==='markdown'?await markdown.render(text(b.tex,'Markdown源码',200000,true),text(b.title||'预览','页面标题')):await compile(text(b.tex,'TeX 源码',200000,true),text(b.preamble??'','导言区',30000,true));requireUser(req);return send(res,200,result);
   }
   if(req.method==='POST'&&p[1]==='assets'){
    const u=requireUser(req),b=await body(req,7500000);
    if(typeof b.data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.data))throw problem(400,'附件数据不正确');
    const bytes=Buffer.from(b.data,'base64');if(bytes.length>5*1024*1024)throw problem(413,'附件不能超过 5 MB');
    let ext,mime;
    if(bytes.length>24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){ext='png';mime='image/png';if(bytes.readUInt32BE(16)>10000||bytes.readUInt32BE(20)>10000)throw problem(400,'图片尺寸过大')}
    else if(bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){ext='jpg';mime='image/jpeg'}
    else if(bytes.length>12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){ext='webp';mime='image/webp'}
    else if(/^%PDF-[12]\.\d/.test(bytes.toString('ascii',0,8))&&bytes.subarray(-1024).includes(Buffer.from('%%EOF'))){ext='pdf';mime='application/pdf'}
    else throw problem(400,'请上传 PNG、JPEG、WebP 图片或有效 PDF。');
    const id=hash(bytes),filename=id+'.'+ext;fs.writeFileSync(path.join(compiler.assets,filename),bytes,{flag:'w'});
    db.prepare('INSERT OR IGNORE INTO assets(id,filename,mime,size,user_id,created) VALUES(?,?,?,?,?,?)').run(id,filename,mime,bytes.length,u.id,now());
    return send(res,201,{url:'/media/'+filename});
   }
   if(req.method==='POST'&&p[1]==='auth'){
    const b=await body(req),out=await identity.handle(p[2],b,req,res,request);return send(res,out.status,out.data);
   }
   if(p[1]==='courses'){
    if(req.method==='GET'&&p[2]==='archived'){if(!auth(req))throw problem(401,'请先登录');return send(res,200,{courses:db.prepare('SELECT * FROM courses WHERE archived=1 ORDER BY title').all()})}
    if(req.method==='POST'&&!p[2]){const u=requireUser(req),b=validateCourse(await body(req)),id=randomUUID();transaction(()=>{db.prepare('INSERT INTO courses(id,title,subject,position) VALUES(?,?,?,?)').run(id,b.title,b.subject,db.prepare('SELECT coalesce(max(position),0)+1 AS n FROM courses').get().n);const home=randomUUID();db.prepare("INSERT INTO documents(id,course_id,type,title,tex,version,position,updated,is_course_home) VALUES(?,?,'page',?,'',0,0,?,1)").run(home,id,b.title,now());db.prepare('UPDATE courses SET home_id=? WHERE id=?').run(home,id);audit(course(id),u,'create')});return send(res,201,{course:course(id)})}
    let c=course(p[2]);
    if(req.method==='GET'&&p.length===3)return send(res,200,{course:c,home:doc(c.home_id),documents:db.prepare('SELECT * FROM documents WHERE course_id=? AND is_course_home=0 ORDER BY position,title').all(c.id).filter(visible),archived:auth(req)?db.prepare('SELECT id,title,parent_id,version FROM documents WHERE course_id=? AND archived=1 ORDER BY title').all(c.id):[]});
    if(req.method==='GET'&&p[3]==='history')return send(res,200,{history:db.prepare('SELECT h.id,h.action,h.snapshot,h.created,u.username FROM course_history h JOIN users u ON u.id=h.user_id WHERE course_id=? ORDER BY h.id DESC').all(c.id)});
    if(req.method==='PATCH'&&p.length===3){
     const u=requireUser(req),raw=await body(req),v=version(raw.version);c=course(p[2]);
     if(v!==c.version)throw problem(409,'课程已被他人修改，请刷新后重试');
     const b=validateCourse(raw);if(doc(c.home_id).protected)requireAdmin(u);
     transaction(()=>{db.prepare('UPDATE courses SET title=?,subject=?,version=version+1 WHERE id=?').run(b.title,b.subject,c.id);audit(course(c.id),u,'update')});
     return send(res,200,{course:course(c.id)});
    }
    if(req.method==='POST'&&['archive','restore'].includes(p[3])){
     const u=requireUser(req),b=await body(req);c=course(p[2]);if(version(b.version)!==c.version)throw problem(409,'课程版本已变化，请刷新');
     if(u.role!=='admin'&&db.prepare('SELECT 1 FROM documents WHERE course_id=? AND protected=1').get(c.id))throw problem(403,'课程含受保护页面，请联系管理员');
     transaction(()=>{db.prepare('UPDATE courses SET archived=?,version=version+1 WHERE id=?').run(p[3]==='archive'?1:0,c.id);audit(course(c.id),u,p[3])});
     return send(res,200,{course:course(c.id)});
    }
    if(req.method==='POST'&&p[3]==='documents'){
     const u=requireUser(req),raw=await body(req),b=await prepare(validateDoc(raw),req),id=randomUUID();
     if(course(c.id).archived)throw problem(409,'课程已移除');
     b.parent_id=parentFor(b.parent_id,c.id);
     transaction(()=>{db.prepare('INSERT INTO documents(id,course_id,type,title,tex,position,updated,parent_id,preamble,render_mode,artifact) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,c.id,b.type,b.title,b.tex,b.position,now(),b.parent_id,b.preamble,b.render_mode,b.artifact);revision(doc(id),u,text(raw.summary??'创建页面','修改说明',300,true))});
     return send(res,201,{document:doc(id)});
    }
   }

   if(p[1]==='documents'){
    let d=doc(p[2]);
    if(req.method==='GET'&&p.length===3)return send(res,200,{document:d,course:course(d.course_id)});
    if(req.method==='GET'&&p[3]==='history'&&url.searchParams.get('daily')==='1')return send(res,200,{groups:pageHistory(db,d.id)});
    if(req.method==='GET'&&p[3]==='history')return send(res,200,{revisions:db.prepare("SELECT r.id,r.version,r.title,'' AS summary,r.created,u.username FROM revisions r JOIN users u ON u.id=r.user_id WHERE document_id=? ORDER BY version DESC").all(d.id)});
    if(req.method==='GET'&&p[3]==='diff'&&p.length===4){
     const from=url.searchParams.get('from'),to=url.searchParams.get('to')||'latest';
     const valid=x=>/^[1-9][0-9]{0,14}$/.test(x||'');
     if(!(from==='0'||valid(from))||!(to==='latest'||valid(to)))throw problem(400,'比较版本不正确');
     const find=id=>db.prepare('SELECT * FROM revisions WHERE document_id=? AND id=?').get(d.id,id);
     const old=from==='0'?{id:0,version:0,title:'创建前（空正文）',tex:'',preamble:'',render_mode:d.render_mode}:find(from);
     const next=to==='latest'?d:find(to);
     if(!old||!next)throw problem(404,'版本不存在');
     const diff=diffCache.compare(old.tex,next.tex);
     const nextRevisionId=to==='latest'?db.prepare('SELECT id FROM revisions WHERE document_id=? AND version=?').get(d.id,d.version)?.id:next.id;
     return send(res,200,{old,next,diff,nextRevisionId:nextRevisionId||null});
    }
    if(req.method==='GET'&&p[3]==='revisions'){const r=db.prepare('SELECT r.*,u.username FROM revisions r JOIN users u ON u.id=r.user_id WHERE r.document_id=? AND r.id=?').get(d.id,p[4]);if(!r)throw problem(404,'版本不存在');return send(res,200,{revision:r})}
    if(req.method==='GET'&&p[3]==='comments')return send(res,200,{comments:db.prepare('SELECT c.id,c.body,c.created,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE document_id=? AND c.hidden=0 ORDER BY c.id').all(d.id)});
    if(req.method==='POST'&&p[3]==='comments'){const u=requireUser(req);writable(d,u);const b=await body(req);writable(doc(d.id),u);db.prepare('INSERT INTO comments(document_id,user_id,body,created) VALUES(?,?,?,?)').run(d.id,u.id,text(b.body,'讨论内容',5000),now());return send(res,201,{ok:true})}
    if(req.method==='PUT'&&p.length===3){
     const u=requireUser(req);writable(d,u);const raw=await body(req),b=validateDoc({...raw,type:raw.type??d.type});
     d=doc(p[2]);writable(d,requireUser(req));if(version(raw.version)!==d.version)throw problem(409,'他人已保存新版本。你的源码仍在编辑框中，请先下载备份，再重新载入比较。');
     b.parent_id=d.is_course_home?null:parentFor(raw.parent_id??d.parent_id,d.course_id,d.id);if(d.is_course_home)b.title=course(d.course_id).title;
     const summary=text(raw.summary??'','修改说明',300,true);
     const unchanged=editableFields.every(key=>b[key]===d[key]);
     if(unchanged && artifactAvailable(d))return send(res,200,{document:d});
     await prepare(b,req,d);
     d=doc(p[2]);writable(d,requireUser(req));if(raw.version!==d.version)throw problem(409,'他人已保存新版本，请重新载入比较。');
     if(unchanged && d.artifact===b.artifact)return send(res,200,{document:d});
     if(!d.is_course_home)parentFor(b.parent_id,d.course_id,d.id);
     transaction(()=>{db.prepare('UPDATE documents SET title=?,tex=?,type=?,position=?,parent_id=?,preamble=?,render_mode=?,artifact=?,version=version+1,updated=? WHERE id=?').run(b.title,b.tex,b.type,b.position,b.parent_id,b.preamble,b.render_mode,b.artifact,now(),d.id);revision(doc(d.id),u,summary)});
     return send(res,200,{document:doc(d.id)});
    }
    if(req.method==='POST'&&p[3]==='restore'){
     const u=requireUser(req);writable(d,u,true);const raw=await body(req);d=doc(p[2]);writable(d,u,true);
     if(version(raw.version)!==d.version)throw problem(409,'当前版本已变化，请刷新后恢复');
     const r=db.prepare('SELECT * FROM revisions WHERE document_id=? AND id=?').get(d.id,raw.revisionId);if(!r)throw problem(404,'版本不存在');
     if(r.render_mode==='latex'&&(!/^[a-f0-9]{64}$/.test(r.artifact)||!fs.existsSync(path.join(compiler.output,r.artifact+'.pdf'))))throw problem(409,'此历史版本的 PDF 缺失，请维护者从备份恢复；当前版本未改变。');
     if(r.render_mode==='markdown'&&(!/^[a-f0-9]{64}$/.test(r.artifact)||!fs.existsSync(path.join(markdown.output,r.artifact,'.complete'))))throw problem(409,'此历史版本的Markdown产物缺失，当前版本未改变。');
     // Maintenance may move a page to a different course. Its immutable old
     // revision still names the previous parent; restore content in this course.
     const previousParent=r.parent_id&&db.prepare('SELECT course_id FROM documents WHERE id=?').get(r.parent_id);
     const restoreParent=previousParent&&previousParent.course_id!==d.course_id?course(d.course_id).home_id:r.parent_id;
     const parent=d.is_course_home?null:parentFor(restoreParent,d.course_id,d.id);
     transaction(()=>{db.prepare('UPDATE documents SET title=?,tex=?,type=?,position=?,parent_id=?,preamble=?,render_mode=?,artifact=?,archived=0,version=version+1,updated=? WHERE id=?').run(d.is_course_home?course(d.course_id).title:r.title,r.tex,r.type,r.position,parent,r.preamble,r.render_mode,r.artifact,now(),d.id);revision(doc(d.id),u,'恢复至版本 '+r.version);documentAction(d,u,'restore','恢复至版本 '+r.version)});
     return send(res,200,{document:doc(d.id)});
    }
    if(req.method==='POST'&&['archive','restore-page'].includes(p[3])){
     const u=requireUser(req),raw=await body(req);d=doc(p[2]);writable(d,u,true);
     if(d.is_course_home)throw problem(400,'课程正文不能单独移除，请在主页管理课程');
     if(version(raw.version)!==d.version)throw problem(409,'页面已被修改，请刷新');
     if(p[3]==='restore-page')parentFor(d.parent_id,d.course_id,d.id);
     if(p[3]==='archive'&&u.role!=='admin'){
      const protectedChildren=db.prepare('WITH RECURSIVE descendants(id) AS (SELECT ? UNION ALL SELECT d.id FROM documents d JOIN descendants x ON d.parent_id=x.id) SELECT 1 FROM documents WHERE id IN descendants AND protected=1 LIMIT 1').get(d.id);
      if(protectedChildren)throw problem(403,'此页面下有受保护的子页面，请联系管理员');
     }
     transaction(()=>{db.prepare('UPDATE documents SET archived=?,version=version+1,updated=? WHERE id=?').run(p[3]==='archive'?1:0,now(),d.id);revision(doc(d.id),u,p[3]==='archive'?'移除页面':'恢复页面');documentAction(d,u,p[3])});
     return send(res,200,{document:doc(d.id)});
    }
    if(req.method==='POST'&&p[3]==='protect'){
     const u=requireUser(req);requireAdmin(u);const b=await body(req);d=doc(p[2]);if(typeof b.protected!=='boolean')throw problem(400,'保护状态不正确');if(version(b.version)!==d.version)throw problem(409,'版本已变化');
     const why=text(b.reason??'','操作原因',300,true);
     transaction(()=>{db.prepare('UPDATE documents SET protected=?,version=version+1,updated=? WHERE id=?').run(b.protected?1:0,now(),d.id);revision(doc(d.id),u,b.protected?'保护页面':'取消保护');documentAction(d,u,b.protected?'protect':'unprotect',why)});
     return send(res,200,{document:doc(d.id)});
    }
   }
   throw problem(404,'接口不存在');
  }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'服务器暂时无法处理请求'});else res.end();if(!e.status)console.error(e)}
 });
 return{server,db,storageDir,diffCache,close:()=>new Promise(resolve=>{server.close(async()=>{await diffCache.close();db.close();resolve()});server.closeIdleConnections()})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=loadConfig(process.env);
 const app=createApp({config,dbPath:config.dbPath,dataDir:config.dataDir});
 app.server.listen(config.port,config.bind,()=>console.log('复旦数学资源库 '+(config.publicOrigin||'http://127.0.0.1:'+app.server.address().port)+'/'));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0)});
}

