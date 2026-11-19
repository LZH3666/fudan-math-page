import {randomUUID} from 'node:crypto';
export const initialSubjects=[
 ['analysis','分析与微分方程'],['algebra','代数'],['geometry','几何'],['topology','拓扑'],['ag','代数几何'],['number-representation','数论与表示论'],['probability','概率与统计'],['mathematical-physics','数学物理'],['applied','应用数学'],['computational','计算数学'],['optimization-control','运筹学与控制论'],['exams','试题荟萃'],['university-math','大学数学'],['cs','CS'],
 ['physics','物理系'],['natural-sciences','自然科学基础课'],['data-science','大数据学院'],['economics','经济学院'],['management','管理学院'],['ideology','思政'],['general-education','七模通识'],['electronics','电子信息专业课']
].map(([id,title],position)=>({id,title,position}));
export function migratePages(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  const add=(table,name,definition)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition)};
  db.exec("CREATE TABLE IF NOT EXISTS subjects(id TEXT PRIMARY KEY,title TEXT NOT NULL,position INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS subject_history(id INTEGER PRIMARY KEY,subject_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL);CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);");
  const subjectSeed=db.prepare('INSERT OR IGNORE INTO subjects(id,title,position) VALUES(?,?,?)');
  initialSubjects.forEach(s=>subjectSeed.run(s.id,s.title,s.position));
  add('courses','home_id','TEXT');
  for(const table of ['documents','revisions']){
   add(table,'parent_id','TEXT');
   add(table,'preamble',"TEXT NOT NULL DEFAULT ''");
   add(table,'render_mode',"TEXT NOT NULL DEFAULT 'web'");
   add(table,'artifact',"TEXT NOT NULL DEFAULT ''");
  }
  add('documents','is_course_home','INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS legacy_sources(document_id TEXT PRIMARY KEY REFERENCES documents(id),source_title TEXT NOT NULL,url TEXT NOT NULL,source_hash TEXT NOT NULL,license TEXT NOT NULL,imported_version INTEGER NOT NULL,compile_error TEXT NOT NULL DEFAULT '');`);
  add('revisions','archived','INTEGER NOT NULL DEFAULT 0');
  if(!db.prepare("SELECT 1 FROM settings WHERE key='flexible-pages-v1'").get()){
   db.prepare("UPDATE courses SET subject='topology' WHERE subject='geometry' AND id IN ('topology','algebraic-topology')").run();
   db.prepare("UPDATE courses SET subject='computational' WHERE subject='applied' AND id IN ('numerical','scientific')").run();
   db.prepare("UPDATE courses SET subject='optimization-control' WHERE subject='applied' AND id='optimization'").run();
   for(const c of db.prepare('SELECT * FROM courses').all()){
    const id=randomUUID();
    db.prepare("INSERT INTO documents(id,course_id,type,title,tex,version,position,updated,is_course_home) VALUES(?,?,'page',?,'',0,0,?,1)").run(id,c.id,c.title,new Date().toISOString());
    db.prepare('UPDATE courses SET home_id=? WHERE id=?').run(id,c.id);
    db.prepare('UPDATE documents SET parent_id=? WHERE course_id=? AND id<>? AND parent_id IS NULL').run(id,c.id,id);
    db.prepare('UPDATE revisions SET parent_id=? WHERE document_id IN (SELECT id FROM documents WHERE course_id=? AND is_course_home=0) AND parent_id IS NULL').run(id,c.id);
   }
   db.prepare('INSERT INTO settings VALUES(?,?)').run('flexible-pages-v1','1');
  }
  db.exec('COMMIT');
 }catch(err){db.exec('ROLLBACK');throw err}
}

