const ratingsSql=`CREATE TABLE atlas_ratings(id TEXT PRIMARY KEY,course_id TEXT NOT NULL,teacher TEXT NOT NULL,term TEXT NOT NULL,offering_id TEXT NOT NULL DEFAULT '',user_id TEXT NOT NULL REFERENCES users(id),grading INTEGER NOT NULL CHECK(grading BETWEEN 1 AND 5),difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),workload INTEGER NOT NULL CHECK(workload BETWEEN 1 AND 5),assessment INTEGER NOT NULL CHECK(assessment BETWEEN 1 AND 5),overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 5),version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL,UNIQUE(course_id,offering_id,teacher,term,user_id))`;
const historySql=`CREATE TABLE atlas_rating_history(id INTEGER PRIMARY KEY,rating_id TEXT NOT NULL REFERENCES atlas_ratings(id),version INTEGER NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),snapshot TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(rating_id,version))`;
export function initializeRatingSchema(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='atlas_ratings'").get()){db.exec(ratingsSql+';'+historySql);return}
 if(db.prepare('PRAGMA table_info(atlas_ratings)').all().some(c=>c.name==='offering_id'))return;
 // Rebuild the old teacher/term uniqueness atomically so parallel classes taught
 // by the same teacher can be rated separately. IDs and history stay unchanged.
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec('CREATE TEMP TABLE saved_atlas_ratings AS SELECT * FROM atlas_ratings; CREATE TEMP TABLE saved_atlas_rating_history AS SELECT * FROM atlas_rating_history; DROP TABLE atlas_rating_history; DROP TABLE atlas_ratings;');
  db.exec(ratingsSql+';'+historySql);
  db.exec("INSERT INTO atlas_ratings(id,course_id,teacher,term,user_id,grading,difficulty,workload,assessment,overall,version,hidden,created,updated) SELECT id,course_id,teacher,term,user_id,grading,difficulty,workload,assessment,overall,version,hidden,created,updated FROM saved_atlas_ratings; INSERT INTO atlas_rating_history SELECT * FROM saved_atlas_rating_history;");
  if(db.prepare('PRAGMA foreign_key_check(atlas_ratings)').all().length||db.prepare('PRAGMA foreign_key_check(atlas_rating_history)').all().length)throw Error('评分迁移引用校验失败');
  db.exec('DROP TABLE saved_atlas_ratings; DROP TABLE saved_atlas_rating_history; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}
