import test from 'node:test';
import assert from 'node:assert/strict';
import {courseCollections,catalogNavigation,collectionForSubject,professionalSubjects,universityMathSubjectId,csSubjectId,resolveMathBRoute} from '../dist/catalog.mjs';
test('各学科大块分别进入独立目录',()=>{
 assert.deepEqual(courseCollections.map(c=>c.title),['数学科学学院','大学数学','CS','物理系','自然科学基础课','大数据学院','经济学院','管理学院','思政','七模通识','电子信息专业课']);
 assert.equal(new Set(courseCollections.map(c=>c.path)).size,11);
 assert.equal(collectionForSubject(universityMathSubjectId),'general');
 assert.equal(collectionForSubject(csSubjectId),'cs');
});
test('数学科学学院保留原板块顺序并排除大学数学与旧非数学系目录',()=>{
 const subjects=[{id:'analysis',title:'分析'},...courseCollections.filter(c=>c.id!=='major').map(c=>({id:c.path.split('/').at(-1),title:c.title})),{id:'algebra',title:'代数'},{id:'legacy',title:'非数学系数学课程'}];
 assert.deepEqual(professionalSubjects(subjects).map(s=>s.id),['analysis','algebra']);
 const [root]=catalogNavigation('math',subjects,'algebra');
 assert.equal(root.title,'课程资料');assert.equal(root.children[0].title,'数学科学学院');
 assert.deepEqual(root.children[0].children.map(n=>[n.id,n.index]),[['algebra',2]]);
});
test('目录层级没有专业课程或通识课程中间层',()=>{
 for(const scope of ['root','math',...courseCollections.map(c=>c.id)]){
  const tree=catalogNavigation(scope);const titles=[];
  const visit=n=>{titles.push(n.title);n.children.forEach(visit)};tree.forEach(visit);
  assert.ok(!titles.includes('专业课程'));assert.ok(!titles.includes('通识课程'));
 }
 assert.deepEqual(catalogNavigation('root').map(n=>[n.title,n.children.length]),courseCollections.map(c=>[c.title,0]));
 assert.deepEqual(catalogNavigation('cs')[0].children.map(n=>[n.title,n.children.length]),[['CS',0]]);
});
test('数学分析B合并后旧课程和主页书签可进入合并课程',()=>{
 const bi='university-math-analysis-bi',bii='university-math-analysis-bii';
 const before=[{id:bi,title:'数学分析BI'},{id:bii,title:'数学分析BII'}],after=[{id:bi,title:'数学分析B'}];
 assert.deepEqual(resolveMathBRoute(['course',bii],before),['course',bii]);
 assert.deepEqual(resolveMathBRoute(['course',bii,'history'],after),['course',bi,'history']);
 assert.deepEqual(resolveMathBRoute(['doc',bii+'-home'],after),['doc',bi+'-home']);
 assert.deepEqual(resolveMathBRoute(['doc','collected-example'],after),['doc','collected-example']);
});
