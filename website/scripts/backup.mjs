import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBackup,verifyBackup,restoreBackup,pruneBackups} from '../backup.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(process.env.FUDAN_DATA_DIR||path.join(root,'data'));
const dbPath=path.resolve(process.env.FUDAN_DB||path.join(dataDir,'library.sqlite'));
const backupRoot=path.resolve(process.env.FUDAN_BACKUP_ROOT||path.join(dataDir,'backups','managed'));
const [command,...args]=process.argv.slice(2);
try{
 if(command==='create'&&!args.length){
  const out=await createBackup({dbPath,dataDir,backupRoot,runtime:{compileMode:process.env.FUDAN_COMPILE_MODE,image:process.env.FUDAN_TEX_IMAGE}});
  console.log(JSON.stringify({directory:out.directory,files:out.manifest.files.length,tables:out.manifest.tables},null,2));
 }else if(command==='verify'&&args.length===1){
  const m=verifyBackup(args[0]);console.log(JSON.stringify({ok:true,id:m.id,files:m.files.length,tables:m.tables},null,2));
 }else if(command==='restore'&&args.length===2)console.log(JSON.stringify(restoreBackup(...args),null,2));
 else if(command==='prune'&&(args.length===0||args.length===1&&args[0]==='--apply')){
  console.log(JSON.stringify(pruneBackups(backupRoot,{days:Number(process.env.FUDAN_BACKUP_DAYS||7),minKeep:Number(process.env.FUDAN_BACKUP_MIN_KEEP||7),apply:args[0]==='--apply'}),null,2));
 }else throw Error('用法：backup.mjs create | verify <备份目录> | restore <备份目录> <新目录> | prune [--apply]');
}catch(e){console.error('备份操作未完成：'+e.message);process.exitCode=1}
