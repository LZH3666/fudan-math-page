import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCatalog,normalizeIdentity,sourceTerm} from '../dist/course-model.mjs';
import {collectFullReviews} from './import-danxi-reviews.mjs';
import {withImportLock} from './import-lock.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),output=path.join(root,'website/dist/course-atlas/data');
const identity=(name,department)=>normalizeIdentity(name).toLowerCase()+'\u0000'+normalizeIdentity(department).toLowerCase();
const atomic=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file)};
export function chooseOfficialWindow(requested,historical){
 if(!historical)return requested;
 const prior=requested.coverage?.catalog_terms||[],expanded=historical.coverage?.catalog_terms||[];
 return historical.coverage?.complete===true&&prior.length>0&&expanded.length>prior.length&&prior.every(term=>expanded.includes(term))?historical:requested;
}
export function chooseSnapshot(previous,next){
 if(!previous||JSON.stringify(previous)===JSON.stringify(next))return next;
 const before=Date.parse(previous.export_metadata?.fetched_at_utc),after=Date.parse(next.export_metadata?.fetched_at_utc);
 if(!Number.isFinite(before)||!Number.isFinite(after)||before===after)throw Error('课程组存在无法排序的不同快照，需先核对');
 return after>before?next:previous;
}
export function attachSourceReviews(catalog,official,exports){
 if(official.schema_version!==1||!Array.isArray(official.courses)||!official.courses.length)throw Error('全校官方课程目录无效');
 const byKey=new Map();
 for(const c of structuredClone(official.courses)){if(!normalizeIdentity(c.name)||!normalizeIdentity(c.department)||!Array.isArray(c.offerings))throw Error('官方课程缺少名称、院系或教学班');const key=identity(c.name,c.department),known=byKey.get(key);if(known){known.codes=[...new Set([...(known.codes||[]),known.code,...(c.codes||[]),c.code].filter(Boolean))];known.offerings.push(...c.offerings);known.danxi_group_ids=[...new Set([...(known.danxi_group_ids||[]),...(c.danxi_group_ids||[])])]}else byKey.set(key,c)}
 const retained=new Set(catalog.reviews.map(r=>r.group_id)),matched=[],unmatched=[];
 for(const raw of exports){
  const key=identity(raw.name,raw.department);let c=byKey.get(key);
  if(!c){if(!retained.has(raw.id))throw Error('旦夕课程组无法与官方课程名称及院系对应');if(!normalizeIdentity(raw.name)||!normalizeIdentity(raw.department))throw Error('旧课程组缺少真实院系');unmatched.push(raw.id);c={name:raw.name,department:raw.department,code:raw.code||'',codes:[raw.code].filter(Boolean),offerings:[],danxi_group_ids:[],source:'danxi-legacy'};byKey.set(key,c)}
  c.danxi_group_ids=[...new Set([...(c.danxi_group_ids||[]),raw.id])];
  c.direct_review_ids=[...new Set([...(c.direct_review_ids||[]),...catalog.reviews.filter(r=>r.group_id===raw.id).map(r=>r.id)])];if(!unmatched.includes(raw.id))matched.push(raw.id);
 }
 const courses=[...byKey.values()];
 const scope=courses.map(c=>({...c,source_group_ids:c.danxi_group_ids||[]}));
 const full=collectFullReviews({...catalog,scope},exports); // verify every body before using its metadata
 for(const raw of exports){const c=byKey.get(identity(raw.name,raw.department));if(!c)continue;
  for(const row of raw.course_list){const term=sourceTerm(row.year,row.semester);if(!term)continue;
   const teacher=row.teachers,code=row.code_id||'';
   if(!c.offerings.some(o=>o.term===term&&o.code===code&&(o.teachers||[]).join('、')===teacher))c.offerings.push({id:'danxi:'+row.id,term,code,teachers:[teacher],credits:row.credit??null,source:'danxi',department:c.department});
  }
 }
 const result={...official,courses,review_matching:{matched_groups:matched,unmatched_legacy_groups:unmatched}};
 prepareCatalog(catalog,result); // reject identity and class conflicts before atomic installation
 return {directory:result,full};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await withImportLock(path.join(output,'.university-import.lock'),async()=>{
 const recent=path.join(root,'work/university-courses-20261024/recent-courses.json');
 const input=path.resolve(process.argv[2]||(fs.existsSync(recent)?recent:path.join(root,'work/university-courses-20261024/university-courses.json')));
 const folders=process.argv.slice(3);if(!folders.length)folders.push(path.join(root,'work/danxi-full-reviews-20261024/exports'));
 const snapshots=new Map(),unreadable=[];for(const folder of folders)if(fs.existsSync(folder))for(const name of fs.readdirSync(folder).filter(n=>/^course_group_\d+\.json$/.test(n))){const file=path.join(folder,name),bytes=fs.readFileSync(file,'utf8');let raw;try{raw=JSON.parse(bytes)}catch{unreadable.push(file);continue}snapshots.set(raw.id,chooseSnapshot(snapshots.get(raw.id),raw))}
 const historical=path.join(root,'work/official-history-20261024/courses.json');
 const catalog=JSON.parse(fs.readFileSync(path.join(output,'catalog.json'),'utf8')),official=chooseOfficialWindow(JSON.parse(fs.readFileSync(input,'utf8')),fs.existsSync(historical)?JSON.parse(fs.readFileSync(historical,'utf8')):null);
 const result=attachSourceReviews(catalog,official,[...snapshots.values()]);result.directory.review_matching.unreadable_exports=unreadable.map(file=>path.basename(file));atomic(path.join(output,'university-courses.json'),result.directory);atomic(path.join(output,'full-reviews.json'),result.full);
 console.log(JSON.stringify({official_courses:official.courses.length,displayed_courses:prepareCatalog(catalog,result.directory).scope.length,matched_groups:result.directory.review_matching.matched_groups.length,unmatched_legacy_groups:result.directory.review_matching.unmatched_legacy_groups.length,full_reviews:result.full.reviews.length,complete_groups:result.full.groups.length,partial_groups:result.full.partial_groups.length,unreadable_exports:unreadable}));
 });
}
