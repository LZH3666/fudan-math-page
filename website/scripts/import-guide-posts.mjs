import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bundle=JSON.parse(fs.readFileSync(path.join(root,'content/other-functions/posts.json'),'utf8'));
// Explicit additive import: never initializes accounts, updates existing posts, or touches courses.
export async function importGuidePosts({dbPath,dataDir,backupPath,apply=false}){
 if(!fs.existsSync(dbPath))throw Error('Database must already exist');
 const db=new DatabaseSync(dbPath,{readOnly:!apply});
 try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const author=db.prepare('SELECT id,username FROM users WHERE username=?').get(bundle.author);
  if(!author)throw Error('Requested author does not exist');
  const posts=bundle.posts.map(p=>{
   if(!p.title||p.title.length>120||p.body.length>20000)throw Error('Invalid post');
   const files=p.files.map((f,i)=>{const input=path.resolve(root,f.path.replace(/^website\//,''));if(!input.startsWith(root+path.sep))throw Error('Invalid attachment path');const bytes=fs.readFileSync(input);if(bytes.length>5*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!bytes.subarray(-1024).includes(Buffer.from('%%EOF')))throw Error('Invalid PDF');return {id:p.id+'-file-'+i,filename:hash(bytes)+'.pdf',name:f.name,bytes}});
   return {...p,files,resources:JSON.stringify({attachments:files.map(f=>f.id),links:[]})};
  });
  const existing=()=>posts.map(p=>{const r=db.prepare('SELECT * FROM atlas_entries WHERE id=?').get(p.id);if(r){if(r.kind!=='guide'||r.user_id!==author.id||r.title!==p.title||r.body!==p.body||r.resources!==p.resources)throw Error('Existing post differs; refusing to overwrite '+p.id);for(const f of p.files){const row=db.prepare('SELECT * FROM atlas_share_files WHERE id=?').get(f.id);const target=path.join(dataDir,'guide-files',f.filename);if(!row||row.entry_id!==p.id||row.filename!==f.filename||row.user_id!==author.id||row.name!==f.name||row.mime!=='application/pdf'||row.size!==f.bytes.length||!fs.existsSync(target)||!fs.readFileSync(target).equals(f.bytes))throw Error('Existing attachment differs');}}else if(db.prepare('SELECT id FROM atlas_entries WHERE kind=? AND title=?').get('guide',p.title))throw Error('Same-title post exists; inspect before importing');return !!r});
  const seen=existing();
  if(!apply)return {apply:false,author:author.username,create:posts.filter((_,i)=>!seen[i]).map(p=>p.title),skip:seen.filter(Boolean).length};
  if(!backupPath||fs.existsSync(backupPath))throw Error('A new backup path is required');
  await backup(db,backupPath);
  const dir=path.join(dataDir,'guide-files');fs.mkdirSync(dir,{recursive:true});
  const made=[];let committed=false;
  db.exec('BEGIN IMMEDIATE');
  try{
   const current=existing();const created=new Date().toISOString();let inserted=0;
   for(const [i,p] of posts.entries()){
    if(current[i])continue;
    db.prepare('INSERT INTO atlas_entries(id,kind,course_id,teacher,term,title,body,user_id,version,hidden,created,updated,offering_id,resources,featured) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.id,'guide',null,'','',p.title,p.body,author.id,1,0,created,created,'',p.resources,0);
    for(const f of p.files){const target=path.join(dir,f.filename);try{fs.writeFileSync(target,f.bytes,{flag:'wx',mode:0o600});made.push(target)}catch(e){if(e.code!=='EEXIST'||!fs.readFileSync(target).equals(f.bytes))throw e}db.prepare('INSERT INTO atlas_share_files(id,filename,name,mime,size,user_id,entry_id,created) VALUES(?,?,?,?,?,?,?,?)').run(f.id,f.filename,f.name,'application/pdf',f.bytes.length,author.id,p.id,created)}
    const row=db.prepare('SELECT e.*,u.username FROM atlas_entries e JOIN users u ON u.id=e.user_id WHERE e.id=?').get(p.id);
    db.prepare('INSERT INTO atlas_history(entry_id,version,actor_id,snapshot,created) VALUES(?,?,?,?,?)').run(p.id,1,author.id,JSON.stringify(row),created);inserted++;
   }
   db.exec('COMMIT');committed=true;
   return {apply:true,author:author.username,inserted,skipped:posts.length-inserted,backup:backupPath};
  }finally{if(!committed){db.exec('ROLLBACK');for(const file of made)fs.unlinkSync(file)}}
 }finally{db.close()}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
 if(!args.includes('--db')||!args.includes('--data-dir'))throw Error('Pass --db and --data-dir explicitly');
 console.log(JSON.stringify(await importGuidePosts({dbPath:path.resolve(value('--db')),dataDir:path.resolve(value('--data-dir')),backupPath:args.includes('--backup')?path.resolve(value('--backup')):undefined,apply:args.includes('--apply')})));
}
