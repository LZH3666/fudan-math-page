import test from 'node:test';
import assert from 'node:assert/strict';
import {remarks,formatSource,formatExamSource,splitExams,hierarchyPlan,datedTitle,digest} from '../layout-repair.mjs';
test('remark conversion preserves nested mathematics and rejects truncation',()=>{
 assert.equal(remarks('a{{comment|x $\\frac{1}{a_{n}}$ and \\{q\\}}}z'),'a\\begin{remark}\nx $\\frac{1}{a_{n}}$ and \\{q\\}\n\\end{remark}z');
 assert.throws(()=>remarks('{{comment|unfinished'));
});
test('only generated article titles lose numbering; mathematical sections remain',()=>{
 const s='\\documentclass{ctexbook}\n\\begin{document}\n\\section{Article}\n\\noindent\\bsurl{https://source}\\par\\medskip\n\\section{Mathematics}\n\\newtheorem{t}{T}\n\\end{document}';
 const out=formatSource(s);assert.match(out,/\\section\*\{Article\}/);assert.match(out,/\\section\{Mathematics\}/);assert.doesNotMatch(out,/bsurl\{https/);
});
test('exam boundaries preserve complete body slices and ignore nested year subtitles',()=>{
 const tex='intro\n\\section{2024秋期末}\nONE\\frac{1}{2}\n\\subsection*{2024秋 A卷分析}\nTWO\n\\section{2023期末}\nTHREE';
 const result=splitExams({id:'x',title:'试卷: X',tex,preamble:''});assert.equal(result.children.length,2);assert.match(result.children[0].tex,/TWO/);assert.equal(result.children[1].title,'2023期末');
 for(const c of result.children)assert.equal(c.slice.hash,digest(tex.slice(c.slice.start,c.slice.end)));
});
test('dates retain uncertainty and distinguish duplicate exams',()=>{
 assert.equal(datedTitle('25--26春期末'),'2025–2026春期末');
 assert.equal(datedTitle('2025 Semester 1'),'2025 Semester 1');
 const r=splitExams({id:'x',title:'试卷:X',tex:'== 2025期末 ==\na\n== 2025期末 ==\nb',preamble:''});assert.match(r.children[1].title,/第2份/);
});
test('standalone exam examples and internal headings do not have artificial section zero',()=>{
 const out=formatExamSource('\\documentclass{ctexbook}\n\\newtheorem{example}{例}[section]\n\\begin{document}\n\\subsection{分析篇}\n\\begin{example}x\\end{example}');
 assert.match(out,/\\newtheorem\{example\}\{例\}\n/);assert.match(out,/\\section\{分析篇\}/);assert.doesNotMatch(out,/\[section\]/);
});
test('merged references retain globally disabled section counter behavior',()=>{
 const part='\\section{Part}\n\\noindent\\bsurl{url}\\par\\medskip\n\\begingroup\\let\\newcommand\\bsnewcommand\n\\endgroup\n';
 const out=formatSource('\\documentclass{ctexbook}\n\\begin{document}\n\\setcounter{section}{17}\n\\setcounter{secnumdepth}{0}\n'+part+part);
 assert.equal((out.match(/\\ifnum\\value\{secnumdepth\}>0\\stepcounter\{section\}\\fi/g)||[]).length,2);assert.match(out,/\\setcounter\{section\}\{17\}/);
});
test('source hierarchy creates real child pages and course II is independent',()=>{
 const c={id:'c',title:'抽象代数',subject:'algebra',home_id:'h',position:0},docs=[{id:'a',course_id:'c',title:'习题: 抽象代数',parent_id:'h'},{id:'b',course_id:'c',title:'习题: 抽象代数/环论',parent_id:'h'},{id:'e',course_id:'c',title:'试卷: 抽象代数II',parent_id:'h'}];
 const sources=docs.map(d=>({document_id:d.id,url:'https://x/wiki/用户:Solution/_'+encodeURIComponent(d.title)}));
 const r=hierarchyPlan({courses:[c],docs,sources});assert.equal(r.docs.find(d=>d.id==='b').parent_id,'a');assert.equal(r.docs.find(d=>d.id==='b').title,'环论');assert.equal(r.newCourses[0].title,'抽象代数 II');assert.notEqual(r.docs.find(d=>d.id==='e').course_id,'c');
});
