import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {start} from './helpers.mjs';import {validateMarkdown} from '../banana-markdown.mjs';import {createBackup,verifyBackup,restoreBackup} from '../backup.mjs';
test('official Markdown save/read/failure/history and backup restore',async()=>{
 const root=path.resolve('data/markdown-integration-'+Date.now());fs.mkdirSync(root,{recursive:true});
 const a=await start(path.join(root,'library.sqlite'),{dataDir:root});
 try{const u=await a.register('Markdown验收'),c=(await a.call('/courses/calculus')).data.course;
 const pdf=Buffer.from('%PDF-1.5\nunit-test\n%%EOF');const attachment=await a.call('/assets',{method:'POST',user:u,body:{data:pdf.toString('base64')}});assert.equal(attachment.status,201);
 const source='## 定义\n\n::: definition [群] {@def:group}\n原文 $G$。\n:::\n\n由 @def:group。\n<!-- 隐藏注释 -->\n\n[PDF]('+attachment.data.url+')';
 const save=await a.call('/courses/'+c.id+'/documents',{method:'POST',user:u,body:{title:'格式验收',tex:source,preamble:'',position:1,parent_id:c.home_id,render_mode:'markdown'}});assert.equal(save.status,201,JSON.stringify(save.data));const d=save.data.document;assert.equal(d.tex,source);assert.equal(d.render_mode,'markdown');
 const response=await fetch(a.base+'/markdown/'+d.artifact+'/books/page/');assert.equal(response.status,200);const html=await response.text();assert.match(html,/katex/);assert.match(html,/原文/);assert.match(html,/environment/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 assert.ok(html.includes('href="'+attachment.data.url+'"'));const downloaded=await fetch(a.base+attachment.data.url);assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
 const bad=await a.call('/documents/'+d.id,{method:'PUT',user:u,body:{...d,tex:'```tikz\n\\begin{tikzpicture}\n```'}});assert.equal(bad.status,422);assert.equal((await a.call('/documents/'+d.id)).data.document.version,d.version);
 const edit=await a.call('/documents/'+d.id,{method:'PUT',user:u,body:{...d,tex:source+'\n\n第二版。'}});assert.equal(edit.status,200,JSON.stringify(edit.data));
 const history=(await a.call('/documents/'+d.id+'/history')).data.revisions;
 const restore=await a.call('/documents/'+d.id+'/restore',{method:'POST',user:u,body:{version:edit.data.document.version,revisionId:history.find(r=>r.version===d.version).id}});assert.equal(restore.status,200,JSON.stringify(restore.data));assert.equal(restore.data.document.tex,source);assert.equal(restore.data.document.artifact,d.artifact);
 const backup=await createBackup({dbPath:path.join(root,'library.sqlite'),dataDir:root,backupRoot:path.join(root,'backups')});assert.ok(verifyBackup(backup.directory));const restored=path.join(root,'restored');restoreBackup(backup.directory,restored);assert.ok(fs.existsSync(path.join(restored,'markdown',d.artifact,'.complete')));
 console.log(JSON.stringify({root,document:d.id,artifact:d.artifact,backup:backup.directory,sourceUnchanged:true}));
 }finally{await a.close()}
});
test('active content and arbitrary TeX macros refused',()=>{for(const s of ['<script>alert(1)</script>','\\input{/etc/passwd}','\\newcommand{\\x}{1}'])assert.throws(()=>validateMarkdown(s));});
test('editing a page resolves the other chapter and retains its immutable revision',async()=>{
 const root=path.resolve('data/markdown-cross-edit-'+Date.now());const a=await start(path.join(root,'library.sqlite'),{dataDir:root});
 try{const u=await a.register('互引验收'),c=(await a.call('/courses/calculus')).data.course;
 const create=async(title,tex)=>(await a.call('/courses/'+c.id+'/documents',{method:'POST',user:u,body:{title,tex,preamble:'',position:1,parent_id:c.home_id,render_mode:'markdown'}}));
 const first=await create('第一章','::: theorem [原定理] {@cross:target}\n原文 $x$。\n:::');assert.equal(first.status,201,JSON.stringify(first.data));
 const second=await create('第二章','第二章原文。');assert.equal(second.status,201);const d=second.data.document;
 const preview=await a.call('/preview',{method:'POST',user:u,body:{document_id:d.id,title:d.title,tex:d.tex+'\n\n由 [原定理](@cross:target)。',render_mode:'markdown',preamble:''}});assert.equal(preview.status,200,JSON.stringify(preview.data));
 const updated=await a.call('/documents/'+d.id,{method:'PUT',user:u,body:{...d,tex:d.tex+'\n\n由 [原定理](@cross:target)。'}});assert.equal(updated.status,200,JSON.stringify(updated.data));
 const unchanged=(await a.call('/documents/'+first.data.document.id)).data.document;assert.equal(unchanged.version,first.data.document.version);assert.equal(unchanged.tex,first.data.document.tex);assert.equal(unchanged.artifact,first.data.document.artifact);
 const html=await(await fetch(a.base+'/markdown/'+updated.data.document.artifact+'/books/page/')).text();assert.match(html,/cross(?:%3A|:)target/);assert.match(html,/原定理/);assert.match(html,/target="_parent"/);assert.ok(html.includes('mdDoc='+first.data.document.id));
 const b=await createBackup({dbPath:path.join(root,'library.sqlite'),dataDir:root,backupRoot:path.join(root,'backups')});assert.ok(verifyBackup(b.directory));const restored=path.join(root,'restored');restoreBackup(b.directory,restored);const ref=JSON.parse(fs.readFileSync(path.join(restored,'markdown',updated.data.document.artifact,'bundle-ref.json')));assert.ok(fs.existsSync(path.join(restored,'markdown',ref.bundle,'bundle.json')));
 }finally{await a.close()}
});
