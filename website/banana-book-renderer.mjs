import {citationLinks,titleSpacing,subquestionLabels} from './markdown-compat.mjs';
import {equationAnchorIds} from './reader-layout.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';import {parse,stringify} from './banana-runtime/node_modules/yaml/dist/index.js';
const root=path.dirname(fileURLToPath(import.meta.url)),fail=m=>Object.assign(new Error(m),{status:422}),hash=s=>createHash('sha256').update(s).digest('hex');
export function rewriteGroupLinks(html,routes,formulaAnchorsByPage,{id,key,pageId}){
 return html.replace(/<a\b([^>]*?)\bhref="([^"]+)"([^>]*)>([\s\S]*?)<\/a\s*>/g,(all,before,address,after,content)=>{
  const parts=address.split('#'),fragment=parts[1]?decodeURIComponent(parts[1]):'';
  const target=routes.get(parts[0]);
  const targetPage=parts[0]===''?pageId:target;
  if(fragment&&targetPage===pageId&&formulaAnchorsByPage.get(pageId)?.has(fragment)&&!/^https?:/i.test(address))return content;
  if(!target||target==='page'){if(id!=='page'&&address==='/markdown/'+key+'/books/group/')return '<a'+before+'href="/#/course/'+encodeURIComponent(id)+'"'+after+' target="_parent">'+content+'</a>';
   if(/^\/#\/doc\/[a-zA-Z0-9-]+$/.test(address)||/^https?:\/\//.test(address)||/^\/(?:media|compiled)\/[a-f0-9]{64}\.pdf$/.test(address))return '<a'+before+'href="'+address+'"'+after+' target="_parent">'+content+'</a>';
   return all}
  return '<a'+before+'href="/?mdDoc='+encodeURIComponent(target)+'&amp;mdAnchor='+encodeURIComponent(fragment)+'#/doc/'+encodeURIComponent(target)+'"'+after+' target="_parent">'+content+'</a>';
 });
}
export function validateMarkdown(source){
 if(typeof source!=='string'||source.length>200000)throw fail('Markdown源码过长');
 const prose=source.replace(/<!--[\s\S]*?-->/g,'').replace(/(^|\n)(`{3,}|~{3,})tikz[^\n]*\n[\s\S]*?\n\2(?=\s|$)/g,'');
 if(/\\(?:newcommand|renewcommand|def|gdef)\b/.test(prose))throw fail('新版公式不支持自定义宏，请展开为标准写法。');
 if(/\\(?:input|include|write|openout|read|catcode)\b/.test(source))throw fail('不允许TeX文件或外部执行命令。');
 if(/\{\{[<%]|<\s*(?:script|iframe|object|embed|style|link|meta)\b|\bon\w+\s*=|javascript:/i.test(source))throw fail('Markdown包含不允许的主动网页内容。');
}
let queue=Promise.resolve(),pending=0;
const run=(cwd,args,env,timeout)=>new Promise((resolve,reject)=>{let log='';const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe'],windowsHide:true});const timer=setTimeout(()=>{child.kill();reject(fail('Markdown排版超时；原版本未改变。'))},timeout);for(const stream of [child.stdout,child.stderr])stream.on('data',b=>log=(log+b).slice(-9000));child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);code===0?resolve(log):reject(fail('Markdown排版失败；原版本未改变：'+log))})});
function splitFrontMatter(source){if(!source.startsWith('---\n')&&!source.startsWith('---\r\n'))return{metadata:{},body:source};const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);if(!match)throw fail('页面信息未闭合');let data;try{data=parse(match[1])}catch{throw fail('页面信息YAML格式不正确')}if(!data||typeof data!=='object'||Array.isArray(data))throw fail('页面信息必须是字段映射');const allowed=['title','aliases','sort','notices','navboxes','numbering','typography','lang'];for(const k of Object.keys(data))if(!allowed.includes(k))throw fail('此课程页面不支持页面信息字段：'+k);return{metadata:data,body:source.slice(match[0].length)}}
export function createMarkdownRenderer(dataDir){
 const output=path.resolve(dataDir,'markdown'),jobs=path.resolve(dataDir,'.markdown-jobs');
 async function renderGroup(pages,{id='group',title='讲义',numbering}={}){
  if(!Array.isArray(pages)||!pages.length||pages.length>1000)throw fail('讲义页面数量不正确');
  const sorted=pages.map(p=>({...p})).sort((a,b)=>(a.position||0)-(b.position||0)||a.id.localeCompare(b.id)),ids=new Set();
  for(const p of sorted){if(typeof p.id!=='string'||ids.has(p.id))throw fail('讲义页面ID重复');ids.add(p.id);validateMarkdown(p.tex)}
  for(const p of sorted)if(p.parent_id&&!ids.has(p.parent_id))throw fail('讲义上级页面不存在');
  const data=sorted.map(p=>({id:p.id,title:p.title,parent_id:p.parent_id||null,position:p.position||0,tex:p.tex,numbering:p.numbering}));
  if(sorted.reduce((n,p)=>n+p.tex.length,0)>12000000)throw fail('讲义总源码过长');
  const recipeParts=[fs.readFileSync(path.join(root,'isolated-diagram.mjs')),fs.readFileSync(path.join(root,'markdown-compat.mjs'))];
  if(sorted.some(p=>/\r|^ {0,3}\[\^[^\]\r\n]+\]:/m.test(p.tex)))recipeParts.push(fs.readFileSync(path.join(root,'banana-runtime','scripts','prebuild','lists.mjs')));
  const recipe=hash(Buffer.concat(recipeParts));
  const key=hash('banana-group-v9\0'+recipe+'\0'+JSON.stringify({id,title,numbering,pages:data})),destination=path.join(output,key),manifestFile=path.join(destination,'bundle.json');
  const cached=()=>fs.existsSync(path.join(destination,'.complete'))&&fs.existsSync(manifestFile);
  if(!cached()){if(pending>=5)throw fail('排版队列已满，请稍后重试');pending++;const task=queue.then(async()=>{
   if(cached())return;fs.mkdirSync(jobs,{recursive:true});fs.mkdirSync(output,{recursive:true});const job=path.join(jobs,randomUUID()),runtime=path.join(root,'banana-runtime');fs.mkdirSync(job);
   try{
    for(const item of ['scripts','layouts','assets','static','i18n','data'])fs.cpSync(path.join(runtime,item),path.join(job,item),{recursive:true});for(const item of ['hugo.toml','package.json'])fs.copyFileSync(path.join(runtime,item),path.join(job,item));
    fs.symlinkSync(path.join(runtime,'node_modules'),path.join(job,'node_modules'),process.platform==='win32'?'junction':'dir');
    const content=path.join(job,'content','books','group');fs.mkdirSync(content,{recursive:true});const paths=new Map();
    function locate(p,visiting=new Set()){if(paths.has(p.id))return paths.get(p.id);if(visiting.has(p.id))throw fail('讲义层级有循环');visiting.add(p.id);const parent=p.parent_id&&sorted.find(x=>x.id===p.parent_id),value=(parent?locate(parent,visiting)+path.sep:'')+'p-'+hash(p.id).slice(0,20);paths.set(p.id,value);visiting.delete(p.id);return value}
    for(const p of sorted)locate(p);
    const contents=parent=>sorted.filter(p=>(p.parent_id||null)===parent).map(p=>({page:path.basename(paths.get(p.id)),number:false,...(sorted.some(x=>x.parent_id===p.id)?{children:contents(p.id)}:{})}));
    fs.writeFileSync(path.join(content,'collection.yaml'),stringify({title,contents:contents(null),numbering:numbering||{headings:{prefix:false},theorems:{prefix:false},equations:{prefix:false}}}));fs.writeFileSync(path.join(content,'_index.md'),'---\ntitle: '+JSON.stringify(title)+'\n---\n');
    const anchors=new Map();for(const p of sorted)for(const m of p.tex.matchAll(/<!-- FudanAnchor:([a-zA-Z0-9:_-]+) -->/g)){if(anchors.has(m[1]))throw fail('重复原文锚点');anchors.set(m[1],p.id)}
    for(const p of sorted){const folder=path.join(content,paths.get(p.id));fs.mkdirSync(folder,{recursive:true});const source=splitFrontMatter(p.tex),metadata={...source.metadata,title:titleSpacing(p.title),typography:{convertChineseFullStop:false,...source.metadata.typography},...(p.numbering?{numbering:p.numbering}:{})};const filename=sorted.some(x=>x.parent_id===p.id)?'_index.md':'index.md';fs.writeFileSync(path.join(folder,filename),'---\n'+stringify(metadata)+'---\n\n'+citationLinks(subquestionLabels(source.body)).replace(/<!-- FudanAnchor:([a-zA-Z0-9:_-]+) -->/g,(_,key)=>'FUDANANCHOR'+key.replaceAll('-','Z')+'ENDTOKEN').replace(/\]\(#(l-[a-f0-9]{24})\)/g,(token,label)=>{const owner=anchors.get(label);if(!owner)throw fail('原文引用锚点缺失：'+label);return '](/markdown/'+key+'/books/group/'+paths.get(owner).replaceAll(path.sep,'/')+'/#'+label+')'}))}
    const env={...process.env,PATH:(process.env.FUDAN_HUGO_DIR||path.join(root,'tools','hugo'))+path.delimiter+process.env.PATH,FUDAN_ISOLATED_DIAGRAM_SCRIPT:path.join(root,'isolated-diagram.mjs')};
    const timeout=Math.min(1800000,Math.max(60000,Number(process.env.FUDAN_MARKDOWN_TIMEOUT||600000)));
    await run(job,['scripts/preview.mjs',content,'--whole-collections','--base-url=/markdown/'+key+'/','--output='+destination],env,timeout);
    const prepared=new Map(),formulaAnchorsByPage=new Map();for(const p of sorted){const relative='books/group/'+paths.get(p.id).replaceAll(path.sep,'/')+'/index.html',file=path.join(destination,'public',relative);if(!fs.existsSync(file))throw fail('官方工具没有生成页面：'+p.title);const html=fs.readFileSync(file,'utf8').replace(/FUDANANCHOR([a-zA-Z0-9:_]+)ENDTOKEN/g,(_,label)=>'<span id="'+label.replaceAll('Z','-')+'"></span>');prepared.set(p.id,{file,relative,html});formulaAnchorsByPage.set(p.id,equationAnchorIds(html))}
    const routes=new Map(sorted.map(x=>['/markdown/'+key+'/books/group/'+paths.get(x.id).replaceAll(path.sep,'/')+'/',x.id])),entries={};for(const p of sorted){const page=prepared.get(p.id),html=rewriteGroupLinks(page.html,routes,formulaAnchorsByPage,{id,key,pageId:p.id});fs.writeFileSync(page.file,html);entries[p.id]={path:page.relative,sourceHash:hash(p.tex),title:p.title}}
    fs.writeFileSync(manifestFile,JSON.stringify({format:'fudan-markdown-bundle-v1',key,pages:entries},null,2));fs.writeFileSync(path.join(destination,'.complete'),key);
   }finally{const resolved=path.resolve(job);if(!resolved.startsWith(jobs+path.sep))throw Error('排版任务清理越界');fs.rmSync(resolved,{recursive:true,force:true})}
  });queue=task.catch(()=>{});try{await task}finally{pending--}}
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),results={};
  for(const p of sorted){const item=manifest.pages[p.id],artifact=hash('banana-page-v5\0'+key+'\0'+p.id),folder=path.join(output,artifact),alias=path.join(folder,'public','books','page');
   if(!fs.existsSync(path.join(folder,'.complete'))){fs.mkdirSync(alias,{recursive:true});fs.copyFileSync(path.join(destination,'public',item.path),path.join(alias,'index.html'));fs.writeFileSync(path.join(folder,'bundle-ref.json'),JSON.stringify({format:'fudan-markdown-reference-v1',bundle:key,page:p.id,sourceHash:hash(p.tex)}));fs.writeFileSync(path.join(folder,'.complete'),artifact)}
   results[p.id]={artifact,url:'/markdown/'+artifact+'/books/page/',bundle:key};
  }
  return{bundle:key,pages:results};
 }
 async function render(source,title){const result=await renderGroup([{id:'page',title,tex:source,parent_id:null,position:0}],{id:'page',title});return result.pages.page}
 return{render,renderGroup,output};
}

