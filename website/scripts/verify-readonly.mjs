import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const folder=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'))),snapshot=JSON.parse(fs.readFileSync(path.join(folder,'snapshot.json')));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=new Set(manifest.files.map(f=>'/'+f.path));let references=0,mathNodes=0;
const styles=new Map([...fs.readFileSync(path.join(folder,'math-layout.css'),'utf8').matchAll(/\.([a-z0-9]+)\{([^}]*)\}/g)].map(m=>[m[1],m[2].split(';').map(d=>d.replace(/!important$/,'')).join(';')+';']));
let styleNodes=0;
const checkURL=(value,base)=>{
 if(!value||value.startsWith('#')||/^(?:data:|mailto:|tel:)/i.test(value))return;
 const url=new URL(value.replaceAll('&amp;','&'),'https://readonly.invalid'+base);
 if(url.origin!=='https://readonly.invalid')return;
 if(url.pathname==='/')return;
 if(!files.has(decodeURIComponent(url.pathname)))throw Error('静态引用缺失：'+base+' -> '+url.pathname);
 references++;
};
for(const file of manifest.files){
 const bytes=fs.readFileSync(path.join(folder,file.path));
 if(hash(bytes)!==file.sha256||bytes.length!==file.bytes)throw Error('产物哈希不一致：'+file.path);
 if(/\.(?:html|css)$/.test(file.path)){
  const text=bytes.toString('utf8');
  for(const m of text.matchAll(/\b(?:href|src)="([^"]*)"/g))checkURL(m[1],'/'+file.path);
  for(const m of text.matchAll(/url\(\s*['"]?([^)'"\s]+)/g))checkURL(m[1],'/'+file.path);
  if(file.path.startsWith('pages/')&&/<script\b|href="[^"\s]*\/edit\//i.test(text))throw Error('只读正文含在线入口');
 }
}
const root=path.resolve('website/data'),db=new DatabaseSync(path.join(root,'library.sqlite'),{readOnly:true});
try{
 const current=db.prepare('SELECT d.id,d.version,d.artifact FROM documents d JOIN courses c ON c.id=d.course_id JOIN subjects s ON s.id=c.subject WHERE d.archived=0 AND c.archived=0 AND s.archived=0').all();
 if(current.length!==snapshot.documents.length)throw Error('公开页面数变化');
 for(const d of snapshot.documents){
  const original=current.find(x=>x.id===d.id);if(!original||original.version!==d.version)throw Error('版本变化：'+d.id);
  const source=fs.readFileSync(path.join(root,'markdown',original.artifact,'public/books/page/index.html'),'utf8');
  const output=fs.readFileSync(path.join(folder,'pages',d.id+'.html'),'utf8');
  const math=text=>[...text.matchAll(/\bdata-tex="([^"]*)"/g)].map(m=>m[1]);
  if(JSON.stringify(math(source))!==JSON.stringify(math(output)))throw Error('数学节点变化：'+d.id);
  const before=[...source.matchAll(/<span\b[^>]*>/g)].map(m=>m[0]),after=[...output.matchAll(/<span\b[^>]*>/g)].map(m=>m[0]);
  if(before.length!==after.length)throw Error('数学排版节点数变化：'+d.id);
  for(let i=0;i<before.length;i++){
   const originalStyle=before[i].match(/\sstyle="([^"]*)"/)?.[1];if(!originalStyle)continue;
   const inline=after[i].match(/\sstyle="([^"]*)"/)?.[1],names=(after[i].match(/\sclass="([^"]*)"/)?.[1]||'').split(' ');
   const factored=names.filter(name=>styles.has(name)).at(-1);
   const equivalent=inline||(factored&&styles.get(factored));
   if(originalStyle.split(';').filter(Boolean).join(';')+';'!==equivalent?.split(';').filter(Boolean).join(';')+';')throw Error('数学排版声明变化：'+d.id);
   styleNodes++;
  }
  mathNodes+=math(output).length;
 }
}finally{db.close()}
for(const row of snapshot.documents)for(const key of Object.keys(row))if(!['id','course_id','title','tex','preamble','render_mode','parent_id','position','is_course_home','version','readUrl'].includes(key))throw Error('非公开字段：'+key);
const report={passed:true,documents:snapshot.documents.length,files:manifest.files.length,references,mathNodes,styleNodes,totalBytes:manifest.totalBytes};
console.log(JSON.stringify(report));
