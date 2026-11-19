import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readingHTML} from '../reader-layout.mjs';

const website=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=data=>createHash('sha256').update(data).digest('hex');
const pick=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]]));
const decode=value=>value.replaceAll('&amp;','&');
export function exportReadonly({dbPath=path.join(website,'data/library.sqlite'),dataDir=path.dirname(dbPath),target}={}){
 if(!target)throw Error('需要新的发布目录');
 target=path.resolve(target);
 if(fs.existsSync(target))throw Error('发布目录已存在；请使用新目录，保留之前快照');
 const db=new DatabaseSync(dbPath,{readOnly:true});
 let snapshot;
 try{
  db.exec('BEGIN');
  snapshot={subjects:db.prepare('SELECT id,title,position FROM subjects WHERE archived=0 ORDER BY position,title').all(),courses:db.prepare('SELECT c.id,c.title,c.subject,c.position,c.home_id FROM courses c JOIN subjects s ON s.id=c.subject WHERE c.archived=0 AND s.archived=0 ORDER BY c.position,c.title').all(),documents:db.prepare('SELECT d.id,d.course_id,d.title,d.tex,d.preamble,d.render_mode,d.artifact,d.parent_id,d.position,d.is_course_home,d.version FROM documents d JOIN courses c ON c.id=d.course_id JOIN subjects s ON s.id=c.subject WHERE d.archived=0 AND c.archived=0 AND s.archived=0 ORDER BY d.position,d.title').all()};
  db.exec('COMMIT');
 }finally{db.close()}
 const ids=new Set(snapshot.documents.map(d=>d.id));
 for(const c of snapshot.courses)if(!ids.has(c.home_id))throw Error('公开课程缺少首页：'+c.id);
 for(const d of snapshot.documents){
  if(!/^[a-zA-Z0-9_-]+$/.test(d.id))throw Error('页面ID不适合作为静态路径');
  if(d.parent_id&&!ids.has(d.parent_id))throw Error('公开子页上级不存在：'+d.id);
  const seen=new Set([d.id]);let parent=d.parent_id;
  while(parent){if(seen.has(parent))throw Error('页面层级循环');seen.add(parent);parent=snapshot.documents.find(x=>x.id===parent)?.parent_id}
 }
 fs.mkdirSync(target,{recursive:true});
 const outputs=new Map(),resources=new Map(),visiting=new Set(),links=new Set(),external=new Set(),unresolved=new Set(),mathStyles=new Map();
 const put=(relative,content)=>{const out=path.join(target,relative);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,content);outputs.set(relative,{bytes:Buffer.byteLength(content),sha256:digest(content)});return '/'+relative.replaceAll('\\','/')};
 const resolvePublic=pathname=>{
  let root,relative;
  if(/^\/markdown\/[a-f0-9]{64}\//.test(pathname)){const parts=pathname.split('/');root=path.join(dataDir,'markdown',parts[2],'public');relative=parts.slice(3).join('/')}
  else if(/^\/media\/[a-f0-9]{64}\.(?:png|jpg|webp|pdf)$/.test(pathname)){root=path.join(dataDir,'assets');relative=pathname.slice(7)}
  else if(/^\/compiled\/[a-f0-9]{64}\.pdf$/.test(pathname)){root=path.join(dataDir,'compiled');relative=pathname.slice(10)}
  else throw Error('无法导出本机资源：'+pathname);
  const filename=path.resolve(root,relative);
  if(!filename.startsWith(path.resolve(root)+path.sep)||fs.lstatSync(filename).isSymbolicLink()||!fs.statSync(filename).isFile())throw Error('资源路径不安全或不存在：'+pathname);
  return filename;
 };
 const rewriteURL=(value,base)=>{
  if(!value||value.startsWith('#')||/^(?:data:|mailto:|tel:)/i.test(value))return value;
  const url=new URL(decode(value),'https://readonly.invalid'+base);
  if(url.origin!=='https://readonly.invalid'){if(['https:','http:'].includes(url.protocol))external.add(url.href);else throw Error('不允许的链接协议');return value}
  if(url.pathname==='/'){if(url.searchParams.has('mdDoc'))links.add(url.searchParams.get('mdDoc'));return value}
  if(/^\/markdown\/[a-f0-9]{64}\/missing\/$/.test(url.pathname)){unresolved.add(url.searchParams.get('title')||'');return '/missing.html'+url.search}
  if(url.pathname.includes('/edit/')||url.pathname.startsWith('/api'))throw Error('公开HTML含在线功能入口');
  return resource(url.pathname)+url.hash;
 };
 const rewriteCSS=(text,base)=>{
  // The official bundle ships WOFF2 only, while its CSS also names absent
  // WOFF/TTF fallback files. Keep the real WOFF2 fonts used by the local reader.
  text=text.replace(/,\s*url\(\s*(['"]?)([^)'"\s]+)\1\s*\)\s*format\(['"](?:woff|truetype)['"]\)/g,(match,quote,value)=>{
   const pathname=new URL(value,'https://readonly.invalid'+base).pathname;
   try{resolvePublic(pathname);return match}catch(error){if(error.code==='ENOENT'&&/\/katex\/fonts\/[^/]+\.(?:woff|ttf)$/.test(pathname))return '';throw error}
  });
  return text.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g,(_,quote,value)=>'url('+quote+rewriteURL(value,base)+quote+')');
 };
 const resource=pathname=>{
  if(resources.has(pathname))return resources.get(pathname);
  if(visiting.has(pathname))throw Error('资源引用循环：'+pathname);
  visiting.add(pathname);
  const filename=resolvePublic(pathname),ext=path.extname(filename).toLowerCase();
  if(!['.css','.woff','.woff2','.ttf','.otf','.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.pdf'].includes(ext))throw Error('拒绝公开不需要的资源类型：'+pathname);
  let content=fs.readFileSync(filename);
  if(ext==='.css')content=Buffer.from(rewriteCSS(content.toString('utf8'),pathname));
  if(ext==='.svg'&&/<script\b|\bon\w+\s*=/i.test(content.toString('utf8')))throw Error('SVG包含可执行内容');
  const relative='assets/'+digest(content)+ext;
  const url=outputs.has(relative)?'/'+relative:put(relative,content);
  resources.set(pathname,url);visiting.delete(pathname);return url;
 };
 for(const d of snapshot.documents){
  if(d.render_mode!=='markdown'||!/^[a-f0-9]{64}$/.test(d.artifact))throw Error('需单独核对非Markdown页面：'+d.id);
  const base='/markdown/'+d.artifact+'/books/page/index.html';
  let html=fs.readFileSync(resolvePublic(base),'utf8');
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<p\b[^>]*class="edit-page"[^>]*>[\s\S]*?<\/p>/gi,'');
  html=html.replace(/\b(href|src)="([^"]*)"/g,(_,attr,value)=>attr+'="'+rewriteURL(value,base)+'"');
  html=html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,(_,attrs,body)=>'<style'+attrs+'>'+rewriteCSS(body,base)+'</style>');
  // Factor repeated KaTeX span geometry into one shared stylesheet. The
  // declarations still win over template defaults, as their inline originals
  // did; no text, TeX, MathML, numbering or node order is rewritten.
  html=html.replace(/<span\b[^>]*\sstyle="([^"]*)"[^>]*>/g,(tag,style)=>{
   const declarations=style.split(';').filter(Boolean);
   if(!declarations.length||declarations.some(d=>!/^[-a-z]+\s*:\s*[-a-zA-Z0-9.#%(),+\s]+$/.test(d)))return tag;
   let name=mathStyles.get(style);if(!name){name='r'+mathStyles.size.toString(36);mathStyles.set(style,name)}
   tag=tag.replace(/\sstyle="[^"]*"/,'');
   return /\sclass="/.test(tag)?tag.replace(/class="([^"]*)"/,(_,classes)=>'class="'+classes+' '+name+'"'):tag.replace(/>$/,' class="'+name+'">');
  });
  if(/<script\b|\bon\w+\s*=/i.test(html))throw Error('公开HTML包含可执行内容：'+d.id);
  const policy="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; script-src 'none'; base-uri 'none'; form-action 'none'";
  html=readingHTML(html).replace(/<head>/i,'<head><meta http-equiv="Content-Security-Policy" content="'+policy+'">').replace(/<\/head>/i,'<link rel="stylesheet" href="/math-layout.css"></head>');
  d.readUrl=put('pages/'+d.id+'.html',html);
  delete d.artifact;
 }
 for(const id of links)if(!ids.has(id))throw Error('正文链接指向未公开页面：'+id);
 for(const name of ['index.html','app.js'])put(name,fs.readFileSync(path.join(website,'readonly-template',name)));
 put('math-layout.css',[...mathStyles].map(([style,name])=>'.'+name+'{'+style.split(';').filter(Boolean).map(d=>d+'!important').join(';')+'}').join('\n'));
 if(unresolved.size)put('missing.html','<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>条目尚未创建</title></head><body><p>条目尚未创建。</p><a href="/" target="_parent">返回课程目录</a></body></html>');
 put('style.css',fs.readFileSync(path.join(website,'dist/style.css')));
 put('snapshot.json',JSON.stringify(snapshot));
 const manifest={format:1,generatedAt:new Date().toISOString(),subjects:snapshot.subjects.length,courses:snapshot.courses.length,documents:snapshot.documents.length,files:[...outputs].map(([path,record])=>({path,...record})),externalLinks:[...external].sort(),unresolvedOriginalLinks:[...unresolved].sort(),documentVersions:snapshot.documents.map(d=>pick(d,['id','version'])),totalBytes:[...outputs.values()].reduce((sum,r)=>sum+r.bytes,0)};
 fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const manifest=exportReadonly({target:process.argv[2]});
 console.log(JSON.stringify({subjects:manifest.subjects,courses:manifest.courses,documents:manifest.documents,files:manifest.files.length,totalBytes:manifest.totalBytes}));
}
