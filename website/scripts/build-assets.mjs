import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const moduleReferences=text=>[...text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^'";\n]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map(m=>m[1]||m[2]);
export function buildAssets(site){
 const dist=path.join(site,'dist'),inputs=new Map(),outputs=new Map();
 function collect(name){
  if(inputs.has(name))return;
  const file=path.resolve(dist,name);if(!file.startsWith(dist+path.sep))throw Error('Asset outside dist');
  const source=fs.readFileSync(file,'utf8');inputs.set(name,Buffer.from(source));
  for(const ref of moduleReferences(source))collect(path.posix.normalize(path.posix.join(path.posix.dirname(name),ref.split('?')[0])));
 }
 collect('app.js');collect('style.css');
 const fitness=fs.readFileSync(path.join(dist,'course-atlas/data/fitness.json'));JSON.parse(fitness);
 outputs.set('data/fitness.json',fitness);
 function vendor(folder,destination){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const input=path.join(folder,item.name),output=destination+'/'+item.name;if(item.isSymbolicLink())throw Error('Symlink in assets');if(item.isDirectory())vendor(input,output);else outputs.set(output,fs.readFileSync(input))}}
 const katex=path.join(site,'node_modules/katex/dist');
 for(const name of ['katex.min.css','katex.min.js'])outputs.set('vendor/'+name,fs.readFileSync(path.join(katex,name)));
 vendor(path.join(katex,'fonts'),'vendor/fonts');
 const pdf=path.join(site,'node_modules/pdfjs-dist');
 for(const name of ['pdf.mjs','pdf.worker.mjs'])outputs.set('pdfjs/build/'+name,fs.readFileSync(path.join(pdf,'build',name)));
 for(const name of ['cmaps','standard_fonts','wasm'])vendor(path.join(pdf,name),'pdfjs/'+name);
 const indexBytes=fs.readFileSync(path.join(dist,'course-atlas/data/catalog-index.json')),indexHash=sha(indexBytes);
 const indexName='catalog-index.'+indexHash+'.json';
 const versionedIndex=path.join(dist,'course-atlas/data',indexName);
 if(fs.existsSync(versionedIndex)){if(!fs.readFileSync(versionedIndex).equals(indexBytes))throw Error('Immutable course index differs')}else fs.writeFileSync(versionedIndex,indexBytes,{flag:'wx'});
 for(const [name,bytes] of inputs){
  let text=bytes.toString();
  for(const ref of moduleReferences(text))text=text.replaceAll("'"+ref+"'","'"+ref.split('?')[0]+"'").replaceAll('"'+ref+'"','"'+ref.split('?')[0]+'"');
  if(name==='course-loader.mjs')text=text.replace("'catalog-index.json'",JSON.stringify(indexName));
  if(name==='pdf.js')text=text.replaceAll("'/pdfjs/","'@@PUBLIC_ROOT@@/pdfjs/");
  if(name==='fitness.js')text=text.replace("'/course-atlas/data/fitness.json'","'@@PUBLIC_ROOT@@/data/fitness.json'");
  outputs.set(name,Buffer.from(text));
 }
 const version=sha(Buffer.concat([...outputs].sort(([a],[b])=>a.localeCompare(b)).flatMap(([name,bytes])=>[Buffer.from(name+'\0'+bytes.length+'\0'),bytes])));
 const prefix='/assets-version/'+version,folder=path.join(dist,'assets-version',version);
 const files={};
 for(const [name,raw] of outputs){const bytes=/\.(?:js|mjs|css)$/.test(name)?Buffer.from(raw.toString().replaceAll('@@PUBLIC_ROOT@@',prefix)):raw,target=path.join(folder,name);fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target)){if(!fs.readFileSync(target).equals(bytes))throw Error('Immutable asset differs: '+name)}else fs.writeFileSync(target,bytes,{flag:'wx'});files['assets-version/'+version+'/'+name]={sha256:sha(bytes),bytes:bytes.length}}
 const htmlFile=path.join(dist,'index.html');let html=fs.readFileSync(htmlFile,'utf8');
 html=html.replace(/href="(?:style\.css\?v=[^"\s]+|\/assets-version\/[a-f0-9]+\/style\.css)"/,`href="${prefix}/style.css"`).replace(/src="(?:app\.js\?v=[^"\s]+|\/assets-version\/[a-f0-9]+\/app\.js)"/,`src="${prefix}/app.js"`);
 html=html.replace(/(?:\/vendor\/|\/assets-version\/[a-f0-9]+\/vendor\/)(katex\.min\.(?:css|js))/g,`${prefix}/vendor/$1`);
 if(fs.readFileSync(htmlFile,'utf8')!==html){const temp=htmlFile+'.building';fs.writeFileSync(temp,html);fs.renameSync(temp,htmlFile)}
 const report={schema_version:1,version,index:indexName,sourceHashes:Object.fromEntries([...inputs].map(([name,bytes])=>[name,sha(bytes)])),dataHashes:{'course-atlas/data/fitness.json':sha(fitness)},files};
 fs.writeFileSync(path.join(dist,'asset-build.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify({version:buildAssets(fileURLToPath(new URL('..',import.meta.url))).version}));
