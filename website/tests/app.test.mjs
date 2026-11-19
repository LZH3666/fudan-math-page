import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import katex from 'katex';
import {createApp} from '../server.mjs';
import {renderTex} from '../dist/tex.js';
import {start} from './helpers.mjs';
const content='\\section{连续性}\n正文保留所有空格。\n\\begin{theorem}[测试]\n若 $a=b$，则 $b=a$。\n\\end{theorem}\n\\begin{proof}显然。\\end{proof}\n';
test('TeX prose, local macros, theorem, proof, labels, math and nested lists',()=>{
 const tex='\\newcommand{\\R}{\\mathbb{R}}\n\\newtheorem{claim}{断言}\n'+content+'\\begin{claim}\\label{a}在 $\\R$ 上。\\end{claim}\n见 \\ref{a}。\n\\begin{enumerate}\\item 甲\\begin{itemize}\\item 内层\\end{itemize}\\item 乙\\end{enumerate}';
 const r=renderTex(tex,katex);assert.deepEqual(r.warnings,[]);assert.equal(r.headings[0].title,'连续性');assert.match(r.html,/class="katex"/);assert.match(r.html,/定理 1/);assert.match(r.html,/证明。/);assert.match(r.html,/<ol><li>.*<ul><li>内层/s);assert.match(r.html,/见 1/);
});
test('TeX comments, escaping, malformed input and unsupported commands are visible and safe',()=>{
 const r=renderTex('<script>alert(1)</script>\n保留 \\% % 注释\n\\input{secret}\n$x',katex);
 assert.match(r.html,/&lt;script&gt;/);assert.doesNotMatch(r.html,/<script|注释/);assert.match(r.html,/保留 %/);assert.ok(r.warnings.some(w=>w.includes('input')));assert.ok(r.warnings.some(w=>w.includes('未闭合')));
 const x=renderTex('$\\href{javascript:alert(1)}{click}$',katex);assert.doesNotMatch(x.html,/<a\b|onclick=|href="javascript:/);
});
test('equation and align environments render',()=>{
 const r=renderTex('\\begin{equation}a=b\\label{eq}\\end{equation}\n\\eqref{eq}\n\\begin{align*}a&=b\\\\c&=d\\end{align*}',katex);
 assert.deepEqual(r.warnings,[]);assert.match(r.html,/\(1\)/);assert.match(r.html,/katex-display/);
});
test('accounts, CRUD, anonymous reading, history, protection, conflicts and reversible course removal',async t=>{
 const a=await start();t.after(()=>a.close());
 assert.equal((await a.call('/state')).data.courses.length,26);
 const admin=await a.register('测试管理员'),editor=await a.register('测试编辑');
 assert.equal(admin.role,'admin');assert.equal(editor.role,'editor');
 assert.equal((await a.call('/courses',{method:'POST',body:{title:'x',subject:'analysis'}})).status,401);
 assert.equal((await a.call('/courses',{method:'POST',user:editor,csrf:'wrong',body:{title:'x',subject:'analysis'}})).status,403);
 assert.equal((await a.call('/courses',{method:'POST',user:editor,origin:'https://evil.invalid',body:{title:'x',subject:'analysis'}})).status,403);
 assert.equal((await a.call('/courses',{method:'POST',user:editor,body:null})).status,400);
 const cr=await a.call('/courses',{method:'POST',user:editor,body:{title:'测试课程',subject:'geometry'}});assert.equal(cr.status,201);const c=cr.data.course;
 let d=(await a.call('/courses/'+c.id+'/documents',{method:'POST',user:editor,body:{title:'第一节',tex:content,type:'notes',position:1}})).data.document;
 assert.equal(d.tex,content);
 const initial=(await a.call('/documents/'+d.id+'/history')).data.revisions[0];
 let saved=await a.call('/documents/'+d.id,{method:'PUT',user:editor,body:{...d,tex:content+'新稿',summary:'补充'}});assert.equal(saved.status,200);
 assert.equal((await a.call('/documents/'+d.id,{method:'PUT',user:editor,body:{...d,tex:'旧稿覆盖'}})).status,409);d=saved.data.document;
 assert.equal((await a.call('/documents/'+d.id)).data.document.tex,content+'新稿');
 assert.equal((await a.call('/search?q='+encodeURIComponent('新稿'))).data.documents[0].id,d.id);
 assert.equal((await a.call('/documents/'+d.id+'/protect',{method:'POST',user:editor,body:{version:d.version,protected:true}})).status,403);
 d=(await a.call('/documents/'+d.id+'/protect',{method:'POST',user:admin,body:{version:d.version,protected:true}})).data.document;
 assert.equal((await a.call('/documents/'+d.id,{method:'PUT',user:editor,body:d})).status,403);
 d=(await a.call('/documents/'+d.id+'/restore',{method:'POST',user:admin,body:{version:d.version,revisionId:initial.id}})).data.document;
 assert.equal(d.tex,content);assert.equal(d.version,4);
 d=(await a.call('/documents/'+d.id+'/protect',{method:'POST',user:admin,body:{version:d.version,protected:false}})).data.document;
 assert.equal((await a.call('/documents/'+d.id+'/comments',{method:'POST',user:editor,body:{body:'讨论测试'}})).status,201);
 assert.equal((await a.call('/documents/'+d.id+'/comments')).data.comments[0].body,'讨论测试');
 const archived=(await a.call('/courses/'+c.id+'/archive',{method:'POST',user:editor,body:{version:c.version}})).data.course;
 assert.ok(!(await a.call('/state')).data.courses.some(x=>x.id===c.id));
 assert.equal((await a.call('/documents/'+d.id,{method:'PUT',user:editor,body:d})).status,409);
 assert.equal((await a.call('/courses/'+c.id+'/restore',{method:'POST',user:editor,body:{version:archived.version}})).status,200);
 assert.equal((await a.call('/documents/'+d.id)).data.document.tex,content);
 assert.equal((await a.call('/courses/'+c.id+'/history')).data.history.length,3);
 const login=await a.call('/auth/login',{method:'POST',body:{username:'测试编辑',password:'test-only-password-123'}});assert.equal(login.status,200);
 assert.equal((await a.call('/auth/logout',{method:'POST',user:editor})).status,200);
 assert.equal((await a.call('/state',{user:editor})).data.user,null);
});
test('a delayed request cannot overwrite a revision saved while its body was still arriving',async t=>{
 const a=await start();t.after(()=>a.close());const u=await a.register('并发测试');
 const d=(await a.call('/courses/topology/documents',{method:'POST',user:u,body:{title:'并发',tex:'原稿',type:'notes',position:0}})).data.document;
 const payload=JSON.stringify({...d,tex:'迟到旧稿'});
 let resolve;const finished=new Promise(r=>resolve=r);
 const req=http.request(a.base+'/api/documents/'+d.id,{method:'PUT',headers:{Origin:a.base,Cookie:u.cookie,'X-CSRF-Token':u.csrf,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
 req.write(payload.slice(0,10));await new Promise(r=>setTimeout(r,40));
 assert.equal((await a.call('/documents/'+d.id,{method:'PUT',user:u,body:{...d,tex:'已保存新稿'}})).status,200);
 req.end(payload.slice(10));assert.equal(await finished,409);
 assert.equal((await a.call('/documents/'+d.id)).data.document.tex,'已保存新稿');
});
test('disk database persists accounts, course edits and exact TeX across restart',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-library-test-')),dbPath=path.join(folder,'test.sqlite');
 let a=await start(dbPath),u=await a.register('持久化测试');
 const d=(await a.call('/courses/topology/documents',{method:'POST',user:u,body:{title:'保存测试',tex:content,type:'exams',position:0}})).data.document;
 await a.close();a=await start(dbPath);
 try{assert.equal((await a.call('/documents/'+d.id)).data.document.tex,content);assert.equal((await a.call('/documents/'+d.id+'/history')).data.revisions.length,1);assert.equal((await a.call('/state',{user:u})).data.user.username,'持久化测试')}finally{await a.close();for(const name of ['test.sqlite','test.sqlite-wal','test.sqlite-shm']){const f=path.join(folder,name);if(fs.existsSync(f))fs.unlinkSync(f)}fs.rmSync(folder,{recursive:true,force:true})}
});


test('align rows, following equations and references share a single numbering sequence',()=>{
 const r=renderTex('\\begin{align}a&=b\\label{a}\\\\c&=d\\label{b}\\end{align}\\begin{equation}e=f\\label{c}\\end{equation} REF_A=\\eqref{a}; REF_B=\\eqref{b}; REF_C=\\eqref{c}',katex);
 assert.deepEqual(r.warnings,[]);
 assert.match(r.html,/REF_A=\(1\); REF_B=\(2\); REF_C=\(3\)/);
 assert.equal((r.html.match(/class ="mml-eqn-num"/g)||[]).length,3);
 for(const n of [1,2,3]){assert.ok(r.html.includes('\\tag{'+n+'}'));assert.ok(r.html.includes('>'+n+'</span>'))}
 const suppressed=renderTex('\\begin{align}x&=1\\notag\\\\y&=2\\label{y}\\end{align}\\eqref{y}',katex);
 assert.deepEqual(suppressed.warnings,[]);assert.ok(suppressed.html.endsWith('(1)'));
 const nested=renderTex('\\begin{align}A&=\\begin{pmatrix}1\\\\2\\end{pmatrix}\\label{A}\\\\b&=0\\label{b}\\end{align}\\eqref{b}',katex);
 assert.deepEqual(nested.warnings,[]);assert.ok(nested.html.endsWith('(2)'));
});

test('professional and university math subjects, course home, nested user pages and recoverable removal',async t=>{
 const a=await start();t.after(()=>a.close());const admin=await a.register('板块管理员'),editor=await a.register('页面编辑');
 const state=(await a.call('/state')).data;
 assert.deepEqual(state.subjects.map(s=>s.title),['分析与微分方程','代数','几何','拓扑','代数几何','数论与表示论','概率与统计','数学物理','应用数学','计算数学','运筹学与控制论','试题荟萃','大学数学']);
 assert.equal(state.courses.find(c=>c.id==='topology').subject,'topology');
 assert.equal(state.courses.find(c=>c.id==='numerical').subject,'computational');
 assert.equal((await a.call('/subjects',{method:'POST',user:editor,body:{title:'无权板块',position:11}})).status,403);
 assert.equal((await a.call('/subjects',{method:'POST',user:admin,body:{title:'自建板块',position:11}})).status,201);
 let s=(await a.call('/state')).data.subjects.find(s=>s.title==='自建板块');
 assert.equal((await a.call('/subjects/'+s.id,{method:'PATCH',user:admin,body:{...s,title:'改名板块',position:-1}})).status,200);
 assert.equal((await a.call('/subjects/'+s.id,{method:'PATCH',user:admin,body:{...s,title:'过期名称'}})).status,409);
 s=(await a.call('/state')).data.subjects.find(x=>x.id===s.id);
 assert.equal((await a.call('/subjects/'+s.id+'/archive',{method:'POST',user:admin,body:{version:s.version}})).status,200);
 assert.equal((await a.call('/subjects/'+s.id+'/restore',{method:'POST',user:admin,body:{version:s.version+1}})).status,200);
 const {course:c,home,documents}= (await a.call('/courses/topology')).data;
 assert.equal(documents.length,0);assert.equal(home.tex,'');assert.equal(home.version,0);
 const h=(await a.call('/documents/'+home.id,{method:'PUT',user:editor,body:{...home,tex:'自己编辑的课程主页'}})).data.document;
 assert.equal(h.version,1);assert.equal((await a.call('/documents/'+home.id+'/history')).data.revisions.length,1);
 const first=(await a.call('/courses/'+c.id+'/documents',{method:'POST',user:editor,body:{title:'自由命名的页面',tex:'正文',position:0,parent_id:home.id}})).data.document;
 const nested=(await a.call('/courses/'+c.id+'/documents',{method:'POST',user:editor,body:{title:'嵌套子页',tex:'嵌套正文',position:0,parent_id:first.id}})).data.document;
 assert.equal((await a.call('/documents/'+first.id,{method:'PUT',user:editor,body:{...first,parent_id:nested.id}})).status,400);
 assert.equal((await a.call('/courses/topology/documents',{method:'POST',user:editor,body:{title:'跨课程',tex:'',position:0,parent_id:(await a.call('/courses/linear')).data.home.id}})).status,400);
 assert.equal((await a.call('/documents/'+first.id+'/archive',{method:'POST',user:editor,body:{version:1}})).status,200);
 assert.equal((await a.call('/courses/topology')).data.documents.length,0);
 assert.equal((await a.call('/documents/'+nested.id,{method:'PUT',user:editor,body:{...nested,tex:'不允许隐藏时改写'}})).status,409);
 assert.equal((await a.call('/documents/'+first.id+'/restore-page',{method:'POST',user:editor,body:{version:2}})).status,200);
 assert.equal((await a.call('/courses/topology')).data.documents.length,2);
 assert.equal((await a.call('/subjects/topology/archive',{method:'POST',user:admin,body:{version:1}})).status,409);
});
test('links and image commands produce safe HTML',()=>{
 const r=renderTex('\\href{https://example.org/a}{外部链接}\\url{https://example.org}\\href{\\#/doc/abc}{内部页面}\\includegraphics[width=0.6\\textwidth]{/media/'+'a'.repeat(64)+'.png}',katex);
 assert.deepEqual(r.warnings,[]);assert.match(r.html,/href="#\/doc\/abc"/);assert.match(r.html,/rel="noopener noreferrer"/);assert.match(r.html,/width:60%/);
 const bad=renderTex('\\href{javascript:alert(1)}{X}\\includegraphics{file:///secret}',katex);assert.equal(bad.warnings.length,2);assert.doesNotMatch(bad.html,/<img|href=/);
});
test('image upload persists public immutable asset and rejects active file types',async t=>{
 const a=await start();t.after(()=>a.close());const u=await a.register('图片测试');
 const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F9sAAAAASUVORK5CYII=';
 const upload=await a.call('/assets',{method:'POST',user:u,body:{data}});assert.equal(upload.status,201);
 const response=await fetch(a.base+upload.data.url);assert.equal(response.headers.get('content-type'),'image/png');assert.equal((await response.arrayBuffer()).byteLength,Buffer.from(data,'base64').length);
 assert.equal((await a.call('/assets',{method:'POST',body:{data}})).status,401);
 assert.equal((await a.call('/assets',{method:'POST',user:u,body:{data:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}})).status,400);
});

import {DatabaseSync} from 'node:sqlite';
import {migratePages} from '../model.mjs';

test('legacy course materials and revisions migrate unchanged and migration is idempotent',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE courses(id TEXT PRIMARY KEY,title TEXT NOT NULL,subject TEXT NOT NULL,position INTEGER DEFAULT 0,archived INTEGER DEFAULT 0,version INTEGER DEFAULT 1); CREATE TABLE documents(id TEXT PRIMARY KEY,course_id TEXT,type TEXT,title TEXT,tex TEXT,version INTEGER,position INTEGER,protected INTEGER DEFAULT 0,archived INTEGER DEFAULT 0,updated TEXT); CREATE TABLE revisions(id INTEGER PRIMARY KEY,document_id TEXT,version INTEGER,title TEXT,tex TEXT,type TEXT,position INTEGER,user_id TEXT,summary TEXT,created TEXT);");
  db.prepare('INSERT INTO users VALUES(?)').run('original-user');
  db.prepare('INSERT INTO courses(id,title,subject) VALUES(?,?,?)').run('topology','拓扑学','geometry');
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-page','topology','exams','原有试卷',content,7,3,1,0,'original-time');
  db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(15,'old-page',7,'原有试卷',content,'exams',3,'original-user','原有说明','original-time');
  migratePages(db);
  const c=db.prepare('SELECT * FROM courses').get(),d=db.prepare("SELECT * FROM documents WHERE id='old-page'").get(),r=db.prepare('SELECT * FROM revisions').get();
  assert.equal(c.subject,'topology');assert.equal(d.parent_id,c.home_id);assert.equal(d.tex,content);assert.equal(d.protected,1);assert.equal(d.version,7);
  assert.equal(r.id,15);assert.equal(r.tex,content);assert.equal(r.user_id,'original-user');assert.equal(r.parent_id,c.home_id);
  const home=db.prepare('SELECT * FROM documents WHERE id=?').get(c.home_id);assert.equal(home.tex,'');assert.equal(home.version,0);
  migratePages(db);assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,2);assert.equal(db.prepare('SELECT home_id FROM courses').get().home_id,c.home_id);
 }finally{db.close()}
});



