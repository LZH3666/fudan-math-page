import {parentPort} from 'node:worker_threads';
import {bitsetDiff} from './bitset-diff.mjs';
import {textDiff} from './dist/text-diff.js';
parentPort.on('message',({key,oldText,newText,timeout})=>{
 try{parentPort.postMessage({key,result:textDiff(oldText,newText,{timeout,characterDiff:timeout>250?bitsetDiff:null})})}
 catch{parentPort.postMessage({key,result:{status:'incomplete',exact:false,added:null,removed:null,changed:null,parts:null}})}
});
