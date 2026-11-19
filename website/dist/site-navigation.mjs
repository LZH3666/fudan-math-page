import {escapeHtml as e} from './tex.js';
import {courseCollections} from './catalog.mjs';
import {guideSections} from './guide-sections.mjs';
export const primarySections=[['materials','课程资料','/materials'],['reviews','课程评价','/reviews'],['guides','其他功能','/guides']];
export function primarySection(hash=''){
 const route=String(hash).replace(/^#?\//,'').split(/[/?]/)[0];
 if(['materials','catalog','subject','course','doc','read','new'].includes(route))return 'materials';
 return ['reviews','guides'].includes(route)?route:'';
}
// Materials and guides expose only their fixed section links.
export function siteNavigation(active='',materialChildren=courseCollections){
 return '<nav class="primary-navigation" aria-label="主要栏目"><ul>'+primarySections.map(([id,title,path])=>{const children=id==='materials'?materialChildren:id==='guides'?guideSections:[];return '<li data-section="'+id+'"><a class="primary-section-link'+(id===active?' active':'')+'" href="#'+path+'"'+(id===active?' aria-current="location"':'')+'>'+e(title)+'</a>'+(children.length?'<ul class="materials-subnavigation">'+children.map(c=>'<li><a href="#'+e(c.path)+'">'+e(c.title)+'</a></li>').join('')+'</ul>':'')+'</li>'}).join('')+'</ul></nav>';
}
