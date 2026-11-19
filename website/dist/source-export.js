import {buildDocument} from './latex-source.js';
export function exportSource(d,origin=''){
 const source=d.render_mode==='latex'?buildDocument(d.tex,d.preamble):(d.preamble?d.preamble+'\n\n'+d.tex:d.tex);
 const dependencies=[...new Set(source.match(/\/media\/[a-f0-9]{64}\.(?:png|jpg|webp|pdf)/g)||[])];
 if(!dependencies.length)return source;
 const note=['% 本源码引用下列附件，请另行下载并与 .tex 放在同一目录。','% 完整 LaTeX 文档中的站内附件路径已改为本地文件名。',...dependencies.map(p=>'% '+p.split('/').at(-1)+' : '+origin+p)].join('\n');
 return note+'\n'+(d.render_mode==='latex'?source.replace(/\/media\/([a-f0-9]{64}\.(?:png|jpg|webp|pdf))/g,'$1'):source);
}
