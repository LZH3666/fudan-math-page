import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createBackup,verifyBackup,restoreBackup,pruneBackups} from '../backup.mjs';
import {start} from './helpers.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');

test('backup manifests above 16MiB verify and restore; above 128MiB fail closed',async t=>{
 const f=await fixture(t),saved=await createBackup({...f,runtime:{image:'x'.repeat(17*1024*1024)}});
 const manifestFile=path.join(saved.directory,'manifest.json');
 assert.ok(fs.statSync(manifestFile).size>16*1024*1024);
 assert.equal(verifyBackup(saved.directory).id,saved.manifest.id);
 const target=path.join(f.root,'large-manifest-restore');restoreBackup(saved.directory,target);
 assert.ok(fs.existsSync(path.join(target,'restore-report.json')));
 const fd=fs.openSync(manifestFile,'r+');try{fs.ftruncateSync(fd,128*1024*1024+1)}finally{fs.closeSync(fd)}
 assert.throws(()=>verifyBackup(saved.directory),/清单文件过大/);
});
test('latest-backup CLI restores only to a new directory and fails on corrupt newest snapshot',async t=>{
 const f=await fixture(t),saved=await createBackup(f),target=path.join(f.root,'latest-restore');
 const invoke=destination=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/restore-latest-backup.mjs',import.meta.url)),destination],{env:{...process.env,FUDAN_BACKUP_ROOT:f.backupRoot},encoding:'utf8'});
 assert.equal(invoke(target).status,0);assert.ok(fs.existsSync(path.join(target,'library.sqlite')));
 assert.notEqual(invoke(target).status,0);
 fs.mkdirSync(path.join(f.backupRoot,'snapshot-99991231T235959999Z-00000000-0000-0000-0000-000000000000'));
 assert.notEqual(invoke(path.join(f.root,'corrupt-restore')).status,0);
 assert.ok(fs.existsSync(path.join(saved.directory,'manifest.json')));
});
test('pre-import backups without legacy_sources still verify and restore',async t=>{
 const f=await fixture(t);f.a.db.exec('DROP TABLE legacy_sources');
 const saved=await createBackup(f);assert.ok(verifyBackup(saved.directory));
 const target=path.join(f.root,'old-schema-restore');restoreBackup(saved.directory,target);
 assert.ok(fs.existsSync(path.join(target,'library.sqlite')));
});
test('backup preserves documented pending legacy originals but rejects unrelated missing PDFs',async t=>{
 const f=await fixture(t),d=f.current,source='uncompiled original';
 f.a.db.prepare("UPDATE documents SET tex=?,artifact='' WHERE id=?").run(source,d.id);
 f.a.db.prepare("INSERT INTO legacy_sources VALUES(?,?,?,?,?,?,?)").run(d.id,'original','https://bananaspace.org/legacy/wiki/test',hash(source),'CC BY-SA 4.0',d.version,'known source syntax');
 const saved=await createBackup(f);assert.ok(verifyBackup(saved.directory));
 f.a.db.prepare('UPDATE documents SET tex=? WHERE id=?').run('different content',d.id);
 await assert.rejects(createBackup(f),/缺少有效产物/);
});
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-backup space-')),dataDir=path.join(root,'live'),backupRoot=path.join(root,'backups');fs.mkdirSync(dataDir);
 const compiler={assets:path.join(dataDir,'assets'),output:path.join(dataDir,'compiled'),compile:async tex=>{const artifact=hash(tex);fs.writeFileSync(path.join(compiler.output,artifact+'.pdf'),'%PDF-1.7\n'+tex+'\n%%EOF');return {artifact}}};for(const d of [compiler.assets,compiler.output])fs.mkdirSync(d);
 const dbPath=path.join(dataDir,'library.sqlite'),a=await start(dbPath,{dataDir,compiler});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});
 const admin=await a.register('备份管理员'),editor=await a.register('备份编辑者');
 const upload=await a.call('/assets',{method:'POST',user:editor,body:{data:fs.readFileSync(new URL('./fixtures/image.png',import.meta.url)).toString('base64')}});
 const created=await a.call('/courses/topology/documents',{method:'POST',user:editor,body:{title:'持久数据',tex:'旧版 \\includegraphics{'+upload.data.url+'}',preamble:'',position:0,render_mode:'latex'}});assert.equal(created.status,201);
 const old=created.data.document,edited=await a.call('/documents/'+old.id,{method:'PUT',user:editor,body:{...old,tex:'当前正文'}});assert.equal(edited.status,200);const current=edited.data.document;
 const meta={key:old.artifact,runtime:'sha256:'+'a'.repeat(64),dependencies:[{name:path.basename(upload.data.url),url:upload.data.url}]};fs.writeFileSync(path.join(compiler.output,old.artifact+'.json'),JSON.stringify(meta));
 await a.call('/documents/'+old.id+'/comments',{method:'POST',user:editor,body:{body:'可恢复评论'}});
 await a.call('/admin/comments/1/moderate',{method:'POST',user:admin,body:{hidden:true,version:1,reason:'测试备份治理状态'}});
 await a.call('/admin/users/'+editor.id+'/block',{method:'POST',user:admin,body:{blocked:true,version:0,reason:'测试保留封禁状态'}});
 fs.writeFileSync(path.join(dataDir,'compile-token'),'must-not-copy');fs.mkdirSync(path.join(dataDir,'mail-outbox'));fs.writeFileSync(path.join(dataDir,'mail-outbox','secret.json'),'must-not-copy');
 fs.writeFileSync(path.join(compiler.output,'f'.repeat(64)+'.pdf'),'unreferenced preview');
 return {root,a,old,current,dbPath,dataDir,backupRoot,editor};
}

