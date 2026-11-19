import test from 'node:test';import assert from 'node:assert/strict';import {migrateBibliography,bibliographyKey} from '../bibliography-migration.mjs';import {transformDocument} from '../banana-runtime/scripts/prebuild/structure.mjs';
test('native bibliography and citation groups preserve old anchors and explicit locator text',()=>{
 const anchor='l-'+'a'.repeat(24),token='<!-- FudanAnchor:'+anchor+' -->',body='John M. Lee. *Introduction to Smooth Manifolds*. Springer, 2013.',source='See [[Lee13]](#'+anchor+'), Proposition 7.14.\n\nLee13 '+token+' '+body+'\n\n';
 const entry={anchor,body,lineStart:source.indexOf('Lee13 '+token),end:source.length-2,fields:{type:'book',author:'John M. Lee',title:'Introduction to Smooth Manifolds',year:2013,publisher:'Springer'}},r=migrateBibliography(source,[entry],new Map([[anchor,entry]]));
 assert.equal(r.citations,1);assert.match(r.markdown,/```bibliography/);assert.ok(r.markdown.includes('[@'+bibliographyKey(anchor)+']'));assert.ok(r.markdown.includes(token));assert.ok(r.markdown.includes('Proposition 7.14'));
 const transformed=transformDocument(r.markdown);assert.ok(JSON.stringify(transformed).includes('Lee'));assert.ok(!JSON.stringify(transformed).includes('[[Lee13]]'));assert.doesNotMatch(transformed,/\*\*/);
 assert.throws(()=>migrateBibliography(source.replace('Springer','changed by editor'),[entry],new Map([[anchor,entry]])),/binding mismatch/);
});
test('bibliography target rewriting leaves mathematics, wiki syntax, and code examples unchanged',()=>{
 const anchor='l-'+'b'.repeat(24),source='[[课程]]\n\n$[[A]](#'+anchor+')$\n\n```text\n[[A]](#'+anchor+')\n```\n\n[定理7.14](#'+anchor+')';const result=migrateBibliography(source,[],new Map([[anchor,{}]]));assert.equal(result.citations,1);assert.ok(result.markdown.endsWith('[定理7.14](@'+bibliographyKey(anchor)+')'));assert.ok(result.markdown.startsWith(source.slice(0,source.indexOf('[定理'))));
});
