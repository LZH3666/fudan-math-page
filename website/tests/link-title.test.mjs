import test from 'node:test';import assert from 'node:assert/strict';import {citationLinks,titleSpacing} from '../markdown-compat.mjs';import {convertTex} from '../tex-markdown.mjs';import {transformMarkup} from '../banana-runtime/scripts/prebuild/markup.mjs';import {datedTitle} from '../layout-repair.mjs';
test('citation brackets stay visible while the target becomes a complete Markdown link',()=>{
 const source='See [[Lee13]](#l-123) and [[A]](@bib:A).';const fixed=citationLinks(source);
 assert.equal(fixed,'See [&#91;Lee13&#93;](#l-123) and [&#91;A&#93;](@bib:A).');
 assert.equal(transformMarkup(fixed),fixed);assert.equal(citationLinks(fixed),fixed);
 const converted=convertTex('\\cite{Lee13}',{labels:new Map([['bib:Lee13',{number:'Lee13',anchor:true}]])});assert.equal(converted.markdown,'[&#91;Lee13&#93;](@bib:Lee13)');
});
test('real wiki links, mathematics and literal code remain untouched',()=>{
 const source='[[课程]]\n\n$[[A]](#x)$\n\n```text\n[[A]](#x)\n```\n\n    [[B]](#y)';assert.equal(citationLinks(source),source);
});
test('title spacing is plain text and heading repair leaves formula spacing intact',()=>{
 assert.equal(titleSpacing('2024秋\\quad 经典物理选讲\\quad 期末试卷'),'2024秋 经典物理选讲 期末试卷');
 assert.equal(datedTitle('2024秋\\quad 经典物理选讲\\qquad 期末试卷'),'2024秋 经典物理选讲 期末试卷');
 assert.equal(citationLinks('## 2024秋\\quad 试卷\n\n$x\\quad y$'),'## 2024秋 试卷\n\n$x\\quad y$');
 assert.equal(citationLinks('## `x\\quad y`\n\n$x\\quad y$'),'## `x\\quad y`\n\n$x\\quad y$');
 assert.equal(titleSpacing('原题名  两个空格'),'原题名  两个空格');
 assert.equal(titleSpacing('题名\\quad `x  y`'),'题名 `x  y`');
});
