import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {publicCatalog,buildCourseCatalog} from '../scripts/build-course-catalog.mjs';
import {buildAssets} from '../scripts/build-assets.mjs';
import {checkRelease,prepareRelease,assertPublicPath} from '../scripts/check-release.mjs';
import {createCatalogLoader} from '../dist/course-loader.mjs';
import {importedReviewRows} from '../dist/course-feedback.js';
import {officialDocuments} from '../dist/official-documents.mjs';
import {createAtlasUI} from '../dist/course-atlas.js';
import {catalogFetch} from './catalog-fixture.mjs';
const raw={scope:[{id:'old',name:'课程',department:'院系',teachers:['甲'],offerings:[{id:'official:1',term:'2026-2027秋',teachers:['甲'],code:'A.01',syllabus:1}],source_group_ids:[1],direct_review_ids:[10]}],reviews:[{id:10,group_id:1,teacher:'甲',content:'旧摘录'}],syllabi:[{lesson_id:1,href:'syllabi/1.html'}]};
const full={groups:[1],reviews:[{id:10,group_id:1,teacher:'甲',content:'原文<script>不执行</script>',overall_score:5},{id:11,group_id:1,teacher:'乙',content:'另一篇',overall_score:1},{id:12,group_id:2,content:'不相关'}]};
test('catalog transport keeps original courses, aliases, source reviews and scores while loading only one detail',async()=>{
 const {index,files,prepared}=publicCatalog(raw,{},full),requests=[];
 const loader=createCatalogLoader(async url=>{requests.push(url);const bytes=files.get(url.replace('/course-atlas/data/',''));return {ok:!!bytes,json:async()=>JSON.parse(bytes)}});
 const d=await loader.index();assert.equal(requests.length,1);assert.equal(d.scope[0].offerings,undefined);assert.equal(d.reviews,undefined);assert.deepEqual(d.scope[0].review_stats,{count:2,average:3});
 const detail=await loader.course('old');assert.deepEqual(detail.scope,[{...prepared.scope[0],review_stats:index.scope[0].review_stats}]);assert.deepEqual(importedReviewRows(detail.scope[0],detail,detail.full_reviews),full.reviews.slice(0,2));
 assert.equal(index.scope[0].id,detail.scope[0].id);await loader.course(index.scope[0].id);assert.equal(requests.length,2);
});
test('opening different course details repeatedly uses each course own review count',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=catalogFetch({scope:['A','B'].map((id,i)=>({id,name:id,teachers:[],offerings:[],source_group_ids:[i+1]})),reviews:[]},{},{reviews:[{id:1,group_id:1,content:'一'},{id:2,group_id:2,content:'二'},{id:3,group_id:2,content:'三'}]});
 try{
  const ui=createAtlasUI({api:async()=>({entries:[],mine:[],teacherGroups:[]}),user:()=>null,courses:()=>[],modal(){},closeModal(){},refresh(){},markDirty(){}});
  for(const [id,count] of [['A',1],['B',2],['A',1],['B',2]]){const html=await ui.view(['reviews',id]);assert.match(html,new RegExp('课评 '+count+' 条'));assert.equal((html.match(/data-source-id=/g)||[]).length,count)}
 }finally{globalThis.fetch=previous}
});
test('failed index and failed detail requests are retryable and never become an empty successful catalog',async()=>{
 const {files,index}=publicCatalog(raw,{},full);let fail=true;
 const loader=createCatalogLoader(async url=>{const bytes=files.get(url.replace('/course-atlas/data/',''));return {ok:!fail,json:async()=>JSON.parse(bytes)}});
 await assert.rejects(loader.index(),/重试/);fail=false;await loader.index();fail=true;await assert.rejects(loader.course('old'),/重试/);fail=false;assert.equal((await loader.course('old')).scope[0].id,index.scope[0].id);
});
function siteFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-check-')),site=path.join(root,'site');
 const write=(name,bytes)=>{const file=path.join(site,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes)};
 write('dist/app.js',"import {leaf} from './leaf.mjs?v=1';\nconsole.log(leaf);");write('dist/leaf.mjs','export const leaf=1;');write('dist/style.css','body{color:black}');
 write('dist/index.html','<link href="/vendor/katex.min.css"><link href="style.css?v=1"><script src="/vendor/katex.min.js"></script><script src="app.js?v=1"></script>');
 for(const name of ['katex.min.css','katex.min.js','fonts/font.woff2'])write('node_modules/katex/dist/'+name,'fixture');
 for(const name of ['build/pdf.mjs','build/pdf.worker.mjs','cmaps/map.bcmap','standard_fonts/font.pfb','wasm/font.wasm'])write('node_modules/pdfjs-dist/'+name,'fixture');
 for(const [name,value] of [['catalog',raw],['university-courses',{}],['full-reviews',full]])write('dist/course-atlas/data/'+name+'.json',JSON.stringify(value));
 write('dist/course-atlas/data/fitness.json','{"weights":{},"groups":{}}');
 for(const doc of officialDocuments)if(doc.href.startsWith('/course-atlas/'))write('dist/'+doc.href.slice(1),'public fixture');
 for(const name of ['admin','backup','import-guide-posts','build-course-catalog','build-assets','check-release'])write('scripts/'+name+'.mjs','// fixture');
 write('content/other-functions/posts.json','{}');write('package.json','{}');write('package-lock.json','{}');
 write('content/other-functions/guide-202605.pdf','private import source');
 for(const name of ['scripts','layouts','assets','static','i18n','data'])write('banana-runtime/'+name+'/fixture.txt','runtime fixture');
 for(const name of ['hugo.toml','LICENSE','package.json','package-lock.json'])write('banana-runtime/'+name,'runtime fixture');
 write('dist/course-atlas/syllabi/1.html','public syllabus');
 buildCourseCatalog(path.join(site,'dist/course-atlas/data'));buildAssets(site);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,site,write};
}
test('changing a leaf automatically versions its entire import chain and retains old asset bytes',t=>{
 const {site,write}=siteFixture(t),first=buildAssets(site),old=fs.readFileSync(path.join(site,'dist/assets-version',first.version,'leaf.mjs'));
 assert.equal(buildAssets(site).version,first.version);write('dist/leaf.mjs','export const leaf=2;');const next=buildAssets(site);assert.notEqual(next.version,first.version);
 assert.ok(fs.readFileSync(path.join(site,'dist/assets-version',first.version,'leaf.mjs')).equals(old));
 assert.match(fs.readFileSync(path.join(site,'dist/assets-version',next.version,'app.js'),'utf8'),/\.\/leaf\.mjs'/);assert.doesNotMatch(fs.readFileSync(path.join(site,'dist/index.html'),'utf8'),/\?v=/);
});
test('release gate prepares a checksummed new directory and rejects stale sources, missing data and private files',t=>{
 const {site,root,write}=siteFixture(t);write('dist/course-atlas/assets/guide-202605.pdf','old public copy');const report=checkRelease(site);assert.ok(Object.keys(report.files).length>20);
 assert.equal(report.files['dist/course-atlas/assets/guide-202605.pdf'],undefined);assert.ok(report.files['content/other-functions/guide-202605.pdf']);
 prepareRelease(site,path.join(root,'ready'));assert.throws(()=>prepareRelease(site,path.join(root,'ready')),/new directory/);
 assert.equal(fs.existsSync(path.join(root,'ready/dist/course-atlas/assets/guide-202605.pdf')),false);assert.equal(fs.existsSync(path.join(root,'ready/content/other-functions/guide-202605.pdf')),true);
 write('dist/leaf.mjs','export const leaf=3;');assert.throws(()=>checkRelease(site),/Stale/);buildAssets(site);
 write('dist/leak.sqlite','not for release');assert.throws(()=>checkRelease(site),/Forbidden/);fs.unlinkSync(path.join(site,'dist/leak.sqlite'));
 fs.unlinkSync(path.join(site,'dist/course-atlas/data/catalog-index.json'));assert.throws(()=>checkRelease(site),/ENOENT/);
 for(const name of ['data/library.sqlite','.env','dist/../data/x','dist/.env','dist/data/session.json','dist/x.sqlite-wal','../server.mjs'])assert.throws(()=>assertPublicPath(name));
});
test('release gate rejects missing fitness data and misplaced private attachment or development mail directories',t=>{
 const {site,write}=siteFixture(t),fitness=path.join(site,'dist/course-atlas/data/fitness.json'),bytes=fs.readFileSync(fitness);
 fs.unlinkSync(fitness);assert.throws(()=>checkRelease(site),/ENOENT/);fs.writeFileSync(fitness,bytes);
 for(const name of ['dist/guide-files/hidden.pdf','dist/mail-outbox/reset-link.json']){write(name,'synthetic private fixture');assert.throws(()=>checkRelease(site),/Forbidden/);fs.unlinkSync(path.join(site,name))}
 for(const name of ['dist/guide-files/x.pdf','dist/mail-outbox/mail.json','dist/course-atlas/assets/guide-files/x.pdf'])assert.throws(()=>assertPublicPath(name));
});
