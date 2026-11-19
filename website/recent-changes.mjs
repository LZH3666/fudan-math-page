import {DIFF_VERSION} from './dist/text-diff.js';
import {movementColumns,previousRevisionJoin,protectionEvent,visibleRevision,describeMovements,groupDailyEdits} from './page-history.mjs';
const labels={
 'create':'创建','update':'修改','archive':'移除','restore':'恢复','undo':'撤销','import':'导入','reorder':'调整顺序',
 'user.block':'封禁账号','user.unblock':'解除封禁','comment.hide':'隐藏评论','comment.restore':'恢复评论',
 'discussion.hide':'隐藏讨论','discussion.restore':'恢复讨论','document.protect':'保护页面','document.unprotect':'取消保护'
};
const parse=value=>{try{return JSON.parse(value||'{}')}catch{return{}}};
const numberId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export function listRecent(db,before=0,options={}){
 const offset=Number(before);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw Object.assign(new Error('分页位置不正确'),{status:400});
 const min=Number(options.minChange||0),sort=options.sort||'time';
 if(!Number.isSafeInteger(min)||min<0||min>100000000||!['time','size'].includes(sort))throw Object.assign(new Error('改动筛选不正确'),{status:400});
 const events=[],movement=describeMovements(db);
 for(const r of db.prepare(`SELECT r.id,r.document_id,r.version,r.title,r.summary,r.created,u.username,d.is_course_home,d.course_id,d.title AS current_title,c.title AS course_title,
  ${movementColumns},p.version AS previous_version,s.status,s.added,s.removed,s.changed
  FROM revisions r JOIN users u ON u.id=r.user_id JOIN documents d ON d.id=r.document_id JOIN courses c ON c.id=d.course_id
  ${previousRevisionJoin}
  LEFT JOIN revision_diff_stats m ON m.revision_id=r.id LEFT JOIN text_diff_cache s ON s.key=m.cache_key AND s.algorithm=?
  WHERE r.version>0 AND ${visibleRevision} AND NOT ${protectionEvent}`).all(DIFF_VERSION)){
  const exact=r.status==='complete';
  events.push({source:'page',movement:movement(r),eventId:r.id,kind:'页面',action:r.summary|| (!r.previous_id?'创建页面':'编辑页面'),actor:r.username,created:r.created,targetId:r.document_id,targetTitle:r.is_course_home?r.course_title:r.title,courseTitle:r.course_title,summary:'',version:r.version,previousRevisionId:r.previous_id||null,previousVersion:r.previous_version??null,status:r.status==='exhausted'?'incomplete':r.status||'pending',exact,added:exact?r.added:null,removed:exact?r.removed:null,changed:exact?r.changed:null,canUndo:true});
 }
 for(const r of db.prepare(`SELECT h.id,h.course_id,h.user_id,h.action,h.snapshot,h.created,u.username FROM course_history h JOIN users u ON u.id=h.user_id`).all()){
  const snapshot=parse(r.snapshot);events.push({source:'course',eventId:r.id,kind:'课程',action:labels[r.action]||r.action,actor:r.username,created:r.created,targetId:r.course_id,targetTitle:snapshot.title||r.course_id,summary:r.action,version:snapshot.version,canUndo:true});
 }
 for(const r of db.prepare(`SELECT h.id,h.subject_id,h.user_id,h.action,h.snapshot,h.created,u.username FROM subject_history h JOIN users u ON u.id=h.user_id`).all()){
  const snapshot=parse(r.snapshot);events.push({source:'subject',eventId:r.id,kind:'板块',action:labels[r.action]||r.action,actor:r.username,created:r.created,targetId:r.subject_id,targetTitle:snapshot.title||r.subject_id,summary:r.action,version:snapshot.version,canUndo:true});
 }
 for(const r of db.prepare(`SELECT a.id,a.actor_id,a.action,a.target_type,a.target_id,a.before_json,a.after_json,a.reason,a.created,
   coalesce(u.username,'本机维护者') AS actor,d.title AS document_title,c.title AS course_title,p.title AS discussion_title,
   coalesce(tu.username,cd.title,d.title,p.title,a.target_id) AS target_title,coalesce(cd.id,d.id) AS target_page_id
   FROM admin_actions a LEFT JOIN users u ON u.id=a.actor_id
   LEFT JOIN users tu ON a.target_type='user' AND tu.id=a.target_id
   LEFT JOIN documents d ON a.target_type='document' AND d.id=a.target_id
   LEFT JOIN courses c ON d.course_id=c.id
   LEFT JOIN discussion_posts p ON a.target_type='discussion' AND p.id=a.target_id
   LEFT JOIN comments cm ON a.target_type='comment' AND cm.id=a.target_id
   LEFT JOIN documents cd ON cm.document_id=cd.id
   WHERE a.action IN ('user.block','user.unblock','comment.hide','comment.restore','discussion.hide','discussion.restore','document.protect','document.unprotect')`).all()){
  const beforeState=parse(r.before_json),after=parse(r.after_json);
  events.push({source:'action',eventId:r.id,kind:r.target_type==='user'?'账号':r.target_type==='comment'?'评论':r.target_type==='discussion'?'讨论':'页面',action:labels[r.action]||r.action,actor:r.actor,created:r.created,targetId:r.target_id,targetTitle:r.target_title,targetPageId:r.target_page_id,courseTitle:r.course_title,summary:r.reason,reason:r.reason,version:after.version,canUndo:true,before:beforeState,after,adminAction:r.action});
 }
 events.sort((a,b)=>b.created.localeCompare(a.created)||b.source.localeCompare(a.source)||Number(b.eventId)-Number(a.eventId));
 const uncounted=events.filter(e=>e.source==='page'&&!e.exact).length;
 const filtered=events.filter(e=>(!min||(e.source==='page'&&e.exact&&e.changed>=min))&&(sort!=='size'||e.source!=='page'||e.exact));
 if(sort==='size')filtered.sort((a,b)=>(b.changed??-1)-(a.changed??-1)||b.created.localeCompare(a.created));
 if(options.daily){
  const rows=filtered.map(row=>row.source==='page'?{...row,action:row.previousRevisionId?'编辑页面':'创建页面'}:row);
  const groups=groupDailyEdits(rows,row=>row.source==='page'?row.targetId:null);
  return {groups:groups.slice(offset,offset+100),nextBefore:groups.length>offset+100?offset+100:null,uncounted};
 }
 const page=filtered.slice(offset,offset+101),more=page.length>100;return{changes:page.slice(0,100),nextBefore:more?offset+100:null,uncounted};
}
export function undoRecent({db,source,eventId,actor,reason,transaction,document,course,parentFor,revision,documentAction,audit,recordAction,fail,now,artifactAvailable}){
 const id=numberId(eventId);if(!id)fail(400,'变更记录编号不正确');
 const change=reason;
 transaction(()=>{
  if(source==='page'){
   const r=db.prepare('SELECT * FROM revisions WHERE id=?').get(id);if(!r)fail(404,'页面变更不存在');
   const current=db.prepare('SELECT * FROM documents WHERE id=?').get(r.document_id);if(!current)fail(404,'页面不存在');
   const latest=db.prepare('SELECT * FROM revisions WHERE document_id=? ORDER BY version DESC LIMIT 1').get(r.document_id);
   if(latest?.id!==r.id||current.version!==r.version)fail(409,'页面已有更新，不能直接撤销这条记录；请先检查并恢复适当历史版本。');
   const previous=db.prepare('SELECT * FROM revisions WHERE document_id=? AND version<? ORDER BY version DESC LIMIT 1').get(r.document_id,r.version);
   const before={version:current.version,title:current.title,archived:!!current.archived,artifact:current.artifact};
   if(!previous){
    if(r.version!==1)fail(409,'找不到页面创建前的历史记录，不能安全撤销。');
    if(current.is_course_home)fail(409,'课程主页不能按新建页面撤销。');
    db.prepare('UPDATE documents SET archived=1,version=version+1,updated=? WHERE id=?').run(now(),current.id);
    const updated=document(current.id);revision(updated,actor,('撤销新建页面：'+change).slice(0,300));documentAction(current,actor,'archive',change);
   }else{
    if(!artifactAvailable(previous))fail(409,'要恢复的旧排版文件已缺失，当前页面未改变。');
    const restoreParent=previous.parent_id;
    if(!previous.archived&& !current.is_course_home)parentFor(restoreParent,current.course_id,current.id);
    const title=current.is_course_home?course(current.course_id).title:previous.title;
    db.prepare(`UPDATE documents SET title=?,tex=?,type=?,position=?,parent_id=?,preamble=?,render_mode=?,artifact=?,archived=?,version=version+1,updated=? WHERE id=?`)
     .run(title,previous.tex,previous.type,previous.position,restoreParent,previous.preamble,previous.render_mode,previous.artifact,previous.archived,now(),current.id);
    const updated=document(current.id);revision(updated,actor,('撤销页面变更：'+change).slice(0,300));
   }
   const after=document(current.id);recordAction(db,{actorId:actor.id,action:'content.undo',targetType:'document',targetId:current.id,before,after:{version:after.version,title:after.title,archived:!!after.archived,artifact:after.artifact},reason:change});return;
  }
  if(source==='course'){
   const event=db.prepare('SELECT * FROM course_history WHERE id=?').get(id);if(!event)fail(404,'课程变更不存在');
   const snapshot=parse(event.snapshot),current=db.prepare('SELECT * FROM courses WHERE id=?').get(event.course_id),latest=db.prepare('SELECT id FROM course_history WHERE course_id=? ORDER BY id DESC LIMIT 1').get(event.course_id);
   if(!current||latest?.id!==id||current.version!==snapshot.version)fail(409,'课程已有更新，不能直接撤销这条记录。');
   const priorRow=db.prepare('SELECT snapshot FROM course_history WHERE course_id=? AND id<? ORDER BY id DESC LIMIT 1').get(event.course_id,id),prior=priorRow?parse(priorRow.snapshot):null;
   if(!prior&&event.action!=='create')fail(409,'找不到课程创建前的历史记录，不能安全撤销。');
   const next=prior||{...current,archived:1};
   if(!db.prepare('SELECT 1 FROM subjects WHERE id=? AND archived=0').get(next.subject))fail(409,'原课程板块当前已移除，请先恢复该板块。');
   db.prepare('UPDATE courses SET title=?,subject=?,position=?,archived=?,version=version+1 WHERE id=?').run(next.title,next.subject,next.position,next.archived,event.course_id);
   audit(course(event.course_id),actor,'undo');return;
  }
  if(source==='subject'){
   const event=db.prepare('SELECT * FROM subject_history WHERE id=?').get(id);if(!event)fail(404,'板块变更不存在');
   const snapshot=parse(event.snapshot),current=db.prepare('SELECT * FROM subjects WHERE id=?').get(event.subject_id),latest=db.prepare('SELECT id FROM subject_history WHERE subject_id=? ORDER BY id DESC LIMIT 1').get(event.subject_id);
   if(!current||latest?.id!==id||current.version!==snapshot.version)fail(409,'板块已有更新，不能直接撤销这条记录。');
   const priorRow=db.prepare('SELECT snapshot FROM subject_history WHERE subject_id=? AND id<? ORDER BY id DESC LIMIT 1').get(event.subject_id,id),prior=priorRow?parse(priorRow.snapshot):null;
   if(!prior&&event.action!=='create')fail(409,'找不到板块创建前的历史记录，不能安全撤销。');
   const next=prior||{...current,archived:1};
   if(next.archived&&db.prepare('SELECT 1 FROM courses WHERE subject=? LIMIT 1').get(event.subject_id))fail(409,'此板块已有课程，不能撤销创建；请先调整课程归属。');
   db.prepare('UPDATE subjects SET title=?,position=?,archived=?,version=version+1 WHERE id=?').run(next.title,next.position,next.archived,event.subject_id);
   const after=db.prepare('SELECT * FROM subjects WHERE id=?').get(event.subject_id);db.prepare('INSERT INTO subject_history(subject_id,user_id,action,snapshot,created) VALUES(?,?,?,?,?)').run(event.subject_id,actor.id,'undo',JSON.stringify(after),now());
   recordAction(db,{actorId:actor.id,action:'subject.undo',targetType:'subject',targetId:event.subject_id,before:current,after,reason:change});return;
  }
  if(source!=='action')fail(400,'此类变更不能撤销。');
  const event=db.prepare('SELECT * FROM admin_actions WHERE id=?').get(id);if(!event)fail(404,'操作记录不存在');
  const latest=db.prepare('SELECT id FROM admin_actions WHERE target_type=? AND target_id=? ORDER BY id DESC LIMIT 1').get(event.target_type,event.target_id);
  if(latest?.id!==id)fail(409,'目标已有后续管理操作，不能直接撤销这条记录。');
  const beforeState=parse(event.before_json),afterState=parse(event.after_json);
  if(event.target_type==='user'&&['user.block','user.unblock'].includes(event.action)){
   const target=db.prepare('SELECT id,role,blocked,moderation_version,email_verified_at FROM users WHERE id=?').get(event.target_id);
   if(!target||target.moderation_version!==afterState.version||!!target.blocked!==!!afterState.blocked)fail(409,'账号状态已改变，不能撤销。');
   const blocked=!!beforeState.blocked;
   if(blocked&&target.role==='admin'&&!target.blocked&&target.email_verified_at&&db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND blocked=0 AND email_verified_at IS NOT NULL").get().n<=1)fail(409,'不能撤销为封禁最后一位可用管理员。');
   db.prepare('UPDATE users SET blocked=?,moderation_version=moderation_version+1 WHERE id=?').run(blocked?1:0,target.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(target.id);
   recordAction(db,{actorId:actor.id,action:blocked?'user.block':'user.unblock',targetType:'user',targetId:target.id,before:{blocked:!!target.blocked,version:target.moderation_version},after:{blocked,version:target.moderation_version+1},reason:change});return;
  }
  if(event.target_type==='comment'&&['comment.hide','comment.restore'].includes(event.action)){
   const target=db.prepare('SELECT * FROM comments WHERE id=?').get(event.target_id);if(!target||target.version!==afterState.version||!!target.hidden!==!!afterState.hidden)fail(409,'评论状态已改变，不能撤销。');
   const hidden=!!beforeState.hidden;db.prepare('UPDATE comments SET hidden=?,version=version+1 WHERE id=?').run(hidden?1:0,target.id);
   recordAction(db,{actorId:actor.id,action:hidden?'comment.hide':'comment.restore',targetType:'comment',targetId:target.id,before:{hidden:!!target.hidden,version:target.version},after:{hidden,version:target.version+1},reason:change});return;
  }
  if(event.target_type==='discussion'&&['discussion.hide','discussion.restore'].includes(event.action)){
   const target=db.prepare('SELECT * FROM discussion_posts WHERE id=?').get(event.target_id);if(!target||target.version!==afterState.version||!!target.hidden!==!!afterState.hidden)fail(409,'讨论状态已改变，不能撤销。');
   const hidden=!!beforeState.hidden;db.prepare('UPDATE discussion_posts SET hidden=?,version=version+1,updated=? WHERE id=?').run(hidden?1:0,now(),target.id);
   const after=db.prepare('SELECT * FROM discussion_posts WHERE id=?').get(target.id);db.prepare('INSERT INTO discussion_history(post_id,version,user_id,title,body,hidden,created) VALUES(?,?,?,?,?,?,?)').run(target.id,after.version,actor.id,after.title,after.body,after.hidden,now());
   recordAction(db,{actorId:actor.id,action:hidden?'discussion.hide':'discussion.restore',targetType:'discussion',targetId:target.id,before:{hidden:!!target.hidden,version:target.version},after:{hidden,version:target.version+1},reason:change});return;
  }
  if(event.target_type==='document'&&['document.protect','document.unprotect'].includes(event.action)){
   const current=document(event.target_id);if(current.version!==afterState.version||!!current.protected!==!!afterState.protected)fail(409,'页面状态已改变，不能撤销。');
   db.prepare('UPDATE documents SET protected=?,version=version+1,updated=? WHERE id=?').run(beforeState.protected?1:0,now(),current.id);
   const updated=document(current.id);revision(updated,actor,'撤销页面保护操作');documentAction(current,actor,beforeState.protected?'protect':'unprotect',change);return;
  }
  fail(400,'此类管理操作不能撤销。');
 });
}
