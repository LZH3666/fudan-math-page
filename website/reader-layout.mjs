// A live presentation layer for embedded reading and preview. Stored artifacts,
// editable text, historical versions and standalone downloads stay unchanged.
export const readerCSS=`
@counter-style fudan-subquestion { system: extends decimal; prefix: "("; suffix: ") "; }
article { text-align: left !important; }
article #page-title { display: none; }
article > ol, article ol:not(.footnotes ol) {
  padding-inline-start: 0;
  list-style-position: inside;
}
article ol:not(.footnotes ol) > li { padding-inline-start: 0; }
article ol:not(.footnotes ol) > li > p:first-child { display: inline; }
article ol:not(.footnotes ol) > li { margin-block: .75em; }
article ol ol, article ul ol { margin-inline-start: 1.5em; }
article ol ol:not(.footnotes ol), article ul ol:not(.footnotes ol) { list-style-type: fudan-subquestion; }
article p { margin-block: .75em; }
article .footnotes ol { list-style-position: outside; }
.bibliography strong { font-weight: 400 !important; }
.inline-footnote { font-size: .92em; }
article .theorem-proof { border: 0 !important; border-left: 2px solid #00a090 !important; padding: 0 0 0 1.5rem !important; }
article .theorem-proof .theorem-content > :last-child::after,
article .theorem-proof .theorem-content > :last-child:is(ul,ol)>li:last-child::after,
article .theorem-proof .theorem-content > blockquote:last-child>p:last-child::after { content: none !important; }
article .theorem-proof .theorem-content > .math-display:last-child { padding-right: 0 !important; }
@media only screen and (max-width: 768px) { article .theorem-proof { padding-left: 1.2rem !important; } }
@media only screen and (min-width: 761px) {
  .content > .container {
    max-width: 138rem !important;
    margin-left: max(0rem, calc((100% - 161.2rem) / 2)) !important;
    margin-right: auto !important;
    padding-right: 2rem !important;
  }
}
`;
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const ignoredTags=new Set(['code','pre','script','style','math','svg','textarea','kbd','samp']);
export function equationAnchorIds(html){
 const ids=new Set(),anchor=/<span\b[^>]*\bid\s*=\s*(["'])([^"']+)\1[^>]*><\/span>\s*<\/p\s*>\s*<span\b([^>]*)>/gi;let match;
 while((match=anchor.exec(html))){const classes=/\bclass\s*=\s*(["'])([^"']*)\1/i.exec(match[3])?.[2].split(/\s+/)||[];if(classes.includes('math-rendered')&&classes.includes('math-display'))ids.add(match[2]);}
 return ids;
}
function removeEquationNavigation(html){
 const ids=equationAnchorIds(html);if(!ids.size)return html;
 return html.replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/a\s*>/gi,(link,quote,href)=>{
  const parent=/mdAnchor=([^&#]+)/i.exec(href),fragment=parent?.[1]??(href.startsWith('#')?href.slice(1):/^\/?markdown\//i.test(href)?href.split('#').at(-1):'');
  if(!fragment)return link;let id;try{id=decodeURIComponent(fragment)}catch{id=fragment;}
  if(!ids.has(id)||!(href.startsWith('#')||href.includes('mdAnchor=')||href.includes('&amp;mdAnchor=')||/^\/?markdown\//i.test(href)))return link;
  return link.replace(/^<a\b[^>]*>/i,'').replace(/<\/a\s*>$/i,'');
 });
}
function parseHTMLTree(html){
 const root={type:'root',children:[],parent:null,start:0,openEnd:0,closeStart:html.length,end:html.length},stack=[root],tag=/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;let cursor=0,match;
 const addText=(start,end)=>{if(end>start)stack.at(-1).children.push({type:'text',text:html.slice(start,end),start,end,parent:stack.at(-1)});};
 while((match=tag.exec(html))){addText(cursor,match.index);const raw=match[0],name=match[1]?.toLowerCase();
  if(!name){stack.at(-1).children.push({type:'raw',text:raw,start:match.index,end:tag.lastIndex,parent:stack.at(-1)});cursor=tag.lastIndex;continue;}
  if(raw.startsWith('</')){let index=stack.length-1;while(index>0&&stack[index].name!==name)index--;if(index>0){for(let i=index;i<stack.length;i++){stack[i].closeStart=match.index;stack[i].end=tag.lastIndex;}stack.length=index;}cursor=tag.lastIndex;continue;}
  const node={type:'element',name,open:raw,start:match.index,openEnd:tag.lastIndex,closeStart:tag.lastIndex,end:tag.lastIndex,children:[],parent:stack.at(-1)};stack.at(-1).children.push(node);
  if(!raw.endsWith('/>')&&!voidTags.has(name)){stack.push(node);}cursor=tag.lastIndex;
 }
 addText(cursor,html.length);for(const node of stack.slice(1)){node.closeStart=html.length;node.end=html.length;}return root;
}
function elementClasses(node){return node?.type==='element'?(/\bclass\s*=\s*(["'])(.*?)\1/i.exec(node.open)?.[2]??'').split(/\s+/).filter(Boolean):[];}
function elementAttribute(node,name){return node?.type==='element'?new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`,'i').exec(node.open)?.[2]:undefined;}
function nodeText(node){if(node.type==='text')return node.text;if(node.type!=='element'||['script','style','pre','code'].includes(node.name))return '';return node.children.map(nodeText).join('');}
function visibleText(value){return value.replace(/&nbsp;|&#0*160;|&#x0*a0;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/[\u200b\uFEFF]/g,'').trim();}
function isProofBlock(node){
 const classes=elementClasses(node);if(classes.some(name=>['theorem-proof','environment-proof','proof-box','proof-environment'].includes(name)))return true;
 const title=node.children.find(child=>child.type==='element'&&elementClasses(child).includes('theorem-title'));
 const label=title?visibleText(nodeText(title)).trim():'';
 return Boolean(label&&/(?:证明|解答|答案|(?:^|[\s(（])解(?:$|[\s)）])|\b(?:proof|solution|answer)\b)/i.test(label));
}
function isMathQed(node){
 if(!node||node.type!=='element'||!elementClasses(node).includes('math-rendered'))return false;
 let tex=elementAttribute(node,'data-tex');if(!tex)return false;tex=tex.replace(/&amp;/gi,'&').replace(/\$/g,'').replace(/\s+/g,'');
 return /^(?:\\(?:square|Box|blacksquare|qed|QED)|□|∎|■)$/i.test(tex);
}
function trailingTextQedRange(node){
 if(node.type!=='text')return null;const match=/(?:□|∎|■|&#(?:0*9633|0*8718);|&#x0*(?:25a1|220e);|&square;)\s*$/i.exec(node.text);return match?{start:node.start+match.index,end:node.end}:null;
}
function lastVisibleNode(node){
 for(let i=node.children.length-1;i>=0;i--){const child=node.children[i];if(child.type==='raw')continue;if(child.type==='text'){if(visibleText(child.text))return child;continue;}if(['br','wbr'].includes(child.name))continue;if(elementClasses(child).includes('math-rendered'))return child;if(elementClasses(child).includes('theorem-block')){if(lastVisibleNode(child))return child;continue;}const nested=lastVisibleNode(child);if(nested)return nested;if(['img','video','audio','iframe','svg','canvas','input'].includes(child.name))return child;}
 return null;
}
function hasVisibleMarkup(value){return Boolean(visibleText(value.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/&(?:nbsp;|#0*160;|#x0*a0;)/gi,' ')));}
function removeTerminalProofQED(html){
 if(!html.includes('theorem-content')||!/(?:\\(?:square|Box|blacksquare|qed|QED)|□|∎|■)/i.test(html))return html;
 const tree=parseHTMLTree(html),ranges=[];
 const walk=node=>{if(node.type==='element'&&elementClasses(node).includes('theorem-block')&&isProofBlock(node)){
   const content=node.children.find(child=>child.type==='element'&&elementClasses(child).includes('theorem-content'));
   if(content){const last=lastVisibleNode(content),range=last?(isMathQed(last)?{start:last.start,end:last.end}:trailingTextQedRange(last)):null;
    if(range){let paragraph=last?.parent;while(paragraph&&paragraph!==content&&paragraph.name!=='p'&&!elementClasses(paragraph).includes('theorem-block'))paragraph=paragraph.parent;
     if(paragraph?.name==='p'&&paragraph!==content&&paragraph.closeStart>=paragraph.openEnd){const remainder=html.slice(paragraph.openEnd,range.start)+html.slice(range.end,paragraph.closeStart);if(!hasVisibleMarkup(remainder)){range.start=paragraph.start;range.end=paragraph.end;}}
     ranges.push(range);
    }
   }
  }
  if(node.children)for(const child of node.children)if(child.type==='element')walk(child);
 };
 walk(tree);if(!ranges.length)return html;const nonOverlapping=[];for(const range of ranges.sort((a,b)=>(a.end-a.start)-(b.end-b.start)||a.start-b.start)){if(!nonOverlapping.some(other=>range.start<other.end&&other.start<range.end))nonOverlapping.push(range);}nonOverlapping.sort((a,b)=>b.start-a.start);for(const range of nonOverlapping)html=html.slice(0,range.start)+html.slice(range.end);return html;
}
function chineseDoubleQuotes(text){
 return text
  .replace(/(?:&rsquo;|&#0*8217;|&#x0*2019;)(?:&lsquo;|&#0*8216;|&#x0*2018;)/gi,'”')
  .replace(/(?:&rsquo;|&#0*8217;|&#x0*2019;){2}/gi,'”')
  .replace(/(?:&lsquo;|&#0*8216;|&#x0*2018;){2}/gi,'“')
  .replace(/(?:&apos;|&#0*39;|&#x0*27;){2}/gi,'”')
  .replaceAll('’‘','”').replaceAll('’’','”').replaceAll('‘‘','“')
  .replaceAll('``','“').replaceAll("''",'”');
}
function transformTextNodes(html,transform){
 const tag= /<!--[^]*?-->|<![^>]*>|<\/?([a-z][\w:-]*)\b[^>]*>/gi;
 const stack=[];let cursor=0,out='',match;
 const ignored=()=>stack.some(x=>x.ignored);
 while((match=tag.exec(html))){
  const text=html.slice(cursor,match.index);out+=ignored()?text:transform(text);
  const token=match[0],name=match[1]?.toLowerCase();
  if(name){
   if(token.startsWith('</')){
    for(let i=stack.length-1;i>=0;i--)if(stack[i].name===name){stack.length=i;break}
   }else if(!token.endsWith('/>')&&!voidTags.has(name)){
    const attrs=token.slice(name.length+1),skip=ignoredTags.has(name)||/\bclass\s*=\s*(["'])[^"']*\b(?:math-rendered|math-inline|math-display|katex|MathJax|tex-math)\b[^"']*\1/i.test(attrs);
    stack.push({name,ignored:skip});
   }
  }
  out+=token;cursor=tag.lastIndex;
 }
 const tail=html.slice(cursor);return out+(ignored()?tail:transform(tail));
}
function inlineFootnotes(html){
 const block=/<div\b(?=[^>]*\bclass=["'][^"']*\bfootnotes\b[^"']*["'])[^>]*>[\s\S]*?<\/div\s*>/gi,blocks=[...html.matchAll(block)];
 if(!blocks.length)return html;
 const notes=new Map(),removable=new Set();
 for(const item of blocks){let found=false;item[0].replace(/<li\b[^>]*\bid=["']fn:([^"']+)["'][^>]*>([\s\S]*?)<\/li\s*>/gi,(_,id,body)=>{
    found=true;const cleaned=body.replace(/<a\b(?=[^>]*\bclass=["'][^"']*\bfootnote-backref\b[^"']*["'])[^>]*>[\s\S]*?<\/a\s*>/gi,'').replace(/(?:&nbsp;|\u00a0|\s)*<\/p\s*>\s*<p\b[^>]*>(?:&nbsp;|\u00a0|\s)*/gi,'<br><br>').replace(/<\/?p\b[^>]*>/gi,'').replace(/^(?:&nbsp;|\s)+/i,'').replace(/(?:&nbsp;|\u00a0|\s)+$/gi,'').trim();
   if(!notes.has(id))notes.set(id,{body:cleaned,uses:0});return _;
  });if(found)removable.add(item[0]);}
 html=html.replace(/<a\b(?=[^>]*\bclass=["'][^"']*\bfootnote-ref\b[^"']*["'])(?=[^>]*\bhref=["']#fn:([^"']+)["'])[^>]*>[\s\S]*?<\/a\s*>/gi,(ref,id)=>{
  const note=notes.get(id);if(!note)return ref;note.uses++;return '<span class="inline-footnote" role="note">（注：'+note.body+'）</span>';
 });
 html=html.replace(block,whole=>removable.has(whole)?'':whole);
 const orphan=[...notes.values()].filter(note=>!note.uses).map(note=>'<span class="inline-footnote" role="note">（注：'+note.body+'）</span>').join(' ');
 if(orphan)html=html.replace(/<\/article\s*>/i,'<p class="inline-footnote-orphans">'+orphan+'</p></article>');
 return html;
}
export function presentationHTML(html){
 html=removeTerminalProofQED(html);
 html=inlineFootnotes(html);
 html=removeEquationNavigation(html);
 return transformTextNodes(html,chineseDoubleQuotes);
}
// Only known collected exam pages have their administrative cover simplified.
// Work on rendered HTML so the original editable source and history remain intact.
export function simplifyCollectedExamCover(html){
 if(!/<a\b[^>]*class="title-link"[^>]*href="[^"]*mdDoc=collected-[a-f0-9]+/i.test(html))return html;
 const header=html.indexOf('</header>'),side=html.indexOf('</aside>',header);
 if(header<0||side<0)return html;
 const start=side+8,rest=html.slice(start),toc=rest.search(/<aside\b[^>]*class="[^"]*\btoc-shell\b/i),heading=rest.search(/<h[2-6]\b/i);
 const ends=[toc,heading].filter(x=>x>=0);if(!ends.length)return html;
 const end=Math.min(...ends);if(end>5000)return html;
 let cover=rest.slice(0,end);
 cover=cover.replace(/<p>([^<>]*)<\/p>/gi,(all,value)=>{
  const text=value.replace(/&nbsp;|&#160;/g,' ').trim();
  if(!text)return all;
  // Do not remove formulae, questions, or instructions about how to answer.
  if(/[$\\]|重要|任选|选择.{0,5}题|公式|常数/.test(text))return all;
  const course=text.match(/^课程名称\s*[：:]\s*([^：:，。；;!?！？]+?)\s*课程代码\s*[：:]\s*[A-Za-z0-9.\-]+\s*$/);
  if(course)return '<p>'+course[1].trim()+'</p>';
  if(/^(?:(?:姓名|姓\s*名|学号|学\s*号|专业|成绩)\s*[：:]\s*[_＿\s]*)+$/.test(text))return '';
  if(/^开课院系\s*[：:]\s*[\u4e00-\u9fff]{1,20}(?:考试形式\s*[：:]\s*(?:开卷|闭卷))?\s*$/.test(text))return '';
  if(/^考试形式\s*[：:]\s*(?:开卷|闭卷)\s*$/.test(text))return '';
  if(/^课程代码\s*[：:]\s*[A-Za-z0-9.\-]+\s*$/.test(text))return '';
  if(/^复旦大学(?:[\u4e00-\u9fff]*(?:学院|学系|系))?$/.test(text))return '';
  if(/^[☑□√\s]*[ABCＡＢＣ]\s*卷(?:\s*[（(]共\s*\d+\s*页[）)])?\s*$/.test(text))return '';
  return all;
 });
 return html.slice(0,start)+cover+rest.slice(end);
}
export function readingHTML(html,{parentPage=false,hideExamContents=false,collapseContents=false}={}){
 html=presentationHTML(html);
 html=simplifyCollectedExamCover(html);
 // Cached collection directories can still carry old generated title suffixes
 // after a page rename. Correct their display without rewriting artifacts.
 html=html.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/g,(all,start,label,end)=>{
  return start+label.replace(/(^|>)([^<>]+)(?=<|$)/g,(_,prefix,text)=>prefix+text.replace(/\s*[（(]学期未(?:注明|标注)[）)]/g,''))+end;
 });
 html=html.replace(/(<a\b[^>]*\bhref="[^"]*layout-exam-f02c2ffca5463fa675f057a186361e73[^>]*>)([\s\S]*?)(<\/a>)/g,(_,start,label,end)=>start+label.replace(/广义相对论(?=\s*[（(])/g,'广义相对论期中')+end);
 // Imported exercise headings and their TOC labels sometimes repeat the same
 // explicit section number twice. Collapse only an identical leading pair in
 // those display labels; keep saved source, generated anchors and revisions.
 const collapseRepeatedNumber=value=>value.replace(/^(\s*)(\d+(?:\.\d+)+)[ \t]+\2(?=[ \t]|[^\d.])/,'$1$2');
 // A generated Arabic counter repeats an explicit Chinese section number.
 // Keep the original label and anchors; remove the generated counter only
 // when both numbers agree, in both the contents list and the heading.
 const chineseNumbers={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
 html=html.replace(/<span\b[^>]*class="[^"]*\b(?:section-number|toc-section-number)\b[^"]*"[^>]*>\s*(\d+)\s*<\/span>(\s*(?:<span\b[^>]*>)?\s*([一二三四五六七八九十])[、.．])/g,
  (all,n,rest,cn)=>Number(n)===chineseNumbers[cn]?rest:all);
 html=html.replace(/(<span\b[^>]*class="[^"]*\b(?:toc-item-title|directory-item-title)\b[^"]*"[^>]*>)([\s\S]*?)(<\/span>)/gi,
  (all,start,label,end)=>start+collapseRepeatedNumber(label)+end);
 html=html.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,(all,level,attrs,body)=>{
  const anchorEnd=body.indexOf('</a>');
  if(anchorEnd<0)return all;
  const start=body.slice(0,anchorEnd+4),tail=collapseRepeatedNumber(body.slice(anchorEnd+4));
  return `<h${level}${attrs}>${start}${tail}</h${level}>`;
 });
 if(collapseContents){html=html.replace(/(<details\b(?=[^>]*\bclass="[^"]*\btoc-disclosure\b[^"]*")[^>]*?)\s+open(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i,'$1');if(!html.includes('id="fudan-collapsed-toc"'))html=html.replace(/<\/head>/i,'<style id="fudan-collapsed-toc">.toc-shell .toc-disclosure>summary{display:flex}.toc-shell .toc-sidebar-title{display:none}</style></head>')}
 if(parentPage&&!html.includes('id="fudan-parent-navigation"'))html=html.replace(/<\/head>/i,'<style id="fudan-parent-navigation">.collection-children,.collection-pagination,.collection-sidebar{display:none!important}</style></head>');
 if(hideExamContents&&!html.includes('id="fudan-hide-exam-contents"'))html=html.replace(/<\/head>/i,'<style id="fudan-hide-exam-contents">.toc-shell{display:none!important}</style></head>');
 if(html.includes('id="fudan-reader-layout"'))return html;
 return html.replace(/<\/head>/i,'<style id="fudan-reader-layout">'+readerCSS+'</style></head>');
}
