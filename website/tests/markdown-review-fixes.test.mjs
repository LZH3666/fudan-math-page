import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {JSDOM} from '../banana-runtime/node_modules/jsdom/lib/api.js';
import {escapeHtml,renderTex,safeHref} from '../dist/tex.js';
import * as catalog from '../dist/catalog.mjs';
import {tikzRenderer,sharedTikzWorker} from '../banana-runtime/scripts/postbuild/tikz.mjs';
test('actual editor format switch sends empty preamble but retains original value',async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://127.0.0.1:4318/'});let payload;
 const sandbox={document:dom.window.document,window:dom.window,location:dom.window.location,FormData:dom.window.FormData,setTimeout,clearTimeout,URL,Blob,renderTex,e:escapeHtml,safeHref,sourceWithDependencies:()=>'',releasePDFs:()=>{},renderEmbeddedPDFs:()=>{},renderPDF:async()=>{},fetch:async(url,options)=>{payload=JSON.parse(options.body);return{ok:true,json:async()=>({document:{id:'page',is_course_home:false}})}}};
 Object.assign(sandbox,catalog);
 vm.createContext(sandbox);const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').split("document.addEventListener('click'")[0];vm.runInContext(source,sandbox);
 const d={id:'page',title:'原标题',tex:'原正文',preamble:'\\newcommand{\\x}{x}',render_mode:'latex',version:1,position:0,parent_id:'home'};
 sandbox.fixture={course:{id:'course',home_id:'home',title:'课程'},document:d,documents:[{id:'home',parent_id:null,is_course_home:true,title:'课程'},d],isNew:false};
 vm.runInContext("context=fixture;state.packages=[];state.user={csrf:'fixture'};document.body.innerHTML=editor(context.course,context.documents,context.document,false);bindEditor();",sandbox);
 const form=dom.window.document.querySelector('#editor-form');form.elements.render_mode.value='markdown';form.elements.render_mode.dispatchEvent(new dom.window.Event('change'));
 assert.equal(form.elements.preamble.value,d.preamble);assert.equal(form.querySelector('.preamble-panel').hidden,true);
 await form.onsubmit({preventDefault(){}});assert.equal(payload.render_mode,'markdown');assert.equal(payload.preamble,'');assert.equal(payload.tex,d.tex);assert.equal(form.elements.preamble.value,d.preamble);dom.window.close();
});
test('official renderer refuses TeX at execution boundary without starting worker',async()=>{const r=tikzRenderer('data/unused-host-tikz');await assert.rejects(r.compile({tex:'\\begin{ tikzcd } A \\end{ tikzcd }'}),/隔离/);assert.equal(sharedTikzWorker(),undefined);await r.close();});
