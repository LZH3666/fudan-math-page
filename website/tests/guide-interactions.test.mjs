import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {start} from './helpers.mjs';
import {createBackup,restoreBackup,verifyBackup} from '../backup.mjs';
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
const md=Buffer.from('# 选课经验\n\n先修建议 **原文**。\n');
const post=(a,u,route,body)=>a.call('/atlas/'+route,{method:'POST',user:u,body});
const put=(a,u,route,body)=>a.call('/atlas/'+route,{method:'PUT',user:u,body});
async function upload(a,u,name,bytes){const result=await post(a,u,'uploads',{name,data:bytes.toString('base64')});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.file;}
async function share(a,u,b={body:'先修课经验'}){const result=await post(a,u,'entries',{kind:'guide',...b});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.entry;}
test('body, links and staged attachments publish atomically as exactly one share',async t=>{
 const a=await start();t.after(()=>a.close());const u=await a.register('一起发布验收');const file=await upload(a,u,'经验.md',md);
 const created=await share(a,u,{body:'正文与附件及链接一起发布',attachments:[file.id],links:['https://www.fudan.edu.cn/']});
 const list=(await a.call('/atlas/entries?kind=guide')).data.entries;assert.equal(list.length,1);assert.equal(list[0].id,created.id);assert.equal(list[0].body,'正文与附件及链接一起发布');assert.equal(list[0].attachments[0].id,file.id);assert.deepEqual(list[0].links,['https://www.fudan.edu.cn/']);
 assert.equal(a.db.prepare('SELECT count(*) n FROM atlas_history WHERE entry_id=?').get(created.id).n,1);assert.equal(a.db.prepare('SELECT entry_id FROM atlas_share_files WHERE id=?').get(file.id).entry_id,created.id);
});
test('PDF and Markdown uploads validate format, ownership and size; links reject executable schemes; history retains detached files',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('附件管理员'),u=await a.register('附件作者'),v=await a.register('其他上传者');
 assert.equal((await post(a,null,'uploads',{name:'a.pdf',data:pdf.toString('base64')})).status,401);
 for(const [name,bytes] of [['a.html',md],['a.pdf',md],['a.md',Buffer.from([0xff])],['a.md',Buffer.from('a\0b')],['../a.md',md]])assert.equal((await post(a,u,'uploads',{name,data:bytes.toString('base64')})).status,400);
 assert.equal((await post(a,u,'uploads',{name:'big.md',data:Buffer.alloc(5*1024*1024+1,97).toString('base64')})).status,413);
 const f=await upload(a,u,'讲义.pdf',pdf),m=await upload(a,u,'经验.markdown',md);
 assert.equal((await fetch(a.base+f.url)).status,404);assert.equal((await fetch(a.base+f.url,{headers:{Cookie:u.cookie}})).status,200);
 assert.equal((await post(a,v,'entries',{kind:'guide',attachments:[f.id],body:''})).status,400);
 assert.equal((await post(a,u,'entries',{kind:'guide',links:['javascript:alert(1)'],body:''})).status,400);
 assert.equal((await post(a,u,'entries',{kind:'guide',links:['https://name:secret@example.com'],body:''})).status,400);
 const r=await share(a,u,{body:'',attachments:[f.id,m.id],links:['https://example.com/path']});assert.equal(r.attachments.length,2);
 const response=await fetch(a.base+m.url);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(await response.text(),md.toString());
 assert.equal((await share(a,v,{body:'另一条分享'})).attachments.length,0);
 assert.equal((await post(a,u,'entries',{kind:'guide',body:'',attachments:[f.id]})).status,400);
 const edited=await put(a,u,'entries/'+r.id,{version:1,body:'改为正文',attachments:[],links:[]});assert.equal(edited.status,200);assert.equal(edited.data.entry.attachments.length,0);assert.equal((await fetch(a.base+m.url)).status,200);
 const history=(await a.call('/atlas/entries/'+r.id+'/history')).data.history;assert.equal(JSON.parse(history.at(-1).snapshot).attachments.length,2);
 const hidden=await post(a,admin,'entries/'+r.id+'/moderate',{hidden:true,version:2,reason:'测试隐藏'});assert.equal(hidden.status,201);assert.equal((await fetch(a.base+f.url)).status,404);assert.equal((await fetch(a.base+m.url)).status,404);
});
test('one vote per account toggles or cancels; comments are author editable with history; featured is admin-only and hot/time sorting is global',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('互动管理员'),u=await a.register('互动作者'),v=await a.register('互动读者');
 const old=await share(a,u),middle=await share(a,u,{body:'精华内容'}),latest=await share(a,u,{body:'最近发布'});
 for(const [r,date] of [[old,'2024-01-01'],[middle,'2025-01-01'],[latest,'2026-01-01']])a.db.prepare('UPDATE atlas_entries SET created=? WHERE id=?').run(date,r.id);
 const vote=value=>post(a,v,'entries/'+old.id+'/vote',{value});
 assert.equal((await vote(1)).data.entry.likes,1);assert.equal((await vote(1)).data.entry.likes,1);assert.equal((await vote(-1)).data.entry.dislikes,1);assert.equal((await vote(0)).data.entry.dislikes,0);await vote(1);
 assert.equal((await vote(2)).status,400);assert.equal((await post(a,null,'entries/'+old.id+'/vote',{value:1})).status,401);
 const c=(await post(a,v,'entries/'+old.id+'/comments',{body:'有用的评论'})).data.comment;
 assert.equal((await put(a,u,'entries/'+old.id+'/comments/'+c.id,{version:1,body:'他人修改'})).status,403);
 assert.equal((await put(a,v,'entries/'+old.id+'/comments/'+c.id,{version:1,body:'自己补充'})).status,200);
 assert.equal((await put(a,v,'entries/'+old.id+'/comments/'+c.id,{version:1,body:'旧版'})).status,409);
 assert.equal((await a.call('/atlas/entries/'+old.id+'/comments/'+c.id+'/history')).data.history.length,2);
 assert.equal((await post(a,u,'entries/'+middle.id+'/feature',{version:1,featured:true,reason:'测试'})).status,403);
 assert.equal((await post(a,admin,'entries/'+middle.id+'/feature',{version:1,featured:true,reason:'参考价值'})).status,201);
 const hot=(await a.call('/atlas/entries?kind=guide&sort=hot')).data.entries;assert.equal(hot[0].id,old.id);assert.equal(hot[0].hot_score,3);assert.equal(hot.find(r=>r.id===middle.id).featured,true);
 assert.equal((await a.call('/atlas/entries?kind=guide&sort=time')).data.entries[0].id,latest.id);
 assert.equal((await a.call('/atlas/entries?kind=guide&sort=wrong')).status,400);
 assert.equal((await post(a,u,'entries/'+old.id+'/comments/'+c.id+'/moderate',{version:2,hidden:true,reason:'测试'})).status,403);
 assert.equal((await post(a,admin,'entries/'+old.id+'/comments/'+c.id+'/moderate',{version:2,hidden:true,reason:'测试'})).status,201);
 assert.equal((await a.call('/atlas/entries/'+old.id+'/comments')).data.comments.length,0);assert.equal((await a.call('/atlas/entries/'+old.id+'/comments/'+c.id+'/history')).status,404);
 assert.equal((await a.call('/atlas/entries?kind=guide&sort=hot')).data.entries.find(r=>r.id===old.id).hot_score,1);
 assert.equal((await post(a,admin,'entries/'+old.id+'/comments/'+c.id+'/moderate',{version:3,hidden:false,reason:'恢复'})).status,201);
 assert.equal((await post(a,admin,'entries/'+middle.id+'/feature',{version:2,featured:false,reason:'取消'})).status,201);
 assert.equal((await post(a,admin,'entries/'+old.id+'/moderate',{version:1,hidden:true,reason:'隐藏父分享'})).status,201);
 assert.equal((await a.call('/atlas/entries/'+old.id+'/comments')).status,404);assert.equal((await post(a,v,'entries/'+old.id+'/vote',{value:0})).status,404);
});
test('attachments, votes, featured and comment history survive consistent backup/restore with file hashes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guide-backup-')),dataDir=path.join(root,'live');fs.mkdirSync(dataDir);const a=await start(path.join(dataDir,'library.sqlite'),{dataDir});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});const u=await a.register('备份管理员');
 const file=await upload(a,u,'经验.md',md),r=await share(a,u,{body:'',attachments:[file.id]});await post(a,u,'entries/'+r.id+'/vote',{value:-1});await post(a,u,'entries/'+r.id+'/feature',{version:1,featured:true,reason:'精华测试'});await post(a,u,'entries/'+r.id+'/comments',{body:'评论原文'});
 const snapshot=await createBackup({dbPath:path.join(dataDir,'library.sqlite'),dataDir,backupRoot:path.join(root,'backups')});verifyBackup(snapshot.directory);const dest=path.join(root,'restored');restoreBackup(snapshot.directory,dest);const db=new DatabaseSync(path.join(dest,'library.sqlite'));
 try{for(const table of ['atlas_entries','atlas_history','atlas_share_files','atlas_share_votes','atlas_share_comments','atlas_share_comment_history'])assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),a.db.prepare('SELECT * FROM '+table).all());const filename=db.prepare('SELECT filename FROM atlas_share_files').get().filename;assert.equal(fs.readFileSync(path.join(dest,'guide-files',filename),'utf8'),md.toString())}finally{db.close()}
});
