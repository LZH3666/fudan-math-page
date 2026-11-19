import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {officialDocuments} from '../dist/official-documents.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),input=args.includes('--sources')?path.resolve(args[args.indexOf('--sources')+1]):null;
const remote=input?JSON.parse(fs.readFileSync(input,'utf8')):[];
const sources=new Map(remote.map(r=>[r.href,r]));
const extractionFile=path.join(root,'website/content/other-functions/extractions.json');
const extractions=new Map((fs.existsSync(extractionFile)?JSON.parse(fs.readFileSync(extractionFile,'utf8')):[]).map(r=>[r.href,r]));
const verifiedFile=(relative,expected)=>{const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))throw Error('Source outside workspace');const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Extraction source hash mismatch');return bytes;};
const documents=officialDocuments.map(d=>{
 const result={href:d.href,pages:[],status:'unavailable',reason:d.access==='login'?'需学校登录，未收录正文':'暂未收录正文'};
 if(d.href.startsWith('/course-atlas/')&&/\.pdf$/.test(d.href)){
  const file=path.join(root,'website/dist',d.href);const bytes=fs.readFileSync(file);
  const text=execFileSync('pdftotext',['-layout','-enc','UTF-8',file,'-'],{encoding:'utf8',maxBuffer:16*1024*1024});
  result.pages=text.split('\f').map((text,i)=>({page:i+1,text:text.replace(/\r/g,'').trim()})).filter(p=>p.text);
  result.sha256=createHash('sha256').update(bytes).digest('hex');result.type='pdf';
 }else if(extractions.has(d.href)){
  const extraction=extractions.get(d.href);verifiedFile(extraction.sourcePath,extraction.sourceSha256);
  const text=verifiedFile(extraction.textPath,extraction.textSha256).toString('utf8').trim();if(!text)throw Error('Empty extracted body');
  result.pages=[{page:null,text}];result.sha256=extraction.sourceSha256;result.type='extracted';result.method=extraction.method;
 }else{
  const source=sources.get(d.href);
  if(source?.path&&source.mime?.includes('html')){
   const file=path.resolve(root,source.path);if(!file.startsWith(root+path.sep))throw Error('Source outside workspace');
   const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error('Source hash mismatch');
   const dom=new JSDOM(bytes.toString('utf8')),article=dom.window.document.querySelector('.wp_articlecontent');
   if(article){article.querySelectorAll('script,style,form,iframe,object,embed,nav').forEach(el=>el.remove());article.querySelectorAll('p,div,li,tr,br').forEach(el=>el.append('\n'));const text=article.textContent.replace(/[\t\u00a0 ]+/g,' ').replace(/\n\s*\n/g,'\n').trim();if(text.length>=30)result.pages=[{page:null,text}];}
   result.sha256=source.sha256;result.type='html';dom.window.close();
  }
 }
 if(result.pages.length){result.status='indexed';delete result.reason;}
 return result;
});
const output={version:1,generated:new Date().toISOString(),documents};
fs.writeFileSync(path.join(root,'website/dist/course-atlas/data/document-search.json'),JSON.stringify(output));
console.log(JSON.stringify({documents:documents.length,indexed:documents.filter(d=>d.status==='indexed').length,pages:documents.reduce((n,d)=>n+d.pages.length,0),bytes:Buffer.byteLength(JSON.stringify(output))}));
