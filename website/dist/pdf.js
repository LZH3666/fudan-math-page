import {safeHref,safePDF} from './tex.js';
let libraryPromise;
const active=new Map();
function stopPDF(entry){
 if(entry.stopping)return;entry.cancelled=true;entry.renderTask?.cancel?.();
 // Let an in-flight text stream drain before destroying its message channel.
 entry.stopping=Promise.resolve(entry.operation).catch(()=>{}).then(()=>entry.task?.destroy()).catch(()=>{});
}
export function releasePDFs(){for(const entry of active.values())stopPDF(entry);active.clear()}
// Drain text via getReader for browsers without ReadableStream async iteration.
export async function readPDFText(page,isCurrent=()=>true){
 const reader=page.streamTextContent().getReader(),chunks=[];
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)return isCurrent()?chunks.join(' '):'';
   if(isCurrent())chunks.push((value.items||[]).map(item=>item.str||'').join(' '));
  }
  return '';
 }finally{
  reader.releaseLock();
 }
}
const loadLibrary=()=>libraryPromise??=import('/pdfjs/build/pdf.mjs');
export async function renderPDF(container,url,isCurrent=()=>true,getLibrary=loadLibrary){
 const previous=active.get(container);if(previous)stopPDF(previous);
 const entry={cancelled:false,task:null,operation:null,renderTask:null};active.set(container,entry);
 const live=()=>!entry.cancelled&&active.get(container)===entry&&container.isConnected&&isCurrent();
 container.replaceChildren();
 const download=document.createElement('a');download.href=url;download.target='_blank';download.rel='noopener';download.textContent='打开 / 下载 PDF';
 const status=document.createElement('p');status.textContent='正在加载排版结果…';status.setAttribute('role','status');container.append(download,status);
 try{
  const library=await getLibrary();if(!live())return;
  library.GlobalWorkerOptions.workerSrc='/pdfjs/build/pdf.worker.mjs';
  const task=library.getDocument({url,isEvalSupported:false,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/',useWasm:false});entry.task=task;const pdf=await task.promise;
  if(!live())return;

  for(let number=1;number<=Math.min(pdf.numPages,50);number++){
   if(!live())return;
   const page=await pdf.getPage(number);if(!live())return;const base=page.getViewport({scale:1});
   const width=Math.min(container.clientWidth||700,1000),viewport=page.getViewport({scale:width/base.width}),ratio=Math.min(devicePixelRatio||1,2);
   const wrapper=document.createElement('div');wrapper.className='pdf-page';wrapper.dataset.pdfPage=number;wrapper.style.aspectRatio=base.width+'/'+base.height;
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.setAttribute('aria-label','第 '+number+' 页排版结果');wrapper.append(canvas);
   entry.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});
   entry.operation=entry.renderTask.promise;await entry.operation;entry.renderTask=null;
   if(!live())return;container.append(wrapper);
   // Optional text and link metadata must not erase rendered pages.
   try{entry.operation=readPDFText(page,live);const text=await entry.operation;if(!live())return;const plain=document.createElement('p');plain.className='sr-only';plain.textContent=text;wrapper.append(plain)}catch{if(!live())return}
   try{for(const item of await page.getAnnotations()){
    if(!live())return;if(item.subtype!=='Link')continue;
    const target=safeHref(item.url||item.unsafeUrl||'');
    if(!target&&!item.dest)continue;
    const a=document.createElement('a'),rect=[...viewport.convertToViewportPoint(item.rect[0],item.rect[1]),...viewport.convertToViewportPoint(item.rect[2],item.rect[3])];
    a.className='pdf-link';a.style.left=(Math.min(rect[0],rect[2])/viewport.width*100)+'%';a.style.top=(Math.min(rect[1],rect[3])/viewport.height*100)+'%';a.style.width=(Math.abs(rect[2]-rect[0])/viewport.width*100)+'%';a.style.height=(Math.abs(rect[3]-rect[1])/viewport.height*100)+'%';
    a.setAttribute('aria-label',target||'跳转到公式或章节');
    if(target){a.href=target;if(!target.startsWith('#')){a.target='_blank';a.rel='noopener noreferrer'}}
    else{a.href='#';a.onclick=async ev=>{ev.preventDefault();const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;if(!dest)return;const index=typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]);container.querySelector('[data-pdf-page="'+(index+1)+'"]')?.scrollIntoView({block:'start'})}}
    wrapper.append(a);
   }}catch{if(!live())return}
  }
  if(!live())return;if(pdf.numPages>50)status.textContent='已显示前 50 页，可打开完整 PDF。';else status.remove();
 }catch{if(live())status.textContent='当前浏览器无法完整显示，请点击上方“打开 / 下载 PDF”查看。'}finally{if(!live())stopPDF(entry)}
}


export function renderEmbeddedPDFs(root){for(const node of root.querySelectorAll('[data-pdf]')){const url=safePDF(node.dataset.pdf);if(url)renderPDF(node,url)}}
