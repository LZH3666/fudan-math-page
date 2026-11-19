import test from 'node:test';
import assert from 'node:assert/strict';
import {convertTex,normalizeMathSpaces} from '../tex-markdown.mjs';
import {diagramDocument} from '../isolated-diagram.mjs';
import {datedTitle} from '../layout-repair.mjs';
import {repairMarkdown} from '../pending-format.mjs';
import {parseLists} from '../banana-runtime/scripts/prebuild/lists.mjs';
test('prose repair leaves YAML and nested formula table cells intact',()=>{
 const head='---\nnumbering:\n  headings: false\n  equations: false\n---\n';
 const body='\\begin{tabular}{cc}a&$\\begin{cases}x&y\\\\z&t\\end{cases}$&c\\\\1&2&3\\end{tabular}';
 const out=repairMarkdown(head+body,[]);assert.ok(out.startsWith(head));assert.match(out,/tabular\}\{ccc\}/);assert.ok(out.includes('a&$\\begin{cases}x&y\\\\z&t\\end{cases}$&c\\\\1&2&3'));
});
test('TikZ path and node fixes retain coordinates, labels and arrow expressions',()=>{
 const source='```tikz\n\\begin{tikzpicture}\\draw (0,0)--(1,1)\n\\end{tikzpicture}\n```';
 assert.match(repairMarkdown(source,[]),/\\draw \(0,0\)--\(1,1\);/);
});
test('nested matrix arrow labels retain inner alignment while outer cells use a replacement token',()=>{
 const source='\\begin{tikzcd}A & B \\arrow["\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}"]\\end{tikzcd}';
 const out=repairMarkdown(source,[]);assert.match(out,/ampersand replacement=\\&/);assert.match(out,/A \\& B/);assert.match(out,/bmatrix\}a&b\\\\c&d/);
});
test('unknown term is omitted while known year and term are retained',()=>{
 assert.equal(datedTitle('2023期末'),'2023期末');
 assert.equal(datedTitle('2023春期末'),'2023春期末');
});
test('local math macros expand without leaking into the following environment',()=>{
 const r=convertTex('\\newcommand{\\foo}{x}\\begin{proof}\\renewcommand{\\foo}{y}$\\foo$\\end{proof}$\\foo$');
 assert.deepEqual(r.issues,[]);assert.deepEqual(r.math.map(x=>x.expanded),['y','x']);
});
test('list prelude macros apply across items and restore after the actual environment',()=>{
 const r=convertTex('\\newcommand{\\foo}{x}\\begin{enumerate}\\renewcommand{\\foo}{y}\\item $\\foo$\\item $\\foo$\\end{enumerate}$\\foo$');
 assert.deepEqual(r.issues,[]);assert.deepEqual(r.math.map(x=>x.expanded),['y','y','x']);
});
test('multi-paragraph mathematical footnote continuation remains indented',()=>{
 const source='正文[^fn1]\n\n[^fn1]: 第一段\n    \n    又见第二段 $x$。\n    \\[\n    x=y\n    \\]\n';
 assert.equal(repairMarkdown(source,[]),source);
 assert.deepEqual(parseLists(source).codeBlocks,[]);
});
test('split changes only its wrapper while preserving rows and tags',()=>{
 assert.equal(repairMarkdown('\\begin{split}a&=b\\\\c&=d\\end{split}\\tag{1.2}',[]),'\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\\tag{1.2}');
});
test('display mathematics in simple table cells uses inline displaystyle and retains all columns',()=>{
 const source='\\begin{tabular}{l l}\\[(a)\\begin{cases}x=a\\\\y=b\\end{cases}\\]&b&c&d\\end{tabular}';
 const out=repairMarkdown(source,[]);assert.match(out,/tabular\}\{l lcc\}/);assert.match(out,/\$\\displaystyle \(a\)\\begin\{cases\}/);assert.doesNotMatch(out,/\\\[/);assert.match(out,/&b&c&d/);
});
test('a final mathematical table row is terminated before its bottom rule',()=>{
 const source='\\begin{tabular}{cc}$H_2$ & $0$\n\\hline\n\\end{tabular}';
 assert.match(repairMarkdown(source,[]),/\$0\$\\\\\n\\hline/);
});
test('textual list symbols and numeric start preserve meaning and explicit labels',()=>{
 const r=convertTex('\\begin{enumerate}[13]\\item[14.] 项\\item 次项\\end{enumerate}\\bullet');
 assert.deepEqual(r.issues,[]);assert.match(r.markdown,/14\. 项/);assert.match(r.markdown,/13\. 次项/);assert.match(r.markdown,/\$\\bullet\$/);
});
test('named theorem wrappers retain their visible exercise caption',()=>{
 const r=convertTex('\\newtheorem*{namedthminner}{}\\newenvironment{namedthm}[1]{\\begin{namedthminner}[#1]}{\\end{namedthminner}}\\begin{namedthm}{练习1.1.1}原文\\end{namedthm}');
 assert.deepEqual(r.issues,[]);assert.match(r.markdown,/练习1\.1\.1/);assert.match(r.markdown,/原文/);
});
test('math escaped space does not turn into an incomplete backslash',()=>{
 const r=convertTex('$\\ $');assert.deepEqual(r.issues,[]);assert.match(r.markdown,/\\space/);assert.doesNotMatch(r.markdown,/\$\\\$/);
});
test('escaped spaces are tokenized without changing alignment row breaks',()=>{
 assert.equal(normalizeMathSpaces('a\\\\ \\hline b\\ c'),'a\\\\ \\hline b\\space{}c');
});
test('diagram template supplies end of proof mark and standard number sets',()=>{
 const tex=diagramDocument({tex:'\\R=\\mathbb{R}\\qedhere'});
 assert.match(tex,/\\providecommand\{\\qedhere\}\{\\quad\\square\}/);
 assert.match(tex,/\\providecommand\{\\R\}\{\\mathbb\{R\}\}/);
});
test('proof ending is supplied by the proof environment rather than duplicated in a diagram',()=>{
 const r=convertTex('\\begin{proof}$x=y\\qedhere$\\end{proof}');
 assert.deepEqual(r.issues,[]);assert.doesNotMatch(r.markdown,/qedhere|tikzpicture/);assert.equal(r.math[0].original,'x=y\\qedhere');
});
