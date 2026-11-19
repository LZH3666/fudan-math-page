import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {legacyDocument,legacyMarker} from '../dist/legacy-format.js';
import {buildDocument} from '../dist/latex-source.js';
import {prepareJob} from '../isolated-compiler.mjs';
import {jobKey} from '../compile-protocol.mjs';
import {analysisCourse,importAnalysis} from '../legacy-import.mjs';
import {start} from './helpers.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');

test('legacy bridge preserves mathematical subscripts, powers, alignments and adjacent inline delimiters',()=>{
 const source=String.raw`正文 & $a_1^2=$$b_2^3$。
$$\sum_{n=1}^{\infty} a_n^2=0$$
\begin{align*}x_i^2&=y_j^3\\z_k&=w_k\end{align*}`;
 const converted=legacyDocument(source);
 assert.match(converted,/正文 \\& \$a_1\^2=\$\$b_2\^3\$/);
 assert.ok(converted.includes(String.raw`\begin{equation*}\sum_{n=1}^{\infty} a_n^2=0\end{equation*}`));
 assert.ok(converted.includes(String.raw`x_i^2&=y_j^3\\z_k&=w_k`));
 assert.equal(buildDocument(source,'').includes('FudanLegacySource'),false);
 assert.equal(buildDocument('\\documentclass{article}\n'+source,legacyMarker),'\\documentclass{article}\n'+source);
});

test('table columns exclude nested cases; ambiguous missing mathematical row breaks remain errors',()=>{
 const cell=String.raw`\[\begin{cases}x=t^2&\\y=t^3\end{cases}\]`;
 const converted=legacyDocument(String.raw`\begin{tabular}{l l}`+[cell,cell,cell,cell].join('&')+String.raw`\end{tabular}`);
 assert.ok(converted.includes('\\begin{tabular}{l lcc}'));
 assert.ok(converted.includes(String.raw`$\displaystyle \begin{cases}x=t^2&\\y=t^3\end{cases}$`));
 const missing=String.raw`\begin{cases}1-x &, x \in [0,1)
0 &, x=1.\end{cases}`;
 assert.ok(legacyDocument(missing).includes(missing));
 const emptyColumn=String.raw`\begin{cases}0,& &x\in[0,1],\\1,& &x\in(1,2].\end{cases}`;
 assert.ok(legacyDocument(emptyColumn).includes(String.raw`\left\{\begin{array}{lll}0,& &x\in[0,1],\\1,& &x\in(1,2].\end{array}\right.`));
});

test('ordinary source path stays unchanged; English labels, wiki headings and CJK line breaks work',()=>{
 const normal=buildDocument('普通 $x_1^2$。');assert.ok(normal.includes('普通 $x_1^2$。'));assert.ok(!normal.includes('fontawesome5'));
 const legacy=legacyDocument(String.raw`\english
== Heading ==
Text\\
[literal note]
\begin{theorem}A.\end{theorem}`);
 assert.ok(legacy.includes('\\newtheorem{theorem}[legacytheorem]{Theorem}'));
 assert.ok(legacy.includes('\\section{Heading}'));
 assert.ok(legacy.includes('Text\\leavevmode\\\\\\relax{}\n[literal note]'));
});

test('actual formal power series brackets stay mathematical and old chapter links expand spacing commands',()=>{
 const source=String.raw`$\F_q[[x]]$ \(\F_q[[x]]\) \[\F_q[[x]]\] $$\F_q[[x]]$$
\begin{equation}\F_q[[x]]\end{equation}
见[[User:Solution/\qquad 习题: 楼分析/曲线积分与曲面积分|第十一章]]。`;
 const result=legacyDocument(source);assert.equal((result.match(/\\F_q\[\[x\]\]/g)||[]).length,5);
 assert.equal((result.match(/\\href\{/g)||[]).length,1);
 const url=result.match(/\\href\{([^}]+)\}/)[1].replaceAll('\\%','%');
 assert.equal(decodeURIComponent(url),'https://bananaspace.org/legacy/wiki/用户:Solution/ 习题: 楼分析/曲线积分与曲面积分');
 assert.ok(result.includes('}{第十一章}'));
});

