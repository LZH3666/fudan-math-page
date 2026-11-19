import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
export async function withImportLock(file,action,{timeoutMs=10000,pollMs=100}={}){
 const started=Date.now();let handle;
 while(handle===undefined){
  try{handle=fs.openSync(file,'wx',0o600)}catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()-started>=timeoutMs)throw Error('Another local course import is active; existing outputs preserved');await delay(pollMs)}
 }
 try{fs.writeFileSync(handle,String(process.pid));return await action()}
 finally{fs.closeSync(handle);fs.unlinkSync(file)}
}
