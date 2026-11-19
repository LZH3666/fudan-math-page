import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {withImportLock} from '../scripts/import-lock.mjs';
test('scheduled and finish imports serialize and release the lock even on failure',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'course-import-lock-')),lock=path.join(root,'lock');
 try{const order=[];let release;const gate=new Promise(resolve=>release=resolve),first=withImportLock(lock,async()=>{order.push('first');await gate;order.push('first-done')});const second=withImportLock(lock,async()=>{order.push('second')},{pollMs:5});await delay(15);assert.deepEqual(order,['first']);release();await Promise.all([first,second]);assert.deepEqual(order,['first','first-done','second']);assert.equal(fs.existsSync(lock),false);
  await assert.rejects(withImportLock(lock,()=>{throw Error('test failure')}),/test failure/);assert.equal(fs.existsSync(lock),false);
  fs.writeFileSync(lock,'existing');await assert.rejects(withImportLock(lock,()=>assert.fail('must not import'),{timeoutMs:10,pollMs:2}),/preserved/);assert.equal(fs.readFileSync(lock,'utf8'),'existing');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
