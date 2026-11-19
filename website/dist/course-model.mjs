// Shared identity and teaching-class rules for the browser and server.
export const normalizeIdentity=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const key=value=>normalizeIdentity(value).toLowerCase();
const unique=values=>[...new Set(values.filter(v=>v!==undefined&&v!==null&&v!==''))];
export function canonicalTerm(value){
 const term=String(value??'').replace(/\s+/g,'');
 if(/^\d{4}-\d{4}(秋|春|寒假|暑假)$/.test(term))return term;
 const match=term.match(/^(\d{4})(秋|春|寒假|暑假)$/);if(!match)return term;
 const year=Number(match[1])-(match[2]==='秋'?0:1);return `${year}-${year+1}${match[2]}`;
}
export const sourceTerm=(year,semester)=>Number.isInteger(year)&&[1,2,3,4].includes(semester)?`${year}-${year+1}${({1:'秋',2:'寒假',3:'春',4:'暑假'})[semester]}`:'';
export function courseOfferings(g){return g.offerings||[]}
export const catalogCourses=d=>d.scope.filter(g=>g.in_catalog!==false);
export function catalogOfferings(g,d){const terms=d.coverage?.catalog_terms;return Array.isArray(terms)&&terms.length?courseOfferings(g).filter(o=>terms.includes(o.term)):courseOfferings(g)}
export function prepareCatalog(base,extra=base.university||{}){
 const additions=extra.courses||[],reviews=new Map([...(base.reviews||[]),...(base.full_reviews||[])].map(r=>[r.id,r]));
 const buckets=new Map(),aliases=new Map(),sourceOwners=new Map(),sourceDepartments=new Map(),officialDepartments=new Map();
 for(const c of additions){const name=key(c.name);for(const o of c.offerings||[])if(String(o.id).startsWith('official:'))officialDepartments.set(String(o.id),{name,department:c.department});for(const id of c.danxi_group_ids||c.source_group_ids||[]){const owner=name+'\u0000'+key(c.department);if(sourceOwners.has(id)&&sourceOwners.get(id)!==owner)throw Error('旦夕课程组院系归属冲突');sourceOwners.set(id,owner);sourceDepartments.set(id,{name,department:c.department})}}
 for(const row of [...(base.scope||[]),...additions]){
  let refs=unique([...(row.direct_review_ids||[]),...(row.teacher_evidence||[]).flatMap(t=>t.direct_review_ids||[])]);
  let groups=unique([...(row.source_group_ids||row.danxi_group_ids||[]),...refs.map(id=>reviews.get(id)?.group_id)]);
  let department=normalizeIdentity(row.department);
  if(!department){
   const official=(row.offerings||[]).map(o=>officialDepartments.get(String(o.id||'official:'+o.syllabus))).filter(c=>c?.name===key(row.name));
   const evidence=official.length?official:groups.map(id=>sourceDepartments.get(id)).filter(c=>c?.name===key(row.name));
   const departments=unique(evidence.map(c=>normalizeIdentity(c.department)));if(departments.length===1)department=departments[0];
  }
  // An absent department is not evidence that two courses belong together.
  const identity=department?key(row.name)+'\u0000'+key(department):'legacy:'+row.id;
  refs=refs.filter(id=>!sourceOwners.has(reviews.get(id)?.group_id)||sourceOwners.get(reviews.get(id).group_id)===identity);
  groups=groups.filter(id=>!sourceOwners.has(id)||sourceOwners.get(id)===identity);
  const id=department?'U-'+encodeURIComponent(key(department))+'~'+encodeURIComponent(key(row.name)):row.id;
  if(!id)throw Error('课程缺少可核对的名称或院系');
  let g=buckets.get(identity);
  if(!g){g={id,name:row.name,department,code:row.code||'',codes:[],legacy_ids:[],categories:[],teachers:[],terms:[],offerings:[],direct_review_ids:[],teacher_evidence:[],source_group_ids:[]};buckets.set(identity,g)}
  g.codes=unique([...g.codes,...(row.codes||[]),row.code]);g.legacy_ids=unique([...g.legacy_ids,...(row.legacy_ids||[]),row.id]);
  g.categories=unique([...g.categories,...(row.categories||[])]);g.teachers=unique([...g.teachers,...(row.teachers||[])]);
  g.direct_review_ids=unique([...g.direct_review_ids,...refs]);g.teacher_evidence.push(...(row.teacher_evidence||[]).map(t=>({...t,direct_review_ids:(t.direct_review_ids||[]).filter(id=>refs.includes(id))})));g.source_group_ids=unique([...g.source_group_ids,...groups]);
  for(const o of row.offerings||[]){
   const term=canonicalTerm(o.term),teachers=Array.isArray(o.teachers)?o.teachers:typeof o.teachers==='string'?[o.teachers]:[];
   const offeringId=String(o.id||'snapshot:'+JSON.stringify([term,o.code||'',teachers,o.syllabus||'']));
   const known=g.offerings.find(c=>c.id===offeringId);
   if(known){if(known.term!==term||JSON.stringify(known.teachers)!==JSON.stringify(teachers)||known.code!==(o.code||''))throw Error('教学班编号冲突');continue}
   const snapshot=g.offerings.find(c=>c.id.startsWith('snapshot:')&&c.term===term&&c.code&&c.code===o.code&&JSON.stringify(c.teachers)===JSON.stringify(teachers));
   if(snapshot&&!offeringId.startsWith('snapshot:')){Object.assign(snapshot,{...o,id:offeringId,term,code:o.code||'',teachers,department});continue}
   g.offerings.push({...o,id:offeringId,term,code:o.code||'',teachers,department});
  }
 }
 for(const g of buckets.values()){
  for(const id of g.direct_review_ids){const r=reviews.get(id),term=r&&sourceTerm(r.year,r.semester);if(!term||!r.teacher)continue;
   if(g.offerings.some(o=>o.term===term&&(o.teachers.join('、')===r.teacher||o.teachers.includes(r.teacher))))continue;
   const offeringId=r.course_id?'danxi:'+r.course_id:'review:'+JSON.stringify([g.id,term,r.teacher]);
   if(!g.offerings.some(o=>o.id===offeringId))g.offerings.push({id:offeringId,term,code:'',teachers:[r.teacher],department:g.department,source:'danxi-review'});
  }
  g.teachers=unique([...g.teachers,...g.offerings.flatMap(o=>o.teachers),...g.teacher_evidence.map(t=>t.teacher)]);
  g.terms=unique(g.offerings.map(o=>o.term));g.code=g.codes.join('、');
  const terms=extra.coverage?.catalog_terms;g.in_catalog=!Array.isArray(terms)||!terms.length||g.offerings.some(o=>o.id.startsWith('official:')&&terms.includes(o.term));
  for(const id of [g.id,...g.legacy_ids]){if(aliases.has(id)&&aliases.get(id)!==g.id)throw Error('课程旧链接归属冲突');aliases.set(id,g.id)}
 }
 return {...base,scope:[...buckets.values()],course_alias_ids:Object.fromEntries(aliases),coverage:extra.coverage||base.coverage};
}
export function findCourse(catalog,id){return catalog.scope.find(g=>g.id===id||g.legacy_ids?.includes(id))}
export const courseIds=g=>unique([g.id,...(g.legacy_ids||[])]);