test('online snapshot restores accounts, governance, source, dependencies and every historical PDF; resets old credentials without touching live data',async t=>{
 const f=await fixture(t),saved=await createBackup(f),m=verifyBackup(saved.directory);
 assert.ok(m.files.some(x=>x.path==='compiled/'+f.old.artifact+'.pdf'));assert.ok(m.files.some(x=>x.path==='compiled/'+f.current.artifact+'.pdf'));assert.ok(m.files.some(x=>x.path==='compiled/'+f.old.artifact+'.json'));
 assert.ok(!m.files.some(x=>/token|outbox|ffffffffff/.test(x.path)));
 const sessionsBefore=f.a.db.prepare('SELECT count(*) AS n FROM sessions').get().n;
 const destination=path.join(f.root,'restored copy'),restored=restoreBackup(saved.directory,destination);assert.equal(restored.revokedSessions,sessionsBefore);
 const db=new DatabaseSync(path.join(destination,'library.sqlite'),{readOnly:true});
 try{
  for(const {name}of f.a.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
   const actual=db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all();
   if(['sessions','auth_tokens'].includes(name))assert.deepEqual(actual,[]);else assert.deepEqual(actual,f.a.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all(),name);
  }
 }finally{db.close()}
 for(const entry of m.files.filter(x=>x.path!=='library.sqlite'))assert.deepEqual(fs.readFileSync(path.join(destination,entry.path)),fs.readFileSync(path.join(saved.directory,entry.path)));
 assert.equal(f.a.db.prepare('SELECT count(*) AS n FROM sessions').get().n,sessionsBefore);assert.equal(f.a.db.prepare('SELECT blocked FROM users WHERE id=?').get(f.editor.id).blocked,1);
 const restarted=await start(path.join(destination,'library.sqlite'),{dataDir:destination});
 try{assert.equal((await restarted.call('/documents/'+f.current.id)).data.document.tex,'当前正文');assert.equal((await restarted.call('/documents/'+f.current.id+'/history')).data.revisions.length,2);const response=await fetch(restarted.base+'/compiled/'+f.old.artifact+'.pdf');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(f.dataDir,'compiled',f.old.artifact+'.pdf')))}finally{await restarted.close()}
 assert.throws(()=>restoreBackup(saved.directory,f.dataDir),/不能覆盖/);
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/backup.mjs',import.meta.url)),'verify',saved.directory],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);
});

