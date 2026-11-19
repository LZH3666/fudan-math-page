import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {officialDocuments} from '../dist/official-documents.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=(root,name)=>fs.readFileSync(path.join(root,name));
const json=(root,name)=>JSON.parse(read(root,name));
export function assertPublicPath(name){
 const checked=String(name).replace('dist/course-atlas/data/','dist/course-atlas/public/').replace('banana-runtime/data/','banana-runtime/public/').replace(/^dist\/assets-version\/[a-f0-9]{64}\/data\/fitness\.json$/,'dist/public-fitness.json');
 if(!name||path.isAbsolute(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||/(?:sqlite|\.db(?:$|-)|\.env|(?:^|\/)(?:private|credentials|sessions|tokens|backups|data|guide-files|mail-outbox)(?:\/|$))/i.test(checked))throw Error('Forbidden release file: '+name);
 if(!/^(?:dist\/|scripts\/[^/]+\.mjs$|content\/other-functions\/(?:posts\.json|guide-202605\.pdf)$|banana-runtime\/(?:scripts\/|layouts\/|assets\/|static\/|i18n\/|data\/|hugo\.toml$|LICENSE$|package(?:-lock)?\.json$)|[^/]+\.mjs$|package(?:-lock)?\.json$)/.test(name))throw Error('Not on release allowlist: '+name);
}
export function checkRelease(site){
 const assets=json(site,'dist/asset-build.json'),catalog=json(site,'dist/course-atlas/data/catalog-build.json');
 const verify=(name,hash)=>{if(sha(read(site,name))!==hash)throw Error('Stale or damaged release file: '+name)};
 for(const [name,hash] of Object.entries(assets.sourceHashes))verify('dist/'+name,hash);
 if(!assets.dataHashes?.['course-atlas/data/fitness.json'])throw Error('Missing fitness data in asset build');
 for(const [name,hash] of Object.entries(assets.dataHashes))verify('dist/'+name,hash);
 for(const [name,record] of Object.entries(assets.files)){
  verify('dist/'+name,record.sha256);
  const relative=name.split('/').slice(2).join('/');
  if(relative.startsWith('vendor/'))verify('node_modules/katex/dist/'+relative.slice(7),record.sha256);
  if(relative.startsWith('pdfjs/'))verify('node_modules/pdfjs-dist/'+relative.slice(6),record.sha256);
 }
 for(const [name,hash] of Object.entries(catalog.sourceHashes))verify('dist/course-atlas/data/'+name,hash);
 const links=new Set();
 for(const [name,record] of Object.entries(catalog.files)){
  verify('dist/course-atlas/data/'+name,record.sha256);
  if(name.startsWith('courses/'))for(const syllabus of json(site,'dist/course-atlas/data/'+name).syllabi||[])links.add(syllabus.href);
 }
 for(const link of links){if(!/^(?:syllabi|assets)\/[a-zA-Z0-9_./-]+$/.test(link)||link.includes('..'))throw Error('Invalid syllabus link');read(site,'dist/course-atlas/'+link)}
 const index=json(site,'dist/course-atlas/data/'+assets.index),stable=read(site,'dist/course-atlas/data/catalog-index.json');
 if(!read(site,'dist/course-atlas/data/'+assets.index).equals(stable))throw Error('Versioned course index is stale');
 for(const row of index.scope){if(!catalog.files[row.detail])throw Error('Missing course detail: '+row.id)}
 const html=read(site,'dist/index.html').toString();
 for(const name of ['app.js','style.css','vendor/katex.min.js','vendor/katex.min.css'])if(!html.includes('/assets-version/'+assets.version+'/'+name))throw Error('HTML does not reference current assets');
 for(const doc of officialDocuments)if(doc.href.startsWith('/course-atlas/'))read(site,'dist/'+doc.href.slice(1));
 const posts=json(site,'content/other-functions/posts.json');
 for(const post of posts.posts||[])for(const file of post.files||[]){const name=file.path.replace(/^website\//,'');assertPublicPath(name);read(site,name)}
 const files=[];
 function walk(folder,relative){for(const item of fs.readdirSync(folder,{withFileTypes:true})){
  const name=relative+'/'+item.name,full=path.join(folder,item.name);if(item.isSymbolicLink())throw Error('Symlink in release: '+name);
  if(item.isDirectory())walk(full,name);else{if(name==='dist/course-atlas/assets/guide-202605.pdf')continue;assertPublicPath(name);files.push(name)}
 }}
 walk(path.join(site,'dist'),'dist');
 for(const name of ['scripts','layouts','assets','static','i18n','data'])walk(path.join(site,'banana-runtime',name),'banana-runtime/'+name);
 for(const name of ['hugo.toml','LICENSE','package.json','package-lock.json'])files.push('banana-runtime/'+name);
 for(const entry of fs.readdirSync(site,{withFileTypes:true}))if(entry.isFile()&&(/\.mjs$/.test(entry.name)||/^package(?:-lock)?\.json$/.test(entry.name)))files.push(entry.name);
 // Only runtime maintenance scripts are bundled, never local content collectors.
 for(const name of ['admin.mjs','backup.mjs','import-guide-posts.mjs','build-course-catalog.mjs','build-assets.mjs','check-release.mjs'])files.push('scripts/'+name);
 files.push('content/other-functions/posts.json');
 files.push('content/other-functions/guide-202605.pdf');
 for(const name of files)assertPublicPath(name);
 return {schema_version:1,assetVersion:assets.version,courses:index.scope.length,files:Object.fromEntries(files.sort().map(name=>{const bytes=read(site,name);return [name,{sha256:sha(bytes),bytes:bytes.length}]}))};
}
export function prepareRelease(site,out){
 const report=checkRelease(site);
 if(fs.existsSync(out))throw Error('Release output must be a new directory');
 fs.mkdirSync(out,{recursive:true});
 for(const name of Object.keys(report.files)){const target=path.join(out,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(site,name),target);if(sha(read(out,name))!==report.files[name].sha256)throw Error('Copy verification failed: '+name)}
 fs.writeFileSync(path.join(out,'release-manifest.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const site=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2),at=args.indexOf('--out');
 const report=at>=0?prepareRelease(site,path.resolve(args[at+1])):checkRelease(site);
 console.log(JSON.stringify({checked:true,files:Object.keys(report.files).length,courses:report.courses,assetVersion:report.assetVersion}));
}
