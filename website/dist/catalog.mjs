export const universityMathSubjectId='university-math';
export const csSubjectId='cs';

export const courseCollections=[
 {id:'major',title:'数学科学学院',path:'/catalog/major/math'},
 {id:'general',title:'大学数学',path:'/subject/'+universityMathSubjectId},
 {id:'cs',title:'CS',path:'/subject/'+csSubjectId},
 ...[
  ['physics','物理系'],['natural-sciences','自然科学基础课'],
  ['data-science','大数据学院'],['economics','经济学院'],['management','管理学院'],
  ['ideology','思政'],['general-education','七模通识'],['electronics','电子信息专业课']
 ].map(([id,title])=>({id,title,path:'/subject/'+id}))
];
export const isCourseCollectionSubject=subjectId=>courseCollections.some(c=>c.path==='/subject/'+subjectId);

export function hideExamContents(course,document,documents=[]){
 if(!course||!document||!isCourseCollectionSubject(course.subject))return false;
 if(/^collected-[a-f0-9]+$/.test(document.id||''))return true;
 const byId=new Map(documents.map(item=>[item.id,item]));
 let page=document;const seen=new Set();
 while(page&&!seen.has(page.id)){
  seen.add(page.id);
  if(/试卷|试题|考试|期中|期末/.test(page.title||''))return true;
  page=byId.get(page.parent_id);
 }
 return false;
}

export function professionalSubjects(subjects){
 return subjects.filter(subject=>!isCourseCollectionSubject(subject.id)&&subject.title!=='非数学系数学课程');
}

export function collectionForSubject(subjectId){
 return courseCollections.find(c=>c.path==='/subject/'+subjectId)?.id||'major';
}

// Preserve bookmarks when the two imported volumes are merged into one course.
export function resolveMathBRoute(parts,courses){
 const merged=courses.some(c=>c.id==='university-math-analysis-bi'&&c.title==='数学分析B')&&!courses.some(c=>c.id==='university-math-analysis-bii');
 if(!merged)return parts;
 const next=[...parts];
 if(['course','read','new'].includes(next[0])&&next[1]==='university-math-analysis-bii')next[1]='university-math-analysis-bi';
 if(next[0]==='doc'&&next[1]==='university-math-analysis-bii-home')next[1]='university-math-analysis-bi-home';
 return next;
}

const treeNode=(id,title,path,children=[],index=null)=>({id,title,path,children,index});

export function catalogNavigation(scope,subjects=[],selected=''){
 const math=()=>treeNode('math','数学科学学院','/catalog/major/math',['math','major'].includes(scope)
  ?professionalSubjects(subjects).map((subject,index)=>treeNode(subject.id,subject.title,'/subject/'+subject.id,[],index+1)).filter(node=>!selected||node.id===selected)
  :[]);
 const flat=courseCollections.filter(c=>c.id!=='major').map(c=>treeNode(c.path.slice('/subject/'.length),c.title,c.path));
 const root=children=>treeNode('home','课程资料','/',children);

 if(scope==='major')return [root([math()])];
 const collection=courseCollections.find(c=>c.id===scope&&c.id!=='major');
 if(collection)return [root([flat.find(c=>c.path===collection.path)])];
 if(scope==='math')return [root([math()])];
 return [math(),...flat];
}
