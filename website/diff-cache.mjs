import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {DIFF_VERSION} from './dist/text-diff.js';

// Disposable derived data; source revisions are never modified.
export function createDiffCache(db){
 db.exec(`CREATE TABLE IF NOT EXISTS text_diff_cache(
  key TEXT PRIMARY KEY,algorithm TEXT NOT NULL,status TEXT NOT NULL,
  added INTEGER,removed INTEGER,changed INTEGER,parts TEXT);
  CREATE TABLE IF NOT EXISTS revision_diff_stats(
  revision_id INTEGER PRIMARY KEY,cache_key TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS revision_diff_cache_key ON revision_diff_stats(cache_key);`);
 const get=db.prepare('SELECT * FROM text_diff_cache WHERE key=? AND algorithm=?');
 const put=db.prepare('INSERT OR REPLACE INTO text_diff_cache VALUES(?,?,?,?,?,?,?)');
 const map=db.prepare('INSERT OR REPLACE INTO revision_diff_stats VALUES(?,?)');
 const revision=db.prepare('SELECT id,document_id,version,tex FROM revisions WHERE id=?');
 const previous=db.prepare('SELECT id,tex FROM revisions WHERE document_id=? AND version<? ORDER BY version DESC LIMIT 1');
 const keyFor=(a,b)=>createHash('sha256').update(DIFF_VERSION+'\0').update(String(a.length)+':').update(a,'utf16le').update(b,'utf16le').digest('hex');
 const prune=db.prepare(`DELETE FROM text_diff_cache WHERE rowid IN (
  SELECT c.rowid FROM text_diff_cache c WHERE NOT EXISTS(SELECT 1 FROM revision_diff_stats m WHERE m.cache_key=c.key)
  ORDER BY c.rowid DESC LIMIT -1 OFFSET 128)`);
 const pending={status:'pending',exact:false,added:null,removed:null,changed:null,parts:null};
 const decode=row=>row?{status:row.status,exact:row.status==='complete',added:row.added,removed:row.removed,changed:row.changed,parts:row.parts?JSON.parse(row.parts):null}:null;
 let worker=null,active=null,timer=null,retryTimer=null,closed=false,scheduled=false,highest=0;
 const jobs=new Map(),urgent=[],background=[],revisions=[],waiters=[];
 const idle=()=>!active&&!jobs.size&&!revisions.length;
 function refresh(){
  if(closed)return;
  const rows=db.prepare('SELECT id FROM revisions WHERE id>? ORDER BY id DESC').all(highest);
  if(rows.length){highest=rows[0].id;revisions.unshift(...rows.map(r=>r.id));schedule()}
 }
 function schedule(){if(closed||scheduled)return;scheduled=true;setImmediate(()=>{scheduled=false;pump()})}
 const busy=e=>e?.code==='ERR_SQLITE_ERROR'&&[5,6].includes((e.errcode||0)&255);
 function retry(){if(closed||retryTimer)return;retryTimer=setTimeout(()=>{retryTimer=null;schedule()},250)}
 function finish(result){
  if(!active)return;
  clearTimeout(timer);timer=null;
  const job=active;
  if(result.status!=='complete'&&job.timeout===250){active=null;job.timeout=15000;background.push(job.key)}
  else{
   try{
    put.run(job.key,DIFF_VERSION,result.status==='incomplete'?'exhausted':result.status,result.added,result.removed,result.changed,result.parts?JSON.stringify(result.parts):null);
    prune.run();jobs.delete(job.key);active=null;
   }catch(e){if(!busy(e))throw e;timer=setTimeout(()=>finish(result),250);return}
  }
  schedule();
 }
 function startWorker(){
  const w=new Worker(new URL('./diff-worker.mjs',import.meta.url),{execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128}});worker=w;
  w.on('message',({key,result})=>{if(worker===w&&active?.key===key)finish(result)});
  const failed=()=>{if(worker!==w)return;worker=null;void w.terminate();finish({status:'incomplete',added:null,removed:null,changed:null,parts:null})};
  w.on('error',failed);w.on('exit',code=>{if(code!==0)failed()});return w;
 }
 function enqueue(oldText,newText,priority=false){
  const key=keyFor(oldText,newText),cached=decode(get.get(key,DIFF_VERSION));
  // Legacy incomplete rows predate the exact fallback. A new exhausted run
  // is stored distinctly so repeated reads do not keep retrying the same pair.
  if(cached && cached.status!=='incomplete')return{key,...cached,status:cached.status==='exhausted'?'incomplete':cached.status};
  if(!jobs.has(key)){
   if(jobs.size>=64)return{key,...pending,status:'busy'};
   jobs.set(key,{key,oldText,newText,timeout:cached?15000:250});(priority?urgent:background).push(key);schedule();
  }else if(priority&&active?.key!==key&&!urgent.includes(key))urgent.push(key);
  return{key,...pending};
 }
 function pump(){
  if(closed||active)return;
  let key;
  while(urgent.length&&!key){const k=urgent.shift();if(jobs.has(k))key=k}
  while(background.length&&!key){const k=background.shift();if(jobs.has(k))key=k}
  if(!key&&revisions.length){
   // One source pair per turn, rather than loading all source text in a request.
   const id=revisions.shift();
   try{const r=revision.get(id);if(r){const p=previous.get(r.document_id,r.version),out=enqueue(p?.tex||'',r.tex);map.run(r.id,out.key)}}
   catch(e){if(!busy(e))throw e;revisions.unshift(id);retry();return}
   schedule();return;
  }
  if(!key){for(const resolve of waiters.splice(0))resolve();return}
  active=jobs.get(key);const w=worker||startWorker();
  timer=setTimeout(()=>{if(worker===w){worker=null;void w.terminate();finish({status:'incomplete',added:null,removed:null,changed:null,parts:null})}},active.timeout+2000);
  w.postMessage(active);
 }
 refresh();
 return{
  refresh,
  compare:(a,b)=>enqueue(a,b,true),
  async ready(){refresh();if(!idle())await new Promise(resolve=>{waiters.push(resolve);schedule()})},
  async close(){closed=true;clearTimeout(timer);clearTimeout(retryTimer);const w=worker;worker=null;active=null;jobs.clear();revisions.length=0;for(const resolve of waiters.splice(0))resolve();if(w)await w.terminate()}
 };
}
