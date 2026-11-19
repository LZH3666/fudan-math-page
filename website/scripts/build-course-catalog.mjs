import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareCatalog,catalogOfferings} from '../dist/course-model.mjs';
import {importedReviewRows} from '../dist/course-feedback.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function publicCatalog(base,extra={},full={}){
 const prepared=prepareCatalog({...base,full_reviews:full.reviews||[],full_review_groups:full.groups||[]},extra),files=new Map(),scope=[];
 for(const course of prepared.scope){
  const reviews=importedReviewRows(course,prepared,full.reviews||[]),scored=reviews.filter(r=>Number.isInteger(r.overall_score)&&r.overall_score>=1&&r.overall_score<=5);
  const ids=new Set(course.offerings.map(o=>o.syllabus)),syllabi=(base.syllabi||[]).filter(s=>ids.has(s.lesson_id));
  // Keep the original course and review objects; only the transport is split.
  const bytes=JSON.stringify({schema_version:1,scope:[course],coverage:prepared.coverage,reviews,full_reviews:[],syllabi});
  const detail='courses/'+digest(bytes)+'.json';files.set(detail,bytes);
  scope.push({id:course.id,name:course.name,department:course.department,code:course.code,codes:course.codes,categories:course.categories,teachers:course.teachers,in_catalog:course.in_catalog,legacy_ids:course.legacy_ids,catalog_terms:[...new Set(catalogOfferings(course,prepared).map(o=>o.term))],review_stats:{count:reviews.length,average:scored.length?scored.reduce((n,r)=>n+r.overall_score,0)/scored.length:null},detail});
 }
 const index={schema_version:1,scope,coverage:prepared.coverage};
 files.set('catalog-index.json',JSON.stringify(index));return {index,files,prepared};
}
export function buildCourseCatalog(dataDir){
 const read=name=>JSON.parse(fs.readFileSync(path.join(dataDir,name+'.json'),'utf8'));
 const sources=['catalog','university-courses','full-reviews'];
 const {files,index}=publicCatalog(...sources.map(read));
 for(const [name,bytes] of files){const target=path.join(dataDir,name);fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')===bytes)continue;if(name.startsWith('courses/')&&fs.existsSync(target))throw Error('Immutable course detail differs: '+name);const temp=target+'.building';fs.writeFileSync(temp,bytes);fs.renameSync(temp,target)}
 const sourceHashes=Object.fromEntries(sources.map(name=>[name+'.json',digest(fs.readFileSync(path.join(dataDir,name+'.json')))]));
 const report={schema_version:1,sourceHashes,courses:index.scope.length,indexBytes:Buffer.byteLength(files.get('catalog-index.json')),files:Object.fromEntries([...files].map(([name,bytes])=>[name,{sha256:digest(bytes),bytes:Buffer.byteLength(bytes)}]))};
 fs.writeFileSync(path.join(dataDir,'catalog-build.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=buildCourseCatalog(fileURLToPath(new URL('../dist/course-atlas/data/',import.meta.url)));console.log(JSON.stringify({courses:report.courses,indexBytes:report.indexBytes}));
}
