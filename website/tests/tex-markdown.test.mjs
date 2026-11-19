import {test} from 'node:test';
import assert from 'node:assert/strict';
import {convertTex,expandMath,alignmentRows} from '../tex-markdown.mjs';
test('source coverage and visible remark versus hidden source comment',()=>{
 const source='% hidden\n\\newtheorem*{comment}{注}\n\\begin{comment}原注 $x$。\\end{comment}';
 const result=convertTex(source);assert.deepEqual(result.issues,[]);assert.equal(result.spans.map(s=>s.original).join(''),source);assert.match(result.markdown,/<!-- hidden-->/);assert.match(result.markdown,/::: -remark \[注\]/);assert.match(result.markdown,/原注/);
});
test('macro substitution retains TeX control word boundaries',()=>{
 const macros=new Map([['f',{count:1,body:'\\mathbb#1'}],['R',{count:0,body:'\\mathbb{R}'}]]);
 assert.equal(expandMath('\\f{R}',macros),'\\mathbb R');assert.equal(expandMath('\\R x',macros),'\\mathbb{R} x');
});
test('equation rows retain independent tags and labels',()=>{
 const result=convertTex('\\begin{align}a&=b\\label{first}\\\\c&=d\\label{second}\\end{align}');assert.deepEqual(result.issues,[]);assert.equal(new Map(result.labels).get('first').number,'1');assert.equal(new Map(result.labels).get('second').number,'2');assert.match(result.markdown,/\\tag\{1\}/);assert.match(result.markdown,/\\tag\{2\}/);assert.equal(alignmentRows('a\\\\\\begin{matrix}b\\\\c\\end{matrix}').length,2);
});
test('unresolved original labels are not approved',()=>{assert.equal(convertTex('见 \\ref{missing}').eligible,false)});
test('setcounter uses the declared theorem counter and original chapter context',()=>{
 assert.match(convertTex('\\newtheorem{thm}{定理}\\setcounter{thm}{4}\\begin{thm}正文\\end{thm}').markdown,/定理 5/);
 const r=convertTex('\\newtheorem{definition}{定义}[section]\\section{群的表示}\\begin{definition}原文\\end{definition}',{numberPrefix:'1.',context:{section:17,headingNumbered:false}});assert.deepEqual(r.issues,[]);assert.match(r.markdown,/定义 1\.17\.1/);assert.doesNotMatch(r.markdown,/## 18 /);
});
test('custom environments with visible start or end cannot be silently approved',()=>{
 const r=convertTex('\\newenvironment{note}{\\textbf{注意}必须保留的开头}{必须保留的结尾}\\begin{note}正文\\end{note}');assert.equal(r.eligible,false);assert.match(r.markdown,/必须保留的开头/);assert.match(r.markdown,/必须保留的结尾/);
});
test('original roman, alphabetic and resumed question numbers are retained',()=>{
 const source='\\begin{enumerate}[label=(\\roman*)]\\item 一\\item 二\\begin{enumerate}[label=(\\alph*)]\\item 子题\\end{enumerate}\\end{enumerate}';const r=convertTex(source);assert.deepEqual(r.issues,[]);assert.match(r.markdown,/\(i\) 一/);assert.match(r.markdown,/\(ii\) 二/);assert.match(r.markdown,/\(a\) 子题/);
 const resumed=convertTex('\\begin{enumerate}\\setcounter{enumi}{4}\\item 第五题\\label{five}\\end{enumerate}');assert.deepEqual(resumed.issues,[]);assert.match(resumed.markdown,/5\. 第五题/);assert.equal(new Map(resumed.labels).get('five').number,'5');
});
test('Wiki headings and links after prose retain text and mathematical subscripts',()=>{
 const r=convertTex('前文。\n== 环 $R$ ==\n见 [[用户:Solution|资料]]，填写 ______，公式 $x_1$。',{links:new Map([['用户:Solution','/#/doc/source']])});assert.deepEqual(r.issues,[]);assert.match(r.markdown,/## 1 环 \$R\$/);assert.match(r.markdown,/\[资料\]\(\/#\/doc\/source\)/);assert.match(r.markdown,/\\_\\_\\_\\_\\_\\_/);assert.match(r.markdown,/\$x_1\$/);
});
test('explicit enumitem reference labels retain parentheses, as in native TeX',()=>{
 const r=convertTex('\\begin{enumerate}[label=(\\roman*)]\\item\\label{parent}父题\\begin{enumerate}[label=(\\alph*)]\\item\\label{child}子题\\end{enumerate}\\end{enumerate}见 \\ref{parent} 与 \\ref{child}。');assert.deepEqual(r.issues,[]);const labels=new Map(r.labels);assert.equal(labels.get('parent').number,'(i)');assert.equal(labels.get('child').number,'(a)');assert.match(r.markdown,/\[\(i\)\]/);
});
test('zero section counters and the existing chapter equation prefix are preserved',()=>{
 const r=convertTex('\\newtheorem{thm}{定理}[section]\\begin{thm}原文\\end{thm}\\begin{equation}x=y\\end{equation}',{defaultEquationPrefix:'1.'});assert.match(r.markdown,/定理 0\.1/);assert.match(r.markdown,/\\tag\{1\.1\}/);
});
test('math source comments neither close formulas nor expose their text',()=>{
 const r=convertTex('$x % 不显示 $ 与 \\foo\n+y$');assert.deepEqual(r.issues,[]);assert.doesNotMatch(r.markdown,/不显示/);assert.match(r.markdown,/\+y/);assert.equal(r.spans.map(x=>x.original).join(''),'$x % 不显示 $ 与 \\foo\n+y$');
});
test('emphasis adjoining formula delimiters has valid Markdown boundaries',()=>{
 const r=convertTex('记域上的\\textbf{$n$维仿射空间}即\\emph{空间$x$}。');
 assert.deepEqual(r.issues,[]);assert.match(r.markdown,/上的 \*\*\$n\$维仿射空间\*\* 即/);assert.match(r.markdown,/即 \*空间\$x\$\* 。/);
 assert.equal(r.spans.map(x=>x.original).join(''),'记域上的\\textbf{$n$维仿射空间}即\\emph{空间$x$}。');
 assert.match(convertTex('用\\textbf{注：}本题').markdown,/用 \*\*注：\*\* 本题/);
});