test('missing live dependencies and corrupted snapshots fail closed; partial backups cannot be mistaken for valid snapshots',async t=>{
 const f=await fixture(t),saved=await createBackup(f),oldFile=path.join(f.dataDir,'compiled',f.old.artifact+'.pdf');
 fs.unlinkSync(oldFile);await assert.rejects(createBackup(f));assert.deepEqual(fs.readdirSync(f.backupRoot),[path.basename(saved.directory)]);
 const target=path.join(saved.directory,'compiled',f.current.artifact+'.pdf');fs.appendFileSync(target,'corrupt');
 assert.throws(()=>verifyBackup(saved.directory),/校验失败/);const restoreTo=path.join(f.root,'must not exist');assert.throws(()=>restoreBackup(saved.directory,restoreTo),/校验失败/);assert.equal(fs.existsSync(restoreTo),false);
});

test('backup manifest cannot traverse paths; directory junctions are rejected',async t=>{
 const f=await fixture(t),saved=await createBackup(f),manifestFile=path.join(saved.directory,'manifest.json');
 const m=JSON.parse(fs.readFileSync(manifestFile));m.files[0].path='../outside';fs.writeFileSync(manifestFile,JSON.stringify(m));fs.writeFileSync(path.join(saved.directory,'manifest.sha256'),hash(fs.readFileSync(manifestFile)));
 assert.throws(()=>verifyBackup(saved.directory),/路径无效/);
 const junction=path.join(f.root,'linked-assets');fs.symlinkSync(path.join(f.dataDir,'assets'),junction,process.platform==='win32'?'junction':'dir');
 await assert.rejects(createBackup({...f,backupRoot:path.join(junction,'backups')}),/联接/);
});

test('default retention uses seven days in the API and CLI, preserves seven valid snapshots, and remains a dry run',async t=>{
 const f=await fixture(t),now=new Date(),saved=[];
 for(const ageDays of [10,9,5.5,4.5,3.5,2.5,1.5,0.5])saved.push(await createBackup({...f,now:new Date(now.getTime()-ageDays*86400000)}));
 const planned=pruneBackups(f.backupRoot,{now});
 assert.deepEqual(planned.candidates,[saved[0].directory]);assert.equal(planned.apply,false);
 assert.ok(fs.existsSync(saved[0].directory));assert.ok(fs.existsSync(saved[1].directory));
 const env={...process.env,FUDAN_BACKUP_ROOT:f.backupRoot};delete env.FUDAN_BACKUP_DAYS;delete env.FUDAN_BACKUP_MIN_KEEP;
 const invoke=extra=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/backup.mjs',import.meta.url)),'prune'],{env:{...env,...extra},encoding:'utf8'});
 const cli=invoke({});assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout).candidates,planned.candidates);assert.equal(JSON.parse(cli.stdout).apply,false);
 const overridden=invoke({FUDAN_BACKUP_DAYS:'30'});assert.equal(overridden.status,0,overridden.stderr);assert.deepEqual(JSON.parse(overridden.stdout).candidates,[]);
 assert.ok(saved.every(s=>fs.existsSync(s.directory)));
});

test('retention is dry-run by default, preserves newest minimum and unrelated/corrupt backups, and only removes verified old snapshots',async t=>{
 const f=await fixture(t),saved=[];
 for(const day of [1,2,3,4])saved.push(await createBackup({...f,now:new Date('2026-01-0'+day+'T00:00:00Z')}));
 const unrelated=path.join(f.backupRoot,'upgrade-baseline');fs.mkdirSync(unrelated);fs.writeFileSync(path.join(unrelated,'keep'),'preserve');
 fs.appendFileSync(path.join(saved[0].directory,'manifest.sha256'),'invalid');
 const options={now:new Date('2026-10-13T00:00:00Z'),days:30,minKeep:2};
 const planned=pruneBackups(f.backupRoot,options);assert.deepEqual(planned.candidates,[saved[1].directory]);assert.equal(planned.skipped.length,1);assert.ok(fs.existsSync(saved[1].directory));
 const removed=pruneBackups(f.backupRoot,{...options,apply:true});assert.deepEqual(removed.candidates,planned.candidates);assert.equal(fs.existsSync(saved[1].directory),false);assert.ok(fs.existsSync(saved[0].directory));assert.ok(fs.existsSync(saved[2].directory));assert.ok(fs.existsSync(saved[3].directory));assert.equal(fs.readFileSync(path.join(unrelated,'keep'),'utf8'),'preserve');
});
