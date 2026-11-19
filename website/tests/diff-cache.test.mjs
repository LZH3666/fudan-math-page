import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createDiffCache} from '../diff-cache.mjs';
import {start} from './helpers.mjs';

test('background diff cache waits and recovers from an external database writer',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'fudan-diff-busy-')),file=path.join(dir,'cache.sqlite');
 const db=new DatabaseSync(file),other=new DatabaseSync(file);let cache;
 try{
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE revisions(id INTEGER PRIMARY KEY,document_id TEXT,version INTEGER,tex TEXT)');
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(1,'a',1,'原始正文');
  cache=createDiffCache(db);other.exec('BEGIN IMMEDIATE');
  const unlock=setTimeout(()=>other.exec('COMMIT'),120);
  await Promise.race([cache.ready(),new Promise((_,reject)=>setTimeout(()=>reject(Error('cache did not recover')),8000))]);clearTimeout(unlock);
  assert.equal(db.prepare('SELECT count(*) n FROM revision_diff_stats').get().n,1);
  assert.equal(db.prepare('SELECT tex FROM revisions WHERE id=1').get().tex,'原始正文');
  other.exec('BEGIN IMMEDIATE');cache.compare('甲乙','甲丙');
  const unlockResult=setTimeout(()=>other.exec('COMMIT'),750);
  await Promise.race([cache.ready(),new Promise((_,reject)=>setTimeout(()=>reject(Error('result write did not recover')),8000))]);clearTimeout(unlockResult);
  assert.equal(cache.compare('甲乙','甲丙').status,'complete');
 }finally{try{other.exec('ROLLBACK')}catch{}await cache?.close();other.close();db.close();rmSync(dir,{recursive:true,force:true})}
});

test('persistent cache survives restart, upgrades invalidate it, sources remain unchanged',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'fudan-diff-test-')),file=path.join(dir,'cache.sqlite');
 let db=new DatabaseSync(file),cache;
 try{
  db.exec('CREATE TABLE revisions(id INTEGER PRIMARY KEY,document_id TEXT,version INTEGER,tex TEXT)');
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(1,'a',1,'甲乙丙');
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(2,'a',2,'甲丁丙');
  cache=createDiffCache(db);await cache.ready();
  assert.equal(cache.compare('甲乙丙','甲丁丙').added,1);
  await cache.close();db.close();db=new DatabaseSync(file);cache=createDiffCache(db);
  assert.equal(cache.compare('甲乙丙','甲丁丙').status,'complete');await cache.ready();
  db.exec("UPDATE text_diff_cache SET algorithm='obsolete',added=99999");
  assert.equal(cache.compare('甲乙丙','甲丁丙').added,null);await cache.ready();
  assert.equal(cache.compare('甲乙丙','甲丁丙').added,1);
  assert.deepEqual(db.prepare('SELECT tex FROM revisions ORDER BY id').all().map(r=>r.tex),['甲乙丙','甲丁丙']);
 }finally{await cache?.close();db.close();rmSync(dir,{recursive:true,force:true})}
});

test('background work yields and finishes a large replacement exactly',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE revisions(id INTEGER PRIMARY KEY,document_id TEXT,version INTEGER,tex TEXT)');
 const cache=createDiffCache(db);
 try{
  const a='甲'.repeat(80000),b='乙'.repeat(80000);cache.compare(a,b);
  let ticks=0;const timer=setInterval(()=>ticks++,10);
  await cache.ready();clearInterval(timer);
  assert.ok(ticks>10,'event loop must continue while comparison runs');
  const d=cache.compare(a,b);assert.equal(d.status,'complete');assert.equal(d.added,80000);assert.equal(d.removed,80000);
 }finally{await cache.close();db.close()}
});

test('comparison API uses the same result as feed and fixes revision endpoints',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('差异接口管理员');
 const home=(await a.call('/courses/topology')).data.home;
 const ins=a.db.prepare('INSERT INTO revisions(document_id,version,title,tex,type,position,user_id,summary,created) VALUES(?,?,?,?,?,?,?,?,?)');
 const id1=Number(ins.run(home.id,101,'测试','甲乙丙','lecture',0,admin.id,'修改','2026-10-21T00:00:00Z').lastInsertRowid);
 const id2=Number(ins.run(home.id,102,'测试','甲丁丙','lecture',0,admin.id,'修改','2026-10-21T00:01:00Z').lastInsertRowid);
 const id3=Number(ins.run(home.id,103,'测试','甲丁丙戊','lecture',0,admin.id,'修改','2026-10-21T00:02:00Z').lastInsertRowid);
 a.db.prepare('UPDATE documents SET tex=?,version=103 WHERE id=?').run('甲丁丙戊',home.id);
 const pending=(await a.call('/admin/recent?sort=size',{user:admin})).data;
 assert.ok(pending.uncounted>0);assert.ok(pending.changes.every(r=>r.source!=='page'||r.exact));
 await a.diffCache.ready();
 const feed=(await a.call('/admin/recent',{user:admin})).data.changes;
 const entry=feed.find(r=>r.source==='page'&&r.eventId===id2);
 const route='/documents/'+home.id+'/diff?from='+id1;
 const current=(await a.call(route+'&to='+id2)).data;
 assert.equal(current.diff.added,entry.added);assert.equal(current.diff.removed,entry.removed);
 assert.equal(current.old.version,101);assert.equal(current.next.version,102);
 const latest=(await a.call(route+'&to=latest')).data;assert.equal(latest.nextRevisionId,id3);
 await a.diffCache.ready();const complete=(await a.call(route+'&to='+id3)).data;
 assert.equal(complete.diff.added,2);assert.equal(complete.diff.removed,1);
 assert.equal((await a.call('/documents/not-a-document/diff?from='+id1+'&to='+id2)).status,404);
 assert.equal((await a.call('/documents/'+home.id+'/diff?from=-1')).status,400);
 const other=(await a.call('/courses/real')).data.home;
 assert.equal((await a.call('/documents/'+other.id+'/diff?from='+id1+'&to='+id2)).status,404);
 assert.equal((await a.call('/admin/recent')).status,401);
});

test('legacy incomplete cache resumes after restart; completed rows are reused',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE revisions(id INTEGER PRIMARY KEY,document_id TEXT,version INTEGER,tex TEXT); INSERT INTO revisions VALUES(1,'page',1,'原文'),(2,'page',2,'新文')");
 let cache=createDiffCache(db);
 try{
  await cache.ready();await cache.close();
  const key=db.prepare('SELECT cache_key FROM revision_diff_stats WHERE revision_id=2').get().cache_key;
  db.prepare("UPDATE text_diff_cache SET status='incomplete',added=NULL,removed=NULL,changed=NULL,parts=NULL WHERE key=?").run(key);
  db.exec("CREATE TRIGGER keep_complete BEFORE DELETE ON text_diff_cache WHEN OLD.status='complete' BEGIN SELECT RAISE(ABORT,'unexpected delete'); END; PRAGMA recursive_triggers=ON");
  cache=createDiffCache(db);await cache.ready();
  const diff=cache.compare('原文','新文');assert.equal(diff.status,'complete');assert.equal(diff.changed,2);
  assert.equal(db.prepare('SELECT count(*) n FROM revisions').get().n,2);
 }finally{await cache.close();db.close()}
});
