import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';

const format='fudan-library-backup-v1';
const maxBackupManifestBytes=128*1024*1024;
const assetName=/^[a-f0-9]{64}\.(png|jpg|webp|pdf)$/;
const artifactKey=/^[a-f0-9]{64}$/;
const snapshotName=/^snapshot-\d{8}T\d{9}Z-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const allowedFile=/^(library\.sqlite|assets\/[a-f0-9]{64}\.(png|jpg|webp|pdf)|guide-files\/[a-f0-9]{64}\.(pdf|md)|compiled\/[a-f0-9]{64}\.(pdf|json)|markdown\/[a-f0-9]{64}\/(?!.*\.\.)[^\\\0]+)$/;
const fail=message=>{throw Error(message)};
function noLinks(target){
 let current=path.resolve(target);
 for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('不允许符号链接或目录联接：'+current);const parent=path.dirname(current);if(parent===current)break;current=parent}
 return path.resolve(target);
}
function regularFile(file){noLinks(file);const st=fs.lstatSync(file);if(!st.isFile())fail('不是普通文件：'+file);return st}
function sha256(file){
 regularFile(file);const fd=fs.openSync(file,'r'),h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
 try{for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n))}return h.digest('hex')}finally{fs.closeSync(fd)}
}
function filePath(root,relative){if(!allowedFile.test(relative))fail('备份文件路径无效');return path.join(root,...relative.split('/'))}
function readJSON(file,max=16*1024*1024){if(regularFile(file).size>max)fail('清单文件过大');return JSON.parse(fs.readFileSync(file,'utf8'))}
function integrity(db){
 if(db.prepare('PRAGMA integrity_check').all().some(x=>Object.values(x)[0]!=='ok'))fail('SQLite完整性检查失败');
 if(db.prepare('PRAGMA foreign_key_check').all().length)fail('数据库有失效的关联');
}
function tableCounts(db){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT count(*) AS n FROM "'+name.replaceAll('"','""')+'"').get().n]))}
// Published files are append-only: take the SQL snapshot first, then copy exactly
// its referenced immutable assets/artifacts. A missing or changed file aborts.
function references(db,root){
 const result=new Set(['library.sqlite']),artifacts=new Set(),collected=new Set();
 for(const a of db.prepare('SELECT id,filename FROM assets').all()){
  if(!assetName.test(a.filename)||a.filename.slice(0,64)!==a.id)fail('数据库附件标识无效');result.add('assets/'+a.filename);
 }
 if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='atlas_share_files'").get())for(const a of db.prepare('SELECT filename FROM atlas_share_files').all()){
  if(!/^[a-f0-9]{64}\.(pdf|md)$/.test(a.filename))fail('经验附件标识无效');result.add('guide-files/'+a.filename);
 }
 const hasLegacy=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='legacy_sources'").get();
 const pending=new Map((hasLegacy?db.prepare("SELECT * FROM legacy_sources WHERE compile_error<>''").all():[]).map(r=>[r.document_id,r]));
 for(const table of ['documents','revisions'])for(const row of db.prepare('SELECT '+(table==='documents'?'id':'document_id')+' AS document_id,version,tex,preamble,render_mode,artifact FROM '+table).all()){
  for(const match of ((row.tex||'')+'\n'+(row.preamble||'')).matchAll(/\/media\/([a-f0-9]{64}\.(?:png|jpg|webp|pdf))\b/g))result.add('assets/'+match[1]);
  const imported=pending.get(row.document_id);
  const recordedPending=row.artifact===''&&imported&&row.version===imported.imported_version&&createHash('sha256').update(row.tex).digest('hex')===imported.source_hash;
  if(row.render_mode==='latex'&&!artifactKey.test(row.artifact)&&!recordedPending)fail('LaTeX版本缺少有效产物标识');
  if(row.render_mode==='markdown'){
   if(!artifactKey.test(row.artifact))fail('Markdown版本缺少有效产物标识');
   const collect=directory=>{if(collected.has(directory))return;noLinks(directory);collected.add(directory);for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else{regularFile(file);result.add(path.relative(root,file).replaceAll('\\','/'))}}};
   const base=path.join(root,'markdown',row.artifact);if(!fs.existsSync(path.join(base,'.complete')))fail('Markdown产物未完成');collect(base);
   const reference=path.join(base,'bundle-ref.json');if(fs.existsSync(reference)){const ref=readJSON(reference,65536);if(ref.format!=='fudan-markdown-reference-v1'||!artifactKey.test(ref.bundle))fail('Markdown讲义引用无效');const bundle=path.join(root,'markdown',ref.bundle);if(!fs.existsSync(path.join(bundle,'.complete')))fail('Markdown讲义产物未完成');const manifest=readJSON(path.join(bundle,'bundle.json'));if(manifest.key!==ref.bundle||manifest.pages?.[ref.page]?.sourceHash!==ref.sourceHash||createHash('sha256').update(row.tex).digest('hex')!==ref.sourceHash)fail('Markdown源码与讲义产物不一致');collect(bundle)}
  }else if(row.artifact){if(!artifactKey.test(row.artifact))fail('编译产物标识无效');artifacts.add(row.artifact)}
 }
 for(const key of artifacts){
  result.add('compiled/'+key+'.pdf');const rel='compiled/'+key+'.json',file=filePath(root,rel);
  if(fs.existsSync(file)){
   const meta=readJSON(file,65536);if(meta.key!==key||!/^sha256:[a-f0-9]{64}$/.test(meta.runtime)||!Array.isArray(meta.dependencies))fail('编译版本清单无效');
   result.add(rel);
   for(const a of meta.dependencies){if(!assetName.test(a.name)||a.url!=='/media/'+a.name)fail('编译附件清单无效');result.add('assets/'+a.name)}
  }
 }
 return [...result].sort();
}
function verifyData(directory,manifest){
 if(manifest.format!==format||!snapshotName.test(manifest.id)||!Number.isFinite(Date.parse(manifest.created))||!Array.isArray(manifest.files)||manifest.files.length>200000)fail('备份清单格式无效');
 const names=new Set();
 for(const entry of manifest.files){
  if(!entry||names.has(entry.path)||!Number.isSafeInteger(entry.size)||entry.size<0||!artifactKey.test(entry.sha256))fail('备份文件清单无效');names.add(entry.path);
  const file=filePath(directory,entry.path);if(regularFile(file).size!==entry.size||sha256(file)!==entry.sha256)fail('备份文件校验失败：'+entry.path);
  if((entry.path.startsWith('assets/')||entry.path.startsWith('guide-files/'))&&entry.sha256!==path.basename(entry.path).slice(0,64))fail('附件内容与文件名不匹配');
 }
 if(!names.has('library.sqlite'))fail('备份缺少数据库');
 const db=new DatabaseSync(filePath(directory,'library.sqlite'),{readOnly:true});
 try{
  integrity(db);if(JSON.stringify(tableCounts(db))!==JSON.stringify(manifest.tables))fail('备份表记录数不匹配');
  const expected=references(db,directory);if(expected.length!==names.size||expected.some(name=>!names.has(name)))fail('备份没有完整覆盖数据库和历史资源引用');
 }finally{db.close()}
 return manifest;
}
export function verifyBackup(directory){
 directory=noLinks(directory);const manifestPath=path.join(directory,'manifest.json');
 if(regularFile(manifestPath).size>maxBackupManifestBytes)fail('清单文件过大');
 const checksumFile=path.join(directory,'manifest.sha256');regularFile(checksumFile);const expected=fs.readFileSync(checksumFile,'utf8').trim();
 if(!artifactKey.test(expected)||sha256(manifestPath)!==expected)fail('备份清单校验失败');
 return verifyData(directory,readJSON(manifestPath,maxBackupManifestBytes));
}
function freshDirectory(directory){noLinks(directory);fs.mkdirSync(directory,{mode:0o700});return directory}
function ownedCleanup(directory,parent){
 if(path.dirname(path.resolve(directory))!==path.resolve(parent)||!path.basename(directory).startsWith('.partial-'))fail('临时目录清理边界不正确');
 noLinks(directory);if(fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true});
}
export async function createBackup({dbPath,dataDir,backupRoot,runtime={},now=new Date()}={}){
 dbPath=noLinks(dbPath);regularFile(dbPath);dataDir=noLinks(dataDir);backupRoot=noLinks(backupRoot);
 if(backupRoot===dataDir||[path.join(dataDir,'assets'),path.join(dataDir,'compiled')].some(p=>backupRoot===p||backupRoot.startsWith(p+path.sep)))fail('备份目录不能占用数据或附件目录');
 fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
 const id='snapshot-'+now.toISOString().replace(/[-:.]/g,'')+'-'+randomUUID(),partial=freshDirectory(path.join(backupRoot,'.partial-'+id)),destination=path.join(backupRoot,id);
 try{
  const source=new DatabaseSync(dbPath,{readOnly:true});
  try{await sqliteBackup(source,path.join(partial,'library.sqlite'))}finally{source.close()}
  const snapshot=new DatabaseSync(path.join(partial,'library.sqlite'),{readOnly:true});let files,tables;
  try{integrity(snapshot);files=references(snapshot,dataDir);tables=tableCounts(snapshot)}finally{snapshot.close()}
  for(const relative of files){
   if(relative==='library.sqlite')continue;
   const src=filePath(dataDir,relative),dest=filePath(partial,relative);regularFile(src);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.copyFileSync(src,dest,fs.constants.COPYFILE_EXCL);
  }
  const manifest={format,id,created:now.toISOString(),runtime:{node:process.version,compileMode:runtime.compileMode||'unknown',image:runtime.image||null},tables,files:files.map(relative=>{const file=filePath(partial,relative);return {path:relative,size:regularFile(file).size,sha256:sha256(file)}})};
  fs.writeFileSync(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(partial,'manifest.sha256'),sha256(path.join(partial,'manifest.json'))+'\n',{flag:'wx',mode:0o600});
  verifyBackup(partial);if(fs.existsSync(destination))fail('备份目标已存在');fs.renameSync(partial,destination);return {directory:destination,manifest};
 }catch(e){ownedCleanup(partial,backupRoot);throw e}
}
export function restoreBackup(directory,destination){
 directory=noLinks(directory);destination=noLinks(destination);if(fs.existsSync(destination))fail('恢复目标必须是尚不存在的新目录，不能覆盖现有数据');
 if(destination.startsWith(directory+path.sep))fail('恢复目标不能在备份内部');
 const manifest=verifyBackup(directory),parent=path.dirname(destination);fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const partial=freshDirectory(path.join(parent,'.partial-restore-'+randomUUID()));
 try{
  for(const entry of manifest.files){const source=filePath(directory,entry.path),target=filePath(partial,entry.path);regularFile(source);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL)}
  verifyData(partial,manifest);
  const db=new DatabaseSync(path.join(partial,'library.sqlite'));let sessions,tokens;
  try{
   db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
   sessions=db.prepare('DELETE FROM sessions').run().changes;tokens=db.prepare('DELETE FROM auth_tokens').run().changes;
   db.exec('COMMIT');integrity(db);db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }finally{db.close()}
  const report={format:'fudan-library-restore-v1',sourceSnapshot:manifest.id,sourceManifest:sha256(path.join(directory,'manifest.json')),restored:new Date().toISOString(),revokedSessions:sessions,revokedEmailTokens:tokens};
  fs.writeFileSync(path.join(partial,'restore-report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  for(const sub of ['assets','compiled'])fs.mkdirSync(path.join(partial,sub),{recursive:true,mode:0o700});
  if(fs.existsSync(destination))fail('恢复目标已被其他进程创建');fs.renameSync(partial,destination);return {directory:destination,...report};
 }catch(e){ownedCleanup(partial,parent);throw e}
}
export function pruneBackups(backupRoot,{days=7,minKeep=7,apply=false,now=new Date()}={}){
 backupRoot=noLinks(backupRoot);if(!Number.isSafeInteger(days)||days<1||days>3650||!Number.isSafeInteger(minKeep)||minKeep<1)fail('保留天数和最少份数不正确');
 const valid=[],skipped=[];
 for(const name of fs.readdirSync(backupRoot)){
  if(!snapshotName.test(name))continue;const directory=path.join(backupRoot,name);
  try{const manifest=verifyBackup(directory);if(manifest.id!==name)fail('名称与清单不一致');valid.push({directory,created:Date.parse(manifest.created)})}catch{skipped.push(name)}
 }
 valid.sort((a,b)=>b.created-a.created||b.directory.localeCompare(a.directory));
 const candidates=valid.filter((x,i)=>i>=minKeep&&x.created<now.getTime()-days*86400000).map(x=>x.directory);
 if(apply)for(const directory of candidates){if(path.dirname(directory)!==backupRoot||!snapshotName.test(path.basename(directory)))fail('清理路径越界');verifyBackup(directory);fs.rmSync(directory,{recursive:true})}
 return {apply,days,minKeep,candidates,skipped};
}
