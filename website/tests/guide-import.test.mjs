import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {start} from './helpers.mjs';
import {importGuidePosts} from '../scripts/import-guide-posts.mjs';
const bundle=JSON.parse(fs.readFileSync(new URL('../content/other-functions/posts.json',import.meta.url)));
const digest=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,JSON.stringify(db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all())]));
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guide-import-')),dbPath=path.join(root,'library.sqlite'),dataDir=path.join(root,'data');
 const app=await start(dbPath,{dataDir});await app.register(bundle.author);await app.register('另一位同学');await app.close();
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=(apply=false,tag='backup')=>importGuidePosts({dbPath,dataDir,apply,backupPath:path.join(root,tag+'.sqlite')});
 return {root,dbPath,dataDir,run};
}
test('guide rehearsal imports one post with history and exact PDF, preserves other tables, and is idempotent',async t=>{
 const f=await fixture(t),beforeDB=new DatabaseSync(f.dbPath,{readOnly:true}),before=digest(beforeDB);beforeDB.close();
 const filesBefore=fs.readdirSync(f.dataDir,{recursive:true});assert.equal((await f.run()).create.length,1);assert.deepEqual(fs.readdirSync(f.dataDir,{recursive:true}),filesBefore);
 assert.equal((await f.run(true)).inserted,1);
 const db=new DatabaseSync(f.dbPath,{readOnly:true}),after=digest(db);
 assert.deepEqual(Object.keys(before).filter(k=>before[k]!==after[k]).sort(),['atlas_entries','atlas_history','atlas_share_files']);
 const post=db.prepare('SELECT * FROM atlas_entries WHERE id=?').get(bundle.posts[0].id),file=db.prepare('SELECT * FROM atlas_share_files WHERE entry_id=?').get(post.id);
 assert.equal(post.version,1);assert.equal(db.prepare('SELECT count(*) n FROM atlas_history WHERE entry_id=?').get(post.id).n,1);
 const bytes=fs.readFileSync(path.join(f.dataDir,'guide-files',file.filename));assert.equal(createHash('sha256').update(bytes).digest('hex')+'.pdf',file.filename);
 assert.ok(bytes.equals(fs.readFileSync(new URL('../dist/course-atlas/assets/guide-202605.pdf',import.meta.url))));db.close();
 assert.equal((await f.run(true,'repeat')).inserted,0);const again=new DatabaseSync(f.dbPath,{readOnly:true});assert.deepEqual(digest(again),after);again.close();
 const backup=new DatabaseSync(path.join(f.root,'backup.sqlite'),{readOnly:true});assert.deepEqual(digest(backup),before);backup.close();
});
test('guide import refuses user edits and corrupted attachment metadata without overwriting',async t=>{
 const f=await fixture(t);await f.run(true);const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE atlas_entries SET body=? WHERE id=?').run('同学新编辑',bundle.posts[0].id);db.close();
 await assert.rejects(()=>f.run(true,'conflict'),/refusing to overwrite/);assert.equal(fs.existsSync(path.join(f.root,'conflict.sqlite')),false);
 const check=new DatabaseSync(f.dbPath);assert.equal(check.prepare('SELECT body FROM atlas_entries WHERE id=?').get(bundle.posts[0].id).body,'同学新编辑');
 check.prepare('UPDATE atlas_entries SET body=? WHERE id=?').run(bundle.posts[0].body,bundle.posts[0].id);check.prepare('UPDATE atlas_share_files SET name=?').run('被修改的附件.pdf');check.close();
 await assert.rejects(()=>f.run(true,'metadata'),/Existing attachment differs/);
});
test('same-title posts by any author are rejected and dry-run never creates a backup',async t=>{
 const f=await fixture(t),db=new DatabaseSync(f.dbPath),author=db.prepare('SELECT id FROM users WHERE username=?').get('另一位同学');
 db.prepare("INSERT INTO atlas_entries(id,kind,teacher,term,title,body,user_id,created,updated) VALUES('other','guide','','',?,'已有正文',?,'now','now')").run(bundle.posts[0].title,author.id);db.close();
 await assert.rejects(()=>f.run(),/Same-title post exists/);assert.equal(fs.existsSync(path.join(f.root,'backup.sqlite')),false);
});
