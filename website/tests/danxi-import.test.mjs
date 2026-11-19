import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectFullReviews} from '../scripts/import-danxi-reviews.mjs';
import {importedReviews} from '../dist/course-feedback.js';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
const body='原文\n<script>不是可执行代码</script>\n'+ '内容'.repeat(900);
const review=(id,content=body)=>({id,title:'原标题',content,content_sha256:createHash('sha256').update(content).digest('hex'),reviewer_id:999,email:'private@example.invalid'});
const exported=(rows=[review(1)])=>({id:20,review_count:rows.length,course_list:[{id:30,teachers:'教师甲',year:2023,semester:3,review_list:rows}],export_metadata:{count_matches:true,source_review_count:rows.length,exported_reviews:rows.length}});
const catalog={reviews:[{id:1,group_id:20,title:'原标题',teacher:'教师甲',year:2023,semester:3,content:'90字摘录…'},{id:2,group_id:20,title:'旧快照记录',content:'尚未核清的旧摘录'},{id:3,group_id:40,title:'未采集分组',content:'另一分组摘录'}]};
test('only explicit source overall ratings on the 1 to 5 scale are retained without deriving scores from text',()=>{
 const rows=[review(1),review(2),review(4),review(5),review(6),review(7)];rows[0].rank={overall:5};rows[1].rank={overall:1};rows[2].rank={overall:0};rows[3].rank={overall:6};rows[4].rank={overall:2.5};const out=collectFullReviews(catalog,[exported(rows)]);assert.deepEqual(out.reviews.filter(r=>r.overall_score!==undefined).map(r=>r.overall_score),[5,1]);assert.equal(out.reviews.at(-1).overall_score,undefined);
});
test('raw text over 1200 characters imports exactly and identity fields are never copied',()=>{
 const result=collectFullReviews(catalog,[exported([review(1),review(2)])]);assert.equal(result.reviews[0].content,body);assert.deepEqual(result.groups,[20]);assert.equal(result.reviews[0].teacher,'教师甲');assert.equal(result.reviews[0].course_id,30);assert.equal(result.reviews[0].email,undefined);assert.equal(result.reviews[0].reviewer_id,undefined);
});
test('unmatched groups, ID collisions, tampering, hidden entries and contradictory count metadata fail before publication',()=>{
 for(const mutate of [x=>x.id=999,x=>x.course_list[0].review_list[0].content+='篡改',x=>x.export_metadata.count_matches=false,x=>x.review_count++,x=>x.course_list[0].review_list[0].deleted=true]){const x=exported();mutate(x);assert.throws(()=>collectFullReviews(catalog,[x]))}
 assert.throws(()=>collectFullReviews(catalog,[exported([review(1),review(1)])]));assert.throws(()=>collectFullReviews(catalog,[exported(),exported()]));
 const conflict=exported([review(3)]);assert.throws(()=>collectFullReviews(catalog,[conflict]),/mismatch/);
});
test('partial groups preserve verified full bodies without claiming completeness or suppressing missing old references',()=>{
 const data=exported([review(1)]);data.review_count=2;data.export_metadata={...data.export_metadata,source_review_count:2,count_matches:false};
 const result=collectFullReviews(catalog,[data]);assert.deepEqual(result.groups,[]);assert.deepEqual(result.partial_groups,[{group_id:20,received:1,expected:2,missing_reference_ids:[2]}]);assert.equal(result.reviews[0].content,body);
 const dom=new JSDOM(importedReviews({direct_review_ids:[1,2]}, {...catalog,full_review_groups:result.groups},result.reviews));try{assert.equal(dom.window.document.querySelector('[data-source-id="1"] p').textContent,body);assert.equal(dom.window.document.querySelector('[data-source-id="2"] p').textContent,'尚未核清的旧摘录')}finally{dom.window.close()}
 assert.throws(()=>collectFullReviews(catalog,[data,data]),/duplicate/);
});
test('equal counts with missing old IDs remain partial and preserve missing excerpts',()=>{
 const result=collectFullReviews(catalog,[exported([review(1),review(4,'新增原文')])]);assert.deepEqual(result.groups,[]);assert.deepEqual(result.partial_groups,[{group_id:20,received:2,expected:2,missing_reference_ids:[2]}]);
 const dom=new JSDOM(importedReviews({direct_review_ids:[1,2]}, {...catalog,full_review_groups:result.groups},result.reviews));try{assert.equal(dom.window.document.querySelector('[data-source-id="2"] p').textContent,'尚未核清的旧摘录');assert.equal(dom.window.document.querySelector('[data-source-id="4"] p').textContent,'新增原文')}finally{dom.window.close()}
});
test('complete reconciled groups replace excerpts and add new source reviews',()=>{
 const result=collectFullReviews(catalog,[exported([review(1),review(2,'旧记录的完整原文'),review(4,'新增原文')])]),g={direct_review_ids:[1,2,3],teacher_evidence:[{direct_review_ids:[1]}]},d={...catalog,full_review_groups:result.groups};assert.deepEqual(result.groups,[20]);assert.deepEqual(result.partial_groups,[]);
 const dom=new JSDOM(importedReviews(g,d,result.reviews));try{const rows=[...dom.window.document.querySelectorAll('article')];assert.equal(rows.length,4);assert.equal(rows.find(x=>x.dataset.sourceId==='1').querySelector('p').textContent,body);assert.equal(rows.find(x=>x.dataset.sourceId==='4').querySelector('p').textContent,'新增原文');assert.equal(rows.find(x=>x.dataset.sourceId==='2').querySelector('p').textContent,'旧记录的完整原文');assert.ok(rows.find(x=>x.dataset.sourceId==='3'));assert.equal(dom.window.document.querySelectorAll('script').length,0)}finally{dom.window.close()}
});
