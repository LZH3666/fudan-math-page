import {escapeHtml as e} from './tex.js';
import {officialDocuments} from './official-documents.mjs?v=2';
import {prepareDocumentSearch,searchDocuments,documentSearchTokens,documentMatchRanges} from './document-search.mjs';
const link=(label,href)=>'<a href="'+e(href)+'">'+e(label)+'</a>';
function highlighted(text,tokens){let html='',at=0;for(const [start,end] of documentMatchRanges(text,tokens)){html+=e(text.slice(at,start))+'<mark>'+e(text.slice(start,end))+'</mark>';at=end;}return html+e(text.slice(at));}
export function createDocumentSearchUI(){
 let rows=[],query='',failure=false,pending;
 async function load(){if(!pending)pending=fetch('/course-atlas/data/document-search.json?v=2').then(async r=>{if(!r.ok)throw Error();const index=await r.json();if(!Array.isArray(index.documents))throw Error();rows=prepareDocumentSearch(officialDocuments,index);failure=false;}).catch(()=>{rows=prepareDocumentSearch(officialDocuments,{});failure=true;pending=null;});await pending;}
 function results(){
  const tokens=documentSearchTokens(query),found=searchDocuments(rows,query);
  return (tokens.length?'<p role="status">找到 '+found.length+' 项文件。</p>':'')+(failure?'<p class="form-error">正文搜索暂不可用，仍可按文件名查找。请稍后重新打开本页。</p>':'')+['学校','数学科学学院','体育'].map(group=>{const items=found.filter(r=>r.document.group===group);if(!items.length)return '';return '<section><h2>'+e(group)+'</h2><ul class="atlas-guide-list">'+items.map(({document:d,matches})=>'<li>'+link(d.title,d.href)+' <small>'+e(d.version||'')+'</small>'+(d.source?' · '+link('官方来源',d.source):'')+(!d.indexed?' <small>'+e(d.reason)+'</small>':'')+matches.map(m=>'<div class="document-search-match">'+(m.page?link('第 '+m.page+' 页',d.href+'#page='+m.page):'<small>正文</small>')+'<p>'+(m.snippet.before?'…':'')+highlighted(m.snippet.text,tokens)+(m.snippet.after?'…':'')+'</p></div>').join('')+'</li>').join('')+'</ul></section>';}).join('')+(tokens.length&&!found.length?'<p>没有找到匹配的文件，请尝试其他关键词。</p>':'');
 }
 async function view(){await load();return '<h1>文件收集</h1><form id="document-search-form" role="search"><label for="document-search-query">搜索文件名或正文</label><div class="form-actions"><input id="document-search-query" name="query" type="search" maxlength="200" placeholder="输入关键词，空格分隔多个关键词" value="'+e(query)+'"><button type="submit" class="outline-button">搜索</button><button type="reset" class="outline-button">清空</button></div></form><div id="document-search-results">'+results()+'</div>';}
 function bind(){const form=document.querySelector('#document-search-form'),output=document.querySelector('#document-search-results');if(!form||!output)return;const update=()=>{query=form.elements.query.value;output.innerHTML=results()};form.onsubmit=ev=>{ev.preventDefault();update()};form.elements.query.oninput=update;form.onreset=()=>{query='';form.elements.query.value='';output.innerHTML=results()};}
 return {view,bind};
}
