import test from 'node:test';
import assert from 'node:assert/strict';
import {subquestionLabels} from '../markdown-compat.mjs';
import {readerCSS} from '../reader-layout.mjs';
test('subquestions retain explicit ordinals and separate from escaped main question',()=>{
 const source='2\\. 1) First\n\n2) Second\n\n3\\. Main\n\n1) Third';
 assert.equal(subquestionLabels(source),'2\\. \n\n(1) First\n\n(2) Second\n\n3\\. Main\n\n(1) Third');
 assert.equal(subquestionLabels(subquestionLabels(source)),subquestionLabels(source));
 assert.equal(subquestionLabels('6. 1) first\n2) second\n1. 1\\) third\n2\\) fourth'),'6. \n\n(1) first\n(2) second\n1. \n\n(1) third\n(2) fourth');
});
test('math, code, ordinary lists and footnotes are preserved',()=>{
 const source='1. Main\n\n\\[\n1) math\n\\]\n\n```text\n1) code\n```\n\n    1) indented code\n\n[^a]: footnote\n';
 assert.equal(subquestionLabels(source),source);
 assert.match(readerCSS,/@counter-style fudan-subquestion/);
 assert.match(readerCSS,/ol ol:not\(\.footnotes ol\)/);
});
