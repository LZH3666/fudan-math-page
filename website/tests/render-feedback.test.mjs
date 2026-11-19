import test from 'node:test';import assert from 'node:assert/strict';
import {convertTex} from '../tex-markdown.mjs';import {repairMarkdown} from '../pending-format.mjs';import {parseLists} from '../banana-runtime/scripts/prebuild/lists.mjs';
test('CR comments and CRLF do not shift a fenced code block into subsequent mathematics',()=>{
 for(const newline of ['\n','\r\n']){
  const source=['<!-- 原注释\r-->','','```tikz','x=y','```','','正文 $h_*=g_*^{-1}$。','\\[x=y\\]'].join(newline);
  const blocks=parseLists(source).codeBlocks;assert.equal(blocks.length,1);
  assert.ok(source.slice(...blocks[0]).includes('```tikz'));assert.ok(blocks[0][1]<=source.indexOf('正文'));
 }
});
test('explicit itemize question and option labels remain exact while actual bullets stay bullets',()=>{
 const source='\\begin{itemize}\\item[一、] 填空题\\begin{itemize}\\item[(1)] 设 $E/F$。\\item[(2)] 公式\\[x=y\\]\\begin{itemize}\\item[(a)] 选项A\\item[(b)] 选项B\\end{itemize}\\end{itemize}\\item 普通圆点\\end{itemize}';
 const r=convertTex(source);assert.deepEqual(r.issues,[]);assert.equal(r.spans.map(s=>s.original).join(''),source);
 assert.match(r.markdown,/一、 填空题/);assert.match(r.markdown,/　\(1\) 设/);assert.match(r.markdown,/　　\(a\) 选项A/);assert.match(r.markdown,/- 普通圆点/);
 assert.doesNotMatch(r.markdown,/- 填空题|- 设/);assert.equal(parseLists(r.markdown).codeBlocks.length,0);
 assert.match(repairMarkdown(r.markdown,[]),/　\(1\)/);
});
test('empty and mathematical labels do not fabricate numbers or truncate bracket notation',()=>{
 const r=convertTex('\\begin{itemize}\\item[] 无标记\\item[$[x]$] 数学标记\\end{itemize}');
 assert.deepEqual(r.issues,[]);assert.match(r.markdown,/\$\[x\]\$ 数学标记/);assert.doesNotMatch(r.markdown,/1\. 无标记/);
});
test('explicit nonconsecutive numeric item labels cannot be renumbered by Markdown',()=>{
 const r=convertTex('\\begin{itemize}\\item[1.] one\\item[3.] three\\item[5)] five\\end{itemize}');
 assert.match(r.markdown,/1\\\. one/);assert.match(r.markdown,/3\\\. three/);assert.match(r.markdown,/5\\\) five/);
});
test('long mathematical footnotes are analyzed as prose with inline and tagged matrix formulas',()=>{
 const r=convertTex('正文\\footnote{flat metric\\begin{equation}\\eta=\\begin{pmatrix}1&0\\\\0&-1\\end{pmatrix}\\end{equation}while $g_{\\mu\\nu}$ describes the metric.}');
 assert.deepEqual(r.issues,[]);assert.equal(parseLists(r.markdown).codeBlocks.length,0);assert.match(r.markdown,/\\tag\{1\}/);
});
test('TeX prose indentation is removed before generated list layout and interword spaces survive',()=>{
 const r=convertTex('\\begin{itemize}\\item outer\\begin{itemize}\\item inner $x$ is a variable.\n\tnew paragraph\\end{itemize}\\end{itemize}');
 assert.match(r.markdown,/\$x\$ is a variable/);assert.equal(parseLists(r.markdown).codeBlocks.length,0);
 const md=repairMarkdown(r.markdown,[],{preserveListLayout:true});assert.match(md,/\n  - inner/);
});