test('PDF attachment upload, anonymous retrieval, TeX embed and unsafe paths',async t=>{
 const a=await start();t.after(()=>a.close());const u=await a.register('附件测试');
 const bytes=Buffer.from('%PDF-1.5\nunit-test\n%%EOF');
 const upload=await a.call('/assets',{method:'POST',user:u,body:{data:bytes.toString('base64')}});assert.equal(upload.status,201);
 const response=await fetch(a.base+upload.data.url);assert.equal(response.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 const rendered=renderTex('\\includepdf[pages=-]{'+upload.data.url+'}',katex);assert.deepEqual(rendered.warnings,[]);assert.ok(rendered.html.includes('data-pdf="'+upload.data.url+'"'));
 for(const bad of ['https://example.com/exam.pdf','file:///secret.pdf','/media/../private.pdf','javascript:alert(1)']){const r=renderTex('\\includepdf{'+bad+'}',katex);assert.equal(r.warnings.length,1);assert.doesNotMatch(r.html,/data-pdf=/)}
 assert.equal((await a.call('/assets',{method:'POST',body:{data:bytes.toString('base64')}})).status,401);
 assert.equal((await a.call('/assets',{method:'POST',user:u,body:{data:Buffer.from('%PDF-1.5 incomplete').toString('base64')}})).status,400);
 assert.equal((await a.call('/assets',{method:'POST',user:u,body:{data:Buffer.alloc(5*1024*1024+1).toString('base64')}})).status,413);
});
