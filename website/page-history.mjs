export const editableFields=['title','type','position','parent_id','render_mode','preamble','tex'];
export const previousRevisionJoin=`LEFT JOIN revisions p ON p.id=(
 SELECT id FROM revisions WHERE document_id=r.document_id AND version<r.version ORDER BY version DESC LIMIT 1)`;
export const protectionEvent=`EXISTS (SELECT 1 FROM admin_actions a
 WHERE a.target_type='document' AND a.target_id=r.document_id
 AND a.action IN ('document.protect','document.unprotect')
 AND json_extract(a.after_json,'$.version')=r.version
 AND json_extract(a.before_json,'$.protected') IS NOT json_extract(a.after_json,'$.protected'))`;
// The diff worker compares a first revision with the empty string.
export const visibleRevision=`(r.tex IS NOT coalesce(p.tex,'')
 OR (p.id IS NOT NULL AND (r.parent_id IS NOT p.parent_id OR r.position IS NOT p.position)))`;

export const movementColumns='p.id AS previous_id,p.title AS old_title,p.parent_id AS old_parent,r.parent_id AS new_parent,p.position AS old_position,r.position AS new_position';
export function describeMovements(db){
 const title=db.prepare('SELECT title FROM revisions WHERE document_id=? AND created<=? ORDER BY version DESC LIMIT 1');
 const current=db.prepare('SELECT title FROM documents WHERE id=?');
 const name=(id,at)=>id?(title.get(id,at)?.title||current.get(id)?.title||id):'顶层';
 return row=>{
  if(!row.previous_id)return '';
  const parts=[];
  if(row.old_title!==row.title)parts.push('标题从「'+row.old_title+'」改为「'+row.title+'」');
  if(row.old_parent!==row.new_parent){
   const from=name(row.old_parent,row.created),to=name(row.new_parent,row.created);
   const label=(title,id)=>from===to?title+'（'+id+'）':title;
   parts.push('上级页面从「'+label(from,row.old_parent)+'」移至「'+label(to,row.new_parent)+'」');
  }
  if(row.old_position!==row.new_position)parts.push('目录顺序从 '+row.old_position+' 改为 '+row.new_position);
  return parts.join('，');
 };
}

const shanghaiDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
export function groupDailyEdits(rows,pageId){
 const groups=[],byKey=new Map();
 for(const row of rows){
  const id=pageId(row);
  if(!id){groups.push({entries:[row]});continue}
  const day=shanghaiDay.format(new Date(row.created)),key=id+'|'+day;
  let group=byKey.get(key);
  if(!group){group={day,entries:[]};byKey.set(key,group);groups.push(group)}
  group.entries.push(row);
 }
 return groups;
}

export function pageHistory(db,id){
 const rows=db.prepare(`SELECT r.id,r.version,r.title,r.created,u.username,${movementColumns}
  FROM revisions r JOIN users u ON u.id=r.user_id ${previousRevisionJoin}
  WHERE r.document_id=? AND ${visibleRevision} ORDER BY r.version DESC`).all(id);
 const movement=describeMovements(db);
 return groupDailyEdits(rows.map(row=>({...row,movement:movement(row)})),()=>id);
}
