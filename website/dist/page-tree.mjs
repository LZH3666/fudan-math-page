// Build a page-local tree that mirrors the sidebar hierarchy while starting
// from the page currently being read.
export function orderedPageSubtree(documents, root) {
 if(!root?.id)return [];
 const included=new Set([root.id]);
 const descendants=(parentId,depth)=>documents
  .filter(page=>page.parent_id===parentId&&!included.has(page.id))
  .flatMap(page=>{
   included.add(page.id);
   return [{...page,depth},...descendants(page.id,depth+1)];
  });
 return [{...root,depth:0},...descendants(root.id,1)];
}

// The reader sidebar shows one directory level; other branches are reached via
// the parent/course links rather than recursively expanding the whole course.
export function currentPageDirectory(documents,current){
 if(!current)return {directory:null,parent:null,pages:[]};
 const direct=documents.filter(p=>p.parent_id===current.id&&p.id!==current.id);
 const directory=direct.length?current:documents.find(p=>p.id===current.parent_id)||current;
 const parent=documents.find(p=>p.id===directory.parent_id&&p.id!==directory.id)||null;
 return {directory,parent,pages:documents.filter(p=>p.parent_id===directory.id&&p.id!==directory.id)};
}
