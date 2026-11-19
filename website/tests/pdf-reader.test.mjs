import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readPDFText,renderPDF,releasePDFs} from '../dist/pdf.js';

test('real two-page exam text works without ReadableStream async iteration',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(fs.readFileSync(new URL('../content/modern-ode/2024-25秋期末.pdf',import.meta.url))),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
 const pdf=await task.promise,descriptor=Object.getOwnPropertyDescriptor(ReadableStream.prototype,Symbol.asyncIterator);
 try{
  delete ReadableStream.prototype[Symbol.asyncIterator];assert.equal(ReadableStream.prototype[Symbol.asyncIterator],undefined);
  assert.equal(pdf.numPages,2);const text=[];
  for(let i=1;i<=pdf.numPages;i++)text.push(await readPDFText(await pdf.getPage(i)));
  assert.ok(text.every(x=>x.length>100));assert.match(text[0],/Lyapunov/);assert.match(text[1].replace(/\s/g,''),/哈密顿/);
 }finally{if(descriptor)Object.defineProperty(ReadableStream.prototype,Symbol.asyncIterator,descriptor);await task.destroy()}
});

test('stale text extraction drains queued producer messages and releases the reader lock',async()=>{
 let current=true,cancelled=false,released=false,reads=0;
 const page={streamTextContent:()=>({getReader:()=>({read:async()=>{current=false;return ++reads<3?{value:{items:[{str:'stale'}]},done:false}:{done:true}},cancel:async()=>{cancelled=true},releaseLock:()=>{released=true}})})};
 assert.equal(await readPDFText(page,()=>current),'');assert.equal(cancelled,false);assert.equal(reads,3);assert.ok(released);
});

test('leaving a PDF waits for active text extraction before destroying its message channel',async t=>{
 const container=dom(t);let releaseText,destroyed=false;const textPending=new Promise(r=>releaseText=r);
 const source={...fakePage(),streamTextContent:()=>new ReadableStream({async start(controller){await textPending;controller.enqueue({items:[{str:'stale'}]});controller.close()}})};
 const lib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>source}),destroy:async()=>{destroyed=true}})};
 const rendering=renderPDF(container,'/compiled/test.pdf',()=>true,async()=>lib);await new Promise(r=>setImmediate(r));releasePDFs();assert.equal(destroyed,false);releaseText();await rendering;await new Promise(r=>setImmediate(r));assert.equal(destroyed,true);assert.equal(container.children.some(x=>x.className==='sr-only'),false);
});

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.clientWidth=360;this.isConnected=true;this.value=''}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes)}
 remove(){this.parent.children=this.parent.children.filter(x=>x!==this)}
 setAttribute(name,value){this.attributes[name]=value}
 set textContent(value){this.children=[];this.value=value}
 get textContent(){return this.value+this.children.map(x=>x.textContent).join('')}
 getContext(){return {}}
}
function dom(t){const old=globalThis.document,ratio=globalThis.devicePixelRatio;globalThis.document={createElement:tag=>new Element(tag)};globalThis.devicePixelRatio=1;t.after(()=>{releasePDFs();if(old===undefined)delete globalThis.document;else globalThis.document=old;if(ratio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=ratio});return new Element('div')}
const fakePage=()=>({getViewport:({scale})=>({width:500*scale,height:700*scale}),render:()=>({promise:Promise.resolve()}),streamTextContent:()=>new ReadableStream({start(c){c.enqueue({items:[{str:'accessible text'}]});c.close()}}),getAnnotations:async()=>[]});
const library=getPage=>({GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:2,getPage}),destroy:async()=>{}})});

test('optional text/annotation errors retain both rendered pages and direct PDF link',async t=>{
 const container=dom(t);let rendered=0;
 await renderPDF(container,'/compiled/test.pdf',()=>true,async()=>library(async()=>({...fakePage(),render:()=>{rendered++;return{promise:Promise.resolve()}},streamTextContent:()=>{throw Error('Unsupported metadata')},getAnnotations:async()=>{throw Error('Bad annotations')}})));
 assert.equal(rendered,2);assert.equal(container.children.filter(x=>x.className==='pdf-page').length,2);assert.equal(container.children[0].href,'/compiled/test.pdf');assert.doesNotMatch(container.textContent,/无法|Unsupported/);
});

test('library load failure leaves a useful direct PDF link',async t=>{
 const container=dom(t);await renderPDF(container,'/compiled/test.pdf',()=>true,async()=>{throw Error('Import failed')});
 assert.equal(container.children[0].href,'/compiled/test.pdf');assert.match(container.textContent,/打开 \/ 下载 PDF/);assert.match(container.textContent,/当前浏览器无法完整显示/);
});

test('later-page render failure preserves earlier page and download link',async t=>{
 const container=dom(t);await renderPDF(container,'/compiled/test.pdf',()=>true,async()=>library(async n=>({...fakePage(),render:()=>({promise:n===1?Promise.resolve():Promise.reject(Error('Canvas failure'))})})));
 assert.equal(container.children.filter(x=>x.className==='pdf-page').length,1);assert.equal(container.children[0].href,'/compiled/test.pdf');assert.match(container.textContent,/当前浏览器无法完整显示/);
});
