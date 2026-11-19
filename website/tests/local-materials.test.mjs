import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {subjectFor,splitCourse,hash} from '../local-materials.mjs';
import {importLocalMaterials} from '../local-import.mjs';
import {prepareJob} from '../isolated-compiler.mjs';
import {jobKey} from '../compile-protocol.mjs';
import {start} from './helpers.mjs';
test('maintenance import validates artifacts, preserves prior content, records history and is idempotent',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-import-')),sourceDir=path.join(root,'source'),dataDir=path.join(root,'data');fs.mkdirSync(dataDir);
 for(const dir of ['original','rehearsal/assets','rehearsal/compiled'])fs.mkdirSync(path.join(sourceDir,dir),{recursive:true});
 const a=await start(path.join(dataDir,'library.sqlite'),{dataDir});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});
 const admin=await a.register('导入测试'),before=a.db.prepare('SELECT * FROM documents').all();
 const original='original file',source='\\documentclass{article}\n\\begin{document}body\\end{document}',runtime='sha256:'+'a'.repeat(64),id='local-page-test';
 fs.writeFileSync(path.join(sourceDir,'original','test.tex'),original);
 const artifact=jobKey(prepareJob(source,'',path.join(sourceDir,'rehearsal','assets')),runtime);
 fs.writeFileSync(path.join(sourceDir,'rehearsal','compiled',artifact+'.pdf'),'%PDF-1.7\n%%EOF');fs.writeFileSync(path.join(sourceDir,'rehearsal','compiled',artifact+'.json'),JSON.stringify({key:artifact,runtime,dependencies:[]}));
 const courses=[{file:'test.tex',course:'测试代数',subject:'algebra',originalHash:hash(original),assets:[],pages:[{id,title:'章节',source,hash:hash(source),raw:source,rawHash:hash(source),url:'https://bananaspace.org/legacy/wiki/test',index:0}]}];
 const results=[{id,artifact,ok:true,sourceHash:hash(source),runtime}],options={db:a.db,courses,results,sourceDir,dataDir,runtime,actorId:admin.id};
 assert.throws(()=>importLocalMaterials({...options,results:[]}),/compilation required/);assert.equal(a.db.prepare('SELECT count(*) n FROM documents').get().n,before.length);
 const out=importLocalMaterials(options);assert.equal(out.pages.length,1);for(const d of before)assert.deepEqual(a.db.prepare('SELECT * FROM documents WHERE id=?').get(d.id),d);
 assert.equal(a.db.prepare('SELECT count(*) n FROM revisions WHERE document_id=?').get(id).n,1);
 a.db.prepare('UPDATE documents SET tex=?,version=2 WHERE id=?').run('subsequent edit',id);
 assert.ok(importLocalMaterials(options).pages[0].skipped);assert.equal(a.db.prepare('SELECT tex FROM documents WHERE id=?').get(id).tex,'subsequent edit');
});
test('explicit control/computation routing leaves other applied subjects in applied mathematics',()=>{
 for(const course of ['数学控制论','最优化方法','线性与非线性规划'])assert.equal(subjectFor({group:'应用',course}),'optimization-control');
 for(const course of ['数值代数与优化','科学计算'])assert.equal(subjectFor({group:'应用',course}),'computational');
 for(const course of ['随机矩阵理论','金融中的随机分析','深度学习'])assert.equal(subjectFor({group:'应用',course}),'applied');
 assert.equal(subjectFor({group:'代数'}),'algebra');assert.equal(subjectFor({group:'数论和表示论'}),'number-representation');
});
test('cross-article references remain within one editable document with preceding numbering state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-xrefs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const article=(title,body)=>'\\section{'+title+'}\n\\noindent\\bsurl{https://bananaspace.org/legacy/wiki/'+title+'}\\par\\medskip\n\\begingroup\\let\\newcommand\\bsnewcommand\n'+body+'\n\\endgroup\n';
 const prior=article('prior','\\setcounter{section}{17}\n\\nosectionnumbers'),one=article('one','See \\ref{target}.'),two=article('two','\\label{target}Target.');
 fs.writeFileSync(path.join(root,'test.tex'),'\\documentclass{ctexbook}\n\\title{test}\n\\begin{document}\n'+prior+one+two+'\\end{document}\n');
 const out=splitCourse(root,{file:'test.tex',group:'代数',course:'代数',articles:3});assert.equal(out.pages.length,2);assert.equal(out.pages[1].raw,one+two);assert.equal(out.pages[1].sourceArticles.length,2);assert.deepEqual(out.pages[1].numberingContext,{section:17,depth:0});assert.ok(out.pages[1].source.includes('\\setcounter{section}{17}\n\\setcounter{secnumdepth}{0}'));
});
test('split uses source markers rather than internal section headings and preserves raw article text',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-materials-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const raw='\\section{讲义}\n\\noindent\\bsurl{https://bananaspace.org/legacy/wiki/test}\\par\\medskip\n\\begingroup\\let\\newcommand\\bsnewcommand\n\\section{内部章节}\n$x_1^2$\n\\endgroup\n';
 const original='\\documentclass{ctexbook}\n\\title{test}\n\\begin{document}\n'+raw+'\\end{document}\n';fs.writeFileSync(path.join(root,'test.tex'),original);
 const out=splitCourse(root,{file:'test.tex',group:'代数',course:'代数',articles:1});assert.equal(out.pages.length,1);assert.equal(out.pages[0].raw,raw);assert.equal(out.pages[0].rawHash,hash(raw));assert.ok(out.pages[0].source.startsWith('% FudanEngine: xelatex\n'));assert.equal(out.originalHash,hash(original));
 assert.throws(()=>splitCourse(root,{file:'test.tex',group:'代数',course:'代数',articles:2}),/count mismatch/);
 assert.throws(()=>splitCourse(root,{file:'../test.tex',group:'代数',articles:1}),/escapes/);
});
