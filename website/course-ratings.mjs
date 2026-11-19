import {randomUUID} from 'node:crypto';
import {academicTerms,ratingDimensions,ratingSummary,teacherKey,teacherRatingGroups} from './dist/course-rating.mjs';
import {recordGovernanceAction as recordAction} from './governance.mjs';
import {initializeRatingSchema} from './course-rating-schema.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function createCourseRatings({db,identity,body,send,courseExists,validateContext,courseIdsFor=id=>[id],canonicalId=id=>id,importedScoresFor=()=>[]}){
 initializeRatingSchema(db);
 const admin=u=>u?.canEdit&&u.role==='admin';
 return async(req,res,p,url)=>{
  if(p[2]!=='ratings')return false;
  const u=identity.current(req);
  if(req.method==='GET'&&p.length===3){
   const courseId=url.searchParams.get('courseId'),teacher=url.searchParams.get('teacher')||'',term=url.searchParams.get('term')||'';if(!courseExists(courseId))fail(404,'课程不存在');
   if(term&&!academicTerms().includes(term))fail(400,'修读学期不正确');
   const ids=courseIdsFor(courseId),allRows=db.prepare(`SELECT * FROM atlas_ratings WHERE course_id IN (${ids.map(()=>'?').join(',')})`).all(...ids),rows=allRows.filter(r=>(!teacher||teacherKey(r.teacher)===teacherKey(teacher))&&(!term||r.term===term)),publicRows=rows.filter(r=>!r.hidden);
   const local=db.prepare(`SELECT COUNT(*) AS count,SUM(overall) AS total FROM atlas_ratings WHERE course_id IN (${ids.map(()=>'?').join(',')}) AND hidden=0`).get(...ids),imported=importedScoresFor(courseId).filter(row=>Number.isInteger(row.overall_score)&&row.overall_score>=1&&row.overall_score<=5),count=local.count+imported.length;
   const overall={count,average:count?((local.total||0)+imported.reduce((sum,value)=>sum+value.overall_score,0))/count:null};
   const teacherGroups=teacherRatingGroups(allRows.filter(r=>!r.hidden),imported);const groups=teacherRatingGroups(publicRows);
   send(res,200,{teacherGroups,groups,count:publicRows.length,dimensions:ratingSummary(publicRows),overall,teachers:db.prepare(`SELECT DISTINCT teacher FROM atlas_ratings WHERE course_id IN (${ids.map(()=>'?').join(',')}) AND hidden=0 AND teacher<>'' ORDER BY teacher`).all(...ids).map(r=>r.teacher),mine:u?rows.filter(r=>r.user_id===u.id):[],...(admin(u)?{records:rows.map(r=>({...r,username:db.prepare('SELECT username FROM users WHERE id=?').get(r.user_id).username}))}:{})});return true;
  }
  if(req.method!=='POST')fail(405,'方法不允许');req.requireEditor=true;identity.requireEditor(req);const b=await body(req,100000),actor=identity.requireEditor(req);db.exec('BEGIN IMMEDIATE');let result;
  try{
   const key='atlas:'+actor.id,t=Date.now(),limit=db.prepare('SELECT * FROM auth_limits WHERE bucket=?').get(key);if(limit&&limit.until>t&&limit.n>=20)fail(429,'编辑过于频繁，请稍后重试');
   if(p.length===3){
    if(!courseExists(b.courseId))fail(404,'课程不存在');const context=validateContext(b,b.courseId);
    for(const d of ratingDimensions)if(!Number.isInteger(b[d.key])||b[d.key]<1||b[d.key]>5)fail(400,'请为每个维度选择五档之一');
    const ids=courseIdsFor(b.courseId),candidates=db.prepare(`SELECT * FROM atlas_ratings WHERE course_id IN (${ids.map(()=>'?').join(',')}) AND teacher=? AND term=? AND user_id=? AND (offering_id=? OR offering_id='')`).all(...ids,context.teacher,context.term,actor.id,context.offering_id);
    if(candidates.length>1)fail(409,'存在多份旧评分，请先核对历史记录');const old=candidates[0];
    if(!Number.isSafeInteger(b.version)||b.version!==(old?.version||0))fail(409,'评分已有变化，请刷新后重试');if(old?.hidden)fail(409,'此评分已隐藏，请联系管理员');
    const stamp=new Date().toISOString();if(old){db.prepare('UPDATE atlas_ratings SET grading=?,difficulty=?,workload=?,assessment=?,overall=?,offering_id=?,version=version+1,updated=? WHERE id=?').run(...ratingDimensions.map(d=>b[d.key]),context.offering_id,stamp,old.id);result=db.prepare('SELECT * FROM atlas_ratings WHERE id=?').get(old.id)}else{const id=randomUUID();db.prepare('INSERT INTO atlas_ratings(id,course_id,teacher,term,offering_id,user_id,grading,difficulty,workload,assessment,overall,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,canonicalId(b.courseId),context.teacher,context.term,context.offering_id,actor.id,...ratingDimensions.map(d=>b[d.key]),stamp,stamp);result=db.prepare('SELECT * FROM atlas_ratings WHERE id=?').get(id)}
   }else if(p.length===5&&p[4]==='moderate'){
    if(!admin(actor))fail(403,'需要管理员权限');const old=db.prepare('SELECT * FROM atlas_ratings WHERE id=?').get(p[3]);if(!old)fail(404,'评分不存在');if(b.version!==old.version)fail(409,'评分已有变化');if(typeof b.hidden!=='boolean'||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>300)fail(400,'请填写原因');
    db.prepare('UPDATE atlas_ratings SET hidden=?,version=version+1,updated=? WHERE id=?').run(b.hidden?1:0,new Date().toISOString(),old.id);result=db.prepare('SELECT * FROM atlas_ratings WHERE id=?').get(old.id);recordAction(db,{actorId:actor.id,action:b.hidden?'atlas.rating-hide':'atlas.rating-restore',targetType:'atlas-rating',targetId:old.id,before:{hidden:!!old.hidden},after:{hidden:b.hidden},reason:b.reason.trim()});
   }else fail(404,'评分接口不存在');
   db.prepare('INSERT INTO atlas_rating_history(rating_id,version,actor_id,snapshot,created) VALUES(?,?,?,?,?)').run(result.id,result.version,actor.id,JSON.stringify(result),new Date().toISOString());
   db.prepare('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=CASE WHEN until<=? THEN 1 ELSE n+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END').run(key,t+60000,t,t);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}send(res,200,{rating:result});return true;
 };
}
