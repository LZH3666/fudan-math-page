import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {equationAnchorIds,presentationHTML,readingHTML} from '../reader-layout.mjs';import {rewriteGroupLinks} from '../banana-book-renderer.mjs';import {start} from './helpers.mjs';
import {hideExamContents} from '../dist/catalog.mjs';
test('selected lecture contents can start collapsed without losing navigation',()=>{
 const source='<html><head></head><body><aside class="toc-shell"><details class="toc-disclosure" open=""><summary>目录</summary><nav><a href="#one">One</a></nav></details></aside><h2 id="one">One</h2></body></html>';
 const out=readingHTML(source,{collapseContents:true});
 assert.match(out,/<details class="toc-disclosure">/);
 assert.match(out,/<a href="#one">One<\/a>/);
 assert.match(out,/\.toc-shell \.toc-disclosure>summary\{display:flex\}/);
 assert.match(readingHTML(source),/<details class="toc-disclosure" open="">/);
 assert.equal(readingHTML(out,{collapseContents:true}),out);
});
test('only recognized exams outside the mathematics college hide the generated contents',()=>{
 const exam={id:'collected-123abc',title:'2022年第一学期',parent_id:'root'},notes={id:'notes',title:'讲义'},paper={id:'p',title:'2023年',parent_id:'exams'},parent={id:'exams',title:'历年试卷'};
 assert.equal(hideExamContents({subject:'economics'},exam,[exam]),true);
 assert.equal(hideExamContents({subject:'algebra'},exam,[exam]),false);
 assert.equal(hideExamContents({subject:'economics'},notes,[notes]),false);
 assert.equal(hideExamContents({subject:'cs'},paper,[paper,parent]),true);
 assert.equal(hideExamContents({subject:'unknown'},paper,[paper,parent]),false);
 const html='<html><head></head><body><aside class="collection-sidebar">侧栏</aside><aside class="toc-shell">目录</aside><h2>第一题</h2></body></html>';
 const styled=readingHTML(html,{hideExamContents:true});assert.match(styled,/\.toc-shell\{display:none!important\}/);assert.match(styled,/<aside class="collection-sidebar">侧栏/);assert.match(styled,/<h2>第一题/);assert.equal(readingHTML(styled,{hideExamContents:true}),styled);assert.doesNotMatch(readingHTML(html),/fudan-hide-exam-contents/);
});
test('reading layer preserves body, explicit numbering, links and mathematics',()=>{
 const body='<article><ol start="7"><li value="10"><p>题目 $x=y$</p></li></ol><p>A. 选项</p><a href="#original">引用</a><div class="footnotes"><ol><li>脚注</li></ol></div></article>',html='<html><head></head><body>'+body+'</body></html>',styled=readingHTML(html);
 assert.equal(styled.slice(styled.indexOf('<body>')),html.slice(html.indexOf('<body>')));assert.equal(readingHTML(styled),styled);assert.match(styled,/fudan-reader-layout/);
});
test('parent reading hides only the embedded collection directory and pagination',()=>{
 const html='<html><head></head><body><aside class="collection-sidebar"><a href="/child">桌面旧目录</a></aside><article><nav class="collection-children"><p class="collection-tree-title">章节目录</p><a href="/child">子页面</a></nav><nav class="collection-pagination"><a rel="prev" href="/prev">上一页</a><a rel="next" href="/next">下一页</a></nav><p>正文保留</p></article></body></html>';
 const parent=readingHTML(html,{parentPage:true}),leaf=readingHTML(html);
 assert.match(parent,/fudan-parent-navigation/);assert.match(parent,/\.collection-children,\.collection-pagination,\.collection-sidebar\{display:none!important\}/);
 assert.match(parent,/章节目录/);assert.match(parent,/上一页/);assert.match(parent,/下一页/);assert.match(parent,/正文保留/);
 assert.doesNotMatch(leaf,/fudan-parent-navigation/);assert.equal(readingHTML(parent,{parentPage:true}),parent);
});
test('cached directory titles omit missing semesters and name the specified midterm',()=>{
 const html='<html><head></head><body><a href="/doc/year"><span class="directory-item-title">2023（学期未注明）</span></a><a rel="next" href="/doc/year"><span>下一页</span>2024（学期未标注）</a><a href="/?mdDoc=layout-exam-f02c2ffca5463fa675f057a186361e73"><span class="collection-item-title">广义相对论(PHYS60019)</span></a><p>原文（学期未注明）</p></body></html>';
 const styled=readingHTML(html);assert.match(styled,/>2023<\/span>/);assert.match(styled,/广义相对论期中\(PHYS60019\)/);assert.match(styled,/<p>原文（学期未注明）<\/p>/);assert.equal(readingHTML(styled),styled);
});
test('reading layer collapses repeated leading section numbers and keeps references regular-weight',()=>{
 const html='<html><head></head><body><article><a class="toc-item directory-item"><span class="toc-item-title directory-item-title">2.1 2.1 标题</span></a><h3 id="21-21-title"><a class="heading-link" href="#21-21-title">§</a>2.1 2.1 标题</h3><h3><a>§</a>2.1 2.2 正常标题</h3><p>正文 2.1 2.1 保持原样</p><div class="bibliography"><li><strong>Conway</strong> (1990).</li></div></article></body></html>';
 const styled=readingHTML(html);assert.match(styled,/<span class="toc-item-title directory-item-title">2\.1 标题<\/span>/);assert.match(styled,/<h3 id="21-21-title"><a class="heading-link" href="#21-21-title">§<\/a>2\.1 标题<\/h3>/);assert.match(styled,/2\.1 2\.2 正常标题/);assert.match(styled,/<p>正文 2\.1 2\.1 保持原样<\/p>/);assert.match(styled,/\.bibliography strong \{ font-weight: 400 !important; \}/);assert.equal(readingHTML(styled),styled);
 assert.match(styled,/border-left: 2px solid #00a090/);assert.match(styled,/max-width: 138rem/);
});
test('explicit Chinese section numbering suppresses matching generated counters only',()=>{
 const h='<html><head></head><body><a><span class="toc-section-number directory-number">1</span> <span class="toc-item-title">一、辨析题</span></a><h2><a class="heading-link">§</a><span class="section-number">1</span> 一、辨析题</h2><h2><a>§</a><span class="section-number">2</span> 三、不同编号</h2></body></html>';
 const x=readingHTML(h);assert.doesNotMatch(x,/toc-section-number/);assert.match(x,/<span class="toc-item-title">一、辨析题/);assert.match(x,/<\/a> 一、辨析题/);assert.match(x,/<span class="section-number">2<\/span> 三、不同编号/);assert.equal(readingHTML(x),x);
});
test('collected exam covers omit blank identity fields but preserve course, date and essential instructions',()=>{
 const h='<html><head></head><body><article><header><a class="title-link" href="/?mdDoc=collected-123abc">考试</a></header><aside>目录</aside><p>复旦大学经济学院</p><p>2022～2023学年第一学期</p><p>A卷（共2页）</p><p>课程名称：政治经济学课程代码：SOSC123</p><p>开课院系：经济学院考试形式：开卷</p><p>姓名：学号：专业：</p><p>重要：任选10题，常数 $c=1$。</p><aside class="toc-shell">目录</aside><h2>一、辨析题</h2><p>姓名：这是题目正文</p></article></body></html>';
 const x=readingHTML(h);assert.doesNotMatch(x,/SOSC123|姓名：学号|开课院系|A卷（共2页）/);assert.match(x,/<p>政治经济学<\/p>/);assert.match(x,/2022～2023学年第一学期/);assert.match(x,/重要：任选10题，常数 \$c=1\$/);assert.match(x,/姓名：这是题目正文/);assert.equal(readingHTML(x),x);
 assert.match(readingHTML(h.replace('mdDoc=collected-123abc','mdDoc=ordinary-page')),/姓名：学号：专业/);
 const mixed=h.replace('<aside class="toc-shell">目录</aside>', '<p>姓名：这是题目正文</p><p>考试形式：开卷，答题时必须写出推导过程</p><p>提示：请同学们秉持诚信，答题时必须写出推导过程。</p><p>课程名称：政治经济学课程代码：SOSC123，允许使用计算器。</p><aside class="toc-shell">目录</aside>');
 const safe=readingHTML(mixed);assert.match(safe,/<p>姓名：这是题目正文<\/p>/);assert.match(safe,/考试形式：开卷，答题时必须写出推导过程/);assert.match(safe,/提示：请同学们秉持诚信，答题时必须写出推导过程/);assert.match(safe,/SOSC123，允许使用计算器/);
});
test('proof boxes suppress only a terminal QED marker while preserving other squares',()=>{
 const qed='<span class="math-rendered" data-tex="\\square" data-display="false"><span class="katex">□</span></span>';
 const html='<article><div class="theorem-block theorem-remark environment-remark"><p class="theorem-title">证明</p><div class="theorem-content"><p>中间计算 '+qed+'，保留。</p><p>结论。'+qed+'</p></div></div><div class="theorem-block theorem-proof"><p class="theorem-title">证明</p><div class="theorem-content"><p>'+qed+'</p></div></div><div class="theorem-block theorem-remark"><p class="theorem-title">备注</p><div class="theorem-content"><p>'+qed+'</p></div></div></article>';
 const rendered=presentationHTML(html);
 assert.match(rendered,/<p>中间计算 <span class="math-rendered" data-tex="\\square"[^>]*>.*?，保留。<\/p><p>结论。<\/p>/);
 assert.match(rendered,/<div class="theorem-block theorem-proof"><p class="theorem-title">证明<\/p><div class="theorem-content"><\/div><\/div>/);
 assert.match(rendered,/<p><span class="math-rendered" data-tex="\\square"[^>]*>/);
 assert.equal(presentationHTML(rendered),rendered);
});
test('solution and answer boxes suppress only their terminal QED marker',()=>{
 const qed='<span class="math-rendered" data-tex="\\square"><span class="katex">□</span></span>';
 const block=(title,text)=>'<div class="theorem-block theorem-remark"><p class="theorem-title">'+title+'</p><div class="theorem-content"><p>'+text+qed+'</p></div></div>';
 const html='<article>'+block('解答','解答结论。')+block('答案','答案结论。')+block('解','解结论。')+block('Solution','Solution conclusion. ')+block('Answer','Answer conclusion. ')+block('提示','提示里的方框 ')+block('备注','备注里的方框 ')+'</article>';
 const rendered=presentationHTML(html);
 for(const [title,text] of [['解答','解答结论。'],['答案','答案结论。'],['解','解结论。'],['Solution','Solution conclusion. '],['Answer','Answer conclusion. ']])assert.ok(rendered.includes('<p class="theorem-title">'+title+'</p><div class="theorem-content"><p>'+text+'</p></div>'));
 assert.ok(rendered.includes('<p class="theorem-title">提示</p><div class="theorem-content"><p>提示里的方框 '+qed+'</p></div>'));
 assert.ok(rendered.includes('<p class="theorem-title">备注</p><div class="theorem-content"><p>备注里的方框 '+qed+'</p></div>'));
 assert.equal(rendered.split(qed).length-1,2);
 assert.equal(presentationHTML(rendered),rendered);
});

test('nested theorem blocks keep QED scoped to their own proof boundary',()=>{
 const qed='<span class="math-rendered" data-tex="\\square"><span class="katex">□</span></span>';
 const html='<article><div class="theorem-block theorem-proof"><p class="theorem-title">证明</p><div class="theorem-content"><p>外层推理。</p><div class="theorem-block theorem-remark"><p class="theorem-title">备注</p><div class="theorem-content"><p>备注中的方框 '+qed+'</p></div></div></div></div><div class="theorem-block theorem-proof"><p class="theorem-title">证明</p><div class="theorem-content"><p>嵌套前置。</p><div class="theorem-block theorem-proof"><p class="theorem-title">证明</p><div class="theorem-content"><p>内层结论。'+qed+'</p></div></div></div></div><p>后续页面内容必须完整。</p></article>';
 const rendered=presentationHTML(html);
 assert.match(rendered,/备注中的方框 <span class="math-rendered" data-tex="\\square"/);
 assert.match(rendered,/内层结论。<\/p><\/div><\/div><\/div><\/div><p>后续页面内容必须完整。<\/p>/);
 assert.equal((rendered.match(/data-tex="\\square"/g)||[]).length,1);
 assert.equal(presentationHTML(rendered),rendered);
});
test('ordinary prose quotes convert while code and rendered mathematics remain unchanged',()=>{
 const html="<article><p>``实分析'' 与 ``泛函分析''</p><pre>``code''</pre><code>``inline''</code><span class=\"katex\">``math''</span></article>";
 const styled=presentationHTML(html);assert.match(styled,/<p>“实分析” 与 “泛函分析”<\/p>/);assert.match(styled,/<pre>``code''<\/pre>/);assert.match(styled,/<code>``inline''<\/code>/);assert.match(styled,/<span class="katex">``math''<\/span>/);
});
test('smart-punctuation quote pairs normalize to Chinese double quotes',()=>{
 const html='<article><p>``二元域’‘ 与 &rsquo;&lsquo;，&lsquo;&lsquo;开引号&rsquo;&lsquo;</p><p>&#8216;&#8216;开引号&#8217;&#8216; 与 &#39;&#39;闭引号</p><pre>’‘ &rsquo;&lsquo;</pre><span class="math-rendered">’‘</span></article>';
 const styled=presentationHTML(html);assert.match(styled,/<p>“二元域” 与 ”，“开引号”<\/p>/);assert.match(styled,/<p>“开引号” 与 ”闭引号<\/p>/);assert.match(styled,/<pre>’‘ &rsquo;&lsquo;<\/pre>/);assert.match(styled,/<span class="math-rendered">’‘<\/span>/);
});
test('formula-number jumps are removed while literature, page, and website links stay navigable',()=>{
 const id='l-equation-1',html='<article><p><span id="'+id+'"></span></p><span class="math-rendered math-display" data-tex="x=1" data-display="true"></span><p>方程 <a href="/?mdDoc=chapter&amp;mdAnchor='+id+'#/doc/chapter" target="_parent">(1)</a>，<a href="#bib:book">文献</a>。</p><p><span id="heading"></span></p><p>标题。</p><a href="/?mdDoc=chapter&amp;mdAnchor=heading#/doc/chapter">标题链接</a><a href="https://example.org/book">网站</a><div class="theorem-proof"><div class="theorem-content"><p>证明结论。</p></div></div></article>';
 assert.deepEqual([...equationAnchorIds(html)],[id]);const styled=presentationHTML(html),reading=readingHTML('<html><head></head><body>'+styled+'</body></html>');assert.match(styled,/>方程 \(1\)，<a href="#bib:book">文献<\/a>/);assert.doesNotMatch(styled,/mdAnchor=l-equation-1/);assert.match(styled,/mdAnchor=heading/);assert.match(styled,/href="https:\/\/example\.org\/book"/);assert.match(reading,/\.theorem-proof \.theorem-content > :last-child::after[^}]*content: none !important/);
  const routes=new Map([['/markdown/bundle/books/group/equations/','equations'],['/markdown/bundle/books/group/foreign/','foreign'],['/markdown/bundle/books/group/references/','references']]),formulaAnchorsByPage=new Map([['equations',new Set([id])],['foreign',new Set(['l-foreign-equation'])]]);const grouped=rewriteGroupLinks('<p><a href="/markdown/bundle/books/group/equations/#'+id+'">(1)</a> <a href="/markdown/bundle/books/group/foreign/#l-foreign-equation">(2)</a> <a href="/markdown/bundle/books/group/references/#bib">[1]</a> <a href="https://example.org">网站</a></p>',routes,formulaAnchorsByPage,{id:'course',key:'bundle',pageId:'equations'});assert.doesNotMatch(grouped,/books\/group\/equations/);assert.ok(grouped.includes('href="/?mdDoc=foreign&amp;mdAnchor=l-foreign-equation#/doc/foreign"'));assert.ok(grouped.includes('href="/?mdDoc=references&amp;mdAnchor=bib#/doc/references"'));assert.match(grouped,/https:\/\/example\.org" target="_parent"/);
});
test('endnotes render beside their reference without jump or back links',()=>{
 const html='<article><p>方程个数<a href="#fn:1" id="fnref:1" class="footnote-ref" role="doc-noteref"><sup>1</sup></a>将少于未知数。</p><div class="footnotes" role="doc-endnotes"><hr><ol><li id="fn:1"><p>这里方程个数将少于未知数个数.&nbsp;<a href="#fnref:1" class="footnote-backref" role="doc-backlink">↩︎</a></p><p>这是第二段注释。</p></li></ol></div></article>';
 const styled=presentationHTML(html);assert.match(styled,/<p>方程个数<span class="inline-footnote" role="note">（注：这里方程个数将少于未知数个数\.<br><br>这是第二段注释。\）<\/span>将少于未知数。<\/p>/);assert.doesNotMatch(styled,/footnotes|footnote-ref|footnote-backref|#fn:/);const note=styled.match(/<span class="inline-footnote" role="note">([\s\S]*?)<\/span>/)?.[1]??'';assert.doesNotMatch(note,/<\/?p\b/);
});
test('embedded GET and HEAD apply live layout without modifying immutable artifacts',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-layout-')),key='a'.repeat(64),dir=path.join(root,'markdown',key,'public','books','page');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'index.html'),html='<html><head></head><body><article><ol start="5"><li>问题</li></ol><p>A. 选项</p></article></body></html>';fs.writeFileSync(file,html);
 const app=await start(':memory:',{dataDir:root});t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true})});
 const url=app.base+'/markdown/'+key+'/books/page/';const original=await fetch(url);assert.equal(await original.text(),html);assert.match(original.headers.get('cache-control'),/immutable/);
 const styled=await fetch(url+'?readerLayout=1');assert.equal(styled.status,200);const bytes=Buffer.from(await styled.arrayBuffer());assert.equal(bytes.toString(),readingHTML(html));assert.equal(Number(styled.headers.get('content-length')),bytes.length);assert.equal(styled.headers.get('cache-control'),'no-cache');assert.match(styled.headers.get('content-security-policy'),/script-src 'none'/);
 const parent=await fetch(url+'?readerLayout=1&parentPage=1');assert.equal(parent.status,200);assert.equal(await parent.text(),readingHTML(html,{parentPage:true}));
 const exam=await fetch(url+'?readerLayout=1&hideExamContents=1');assert.equal(await exam.text(),readingHTML(html,{hideExamContents:true}));
 const head=await fetch(url+'?readerLayout=1',{method:'HEAD'});assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal(await head.text(),'');assert.equal(fs.readFileSync(file,'utf8'),html);
});