test('default and custom theorem environments share the legacy counter; only overwide tables shrink',()=>{
 const result=legacyDocument(String.raw`\newtheorem{quiza}{A}
\section{调和函数}\begin{definition}\label{d}D.\end{definition}
\begin{proposition}\label{p}P.\end{proposition}
\begin{quiza}Q.\end{quiza}见\ref{d}和\ref{p}。
\begin{tabular}{ll}A&B\end{tabular}`);
 assert.ok(result.includes('\\newtheorem{definition}[legacytheorem]{定义}'));
 assert.ok(result.includes('\\newtheorem{proposition}[legacytheorem]{命题}'));
 assert.ok(result.includes('\\newtheorem{quiza}[legacytheorem]{A}'));
 assert.ok(result.includes('\\par\\noindent\\begin{adjustbox}{max width=\\linewidth}\\begin{tabular}{ll}A&B\\end{tabular}\\end{adjustbox}\\par'));
 assert.ok(result.includes('见\\ref{d}和\\ref{p}'));
});

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fudan-legacy-')),sourceDir=path.join(root,'source'),dataDir=path.join(root,'data'),runtime='sha256:'+'a'.repeat(64);
 for(const relative of ['raw','rehearsal/assets','rehearsal/compiled'])fs.mkdirSync(path.join(sourceDir,relative),{recursive:true});
 const a=await start(':memory:',{dataDir});t.after(async()=>{await a.close();fs.rmSync(root,{recursive:true,force:true})});
 const admin=await a.register('导入维护测试');
 const records=[{title:'用户:Solution/ 试卷: 现代偏微分方程',text:'试卷: 现代偏微分方程',group:'偏微分方程',href:'/legacy/wiki/PDE',source:'原文 $x_1^2$\n'},{title:'用户:Solution/ 习题: 数学分析 (DK)',text:'习题: 数学分析 (DK)',group:'数学分析',href:'/legacy/wiki/DK',source:'\\begin{structure}\\subpage{1}\\end{structure}'},{title:'用户:Solution/ 习题: 数学分析 (DK)/Week 13',text:'Week 13',group:'数学分析',parentTitle:'用户:Solution/ 习题: 数学分析 (DK)',href:'/legacy/wiki/DK/13',source:'保持缺失换行的原文'}].map(r=>({...r,hash:hash(r.source)}));
 const results=records.map((r,i)=>{
  fs.writeFileSync(path.join(sourceDir,'raw',r.hash+'.tex'),r.source);
  const preamble=legacyMarker+'\n';
  if(i===2)return {title:r.title,sourceHash:r.hash,preamble,ok:false,error:'Missing row break'};
  const artifact=jobKey(prepareJob(r.source,preamble,path.join(sourceDir,'rehearsal/assets')),runtime);
  fs.writeFileSync(path.join(sourceDir,'rehearsal/compiled',artifact+'.pdf'),'%PDF-1.7\nfixture');
  fs.writeFileSync(path.join(sourceDir,'rehearsal/compiled',artifact+'.json'),JSON.stringify({key:artifact,runtime}));
  return {title:r.title,sourceHash:r.hash,preamble,ok:true,artifact};
 });
 return {a,options:{db:a.db,records,results,sourceDir,dataDir,runtime,actorId:admin.id}};
}

test('maintenance import preserves accounts and unrelated content, separates course names, nests pages and retains raw source',async t=>{
 const {a,options}=await fixture(t),users=a.db.prepare('SELECT * FROM users').all(),unrelated=a.db.prepare("SELECT * FROM courses WHERE subject<>'analysis'").all();
 const result=importAnalysis(options);assert.equal(result.pages.length,3);assert.equal(result.pending.length,1);
 assert.deepEqual(a.db.prepare('SELECT * FROM users').all(),users);assert.deepEqual(a.db.prepare("SELECT * FROM courses WHERE subject<>'analysis'").all(),unrelated);
 assert.ok(result.archived.some(c=>c.title==='偏微分方程'));assert.ok(result.courses.includes('现代偏微分方程'));assert.ok(result.courses.includes('数学分析 (DK)'));
 for(const p of result.pages){const out=await a.call('/documents/'+p.id);assert.equal(out.status,200);assert.equal(hash(out.data.document.tex),out.data.document.source.source_hash);assert.equal(out.data.document.source.license,'CC BY-SA 4.0')}
 const child=a.db.prepare('SELECT * FROM documents WHERE id=?').get(result.pages[2].id);assert.equal(child.parent_id,result.pages[1].id);assert.equal(child.artifact,'');assert.equal(child.render_mode,'latex');
 const count=a.db.prepare('SELECT count(*) n FROM revisions').get().n;
 const repeated=importAnalysis(options);assert.ok(repeated.pages.every(p=>p.skipped));assert.equal(a.db.prepare('SELECT count(*) n FROM revisions').get().n,count);
 assert.equal(a.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('import rejects changed originals and stale compile artifacts before publishing',async t=>{
 const {a,options}=await fixture(t),before=a.db.prepare('SELECT count(*) n FROM documents').get().n;
 const changed=structuredClone(options.records);changed[0].source+='changed';
 assert.throws(()=>importAnalysis({...options,records:changed}),/Original source mismatch/);
 const stale=structuredClone(options.results);stale[0].artifact='b'.repeat(64);
 assert.throws(()=>importAnalysis({...options,results:stale}),/Stale compile result/);
 assert.equal(a.db.prepare('SELECT count(*) n FROM documents').get().n,before);
});

test('distinct PDE courses are never grouped into the generic PDE course',()=>{
 for(const title of ['现代偏微分方程','二阶椭圆型方程','非线性发展方程','应用偏微分方程','微局部分析'])assert.equal(analysisCourse({text:'试卷: '+title,group:'偏微分方程'}),title);
 assert.equal(analysisCourse({text:'笔记: 变分法与 PDE',group:'偏微分方程'}),'变分法与 PDE');
 assert.throws(()=>analysisCourse({text:'未知课程',group:'偏微分方程'}),/Unclassified/);
});
