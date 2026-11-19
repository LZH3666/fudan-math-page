import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=text=>createHash('sha256').update(text).digest('hex');
const positive=v=>Number.isSafeInteger(v)&&v>0;
export function collectFullReviews(catalog,exports){
 const legacy=new Map(catalog.reviews.map(r=>[r.id,r])),allowed=new Set([...catalog.reviews.map(r=>r.group_id),...(catalog.scope||[]).flatMap(g=>g.source_group_ids||g.danxi_group_ids||[])]),seenGroups=new Set(),groups=new Set(),partialGroups=[],reviews=new Map();
 for(const data of exports){
  if(!positive(data.id)||!allowed.has(data.id)||seenGroups.has(data.id))throw Error('Unmatched or duplicate source group');
  if(!Array.isArray(data.course_list)||!positive(data.review_count)&&data.review_count!==0)throw Error('Invalid source group schema');
  const local=[];
  for(const course of data.course_list){
   if(!positive(course.id)||typeof course.teachers!=='string'||!Number.isInteger(course.year)||![1,2,3,4].includes(course.semester)||!Array.isArray(course.review_list))throw Error('Invalid source course schema');
   for(const r of course.review_list){
    if(!positive(r.id)||typeof r.content!=='string'||typeof r.title!=='string'||hash(r.content)!==r.content_sha256||r.deleted||r.hidden||r.nonpublic||r.public===false||r.is_public===false)throw Error('Invalid or unavailable review');
    const old=legacy.get(r.id);if(old&&old.group_id!==data.id)throw Error('Review source group mismatch');
    if(reviews.has(r.id)||local.some(x=>x.id===r.id))throw Error('Duplicate review ID');
    const overall=r.rank?.overall;
    local.push({id:r.id,group_id:data.id,course_id:course.id,teacher:course.teachers,year:course.year,semester:course.semester,title:r.title,content:r.content,content_sha256:r.content_sha256,...(Number.isInteger(overall)&&overall>=1&&overall<=5?{overall_score:overall}:{})});
   }
  }
  const metadata=data.export_metadata,matches=local.length===data.review_count;
  if(!metadata||metadata.source_review_count!==data.review_count||metadata.exported_reviews!==local.length||metadata.count_matches!==matches)throw Error('Inconsistent source count metadata');
  for(const r of local)reviews.set(r.id,r);seenGroups.add(data.id);
  const receivedIds=new Set(local.map(r=>r.id)),missingReferenceIds=catalog.reviews.filter(r=>r.group_id===data.id&&!receivedIds.has(r.id)).map(r=>r.id).sort((a,b)=>a-b);
  if(matches&&!missingReferenceIds.length)groups.add(data.id);else partialGroups.push({group_id:data.id,received:local.length,expected:data.review_count,missing_reference_ids:missingReferenceIds});
 }
 return {schema_version:1,groups:[...groups].sort((a,b)=>a-b),partial_groups:partialGroups.sort((a,b)=>a.group_id-b.group_id),reviews:[...reviews.values()].sort((a,b)=>a.id-b.id)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),directory=path.resolve(process.argv[2]||path.join(root,'work/danxi-full-reviews-20261024/exports'));
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'website/dist/course-atlas/data/catalog.json'),'utf8'));
 const files=fs.readdirSync(directory).filter(n=>/^course_group_\d+\.json$/.test(n));
 if(!files.length)throw Error('No completed exports');
 const out=collectFullReviews(catalog,files.map(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))));
 const destination=path.join(root,'website/dist/course-atlas/data/full-reviews.json'),temporary=destination+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify(out));fs.renameSync(temporary,destination);
 console.log(JSON.stringify({complete_groups:out.groups.length,partial_groups:out.partial_groups.length,reviews:out.reviews.length,output:destination}));
}
