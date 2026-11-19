export const normalizeDocumentText=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
export const documentSearchTokens=query=>[...new Set(String(query??'').normalize('NFKC').trim().split(/\s+/).filter(Boolean).map(normalizeDocumentText))];
export function prepareDocumentSearch(documents,index){
 const rows=new Map((index?.documents||[]).map(d=>[d.href,d]));
 return documents.map(d=>{const source=rows.get(d.href),pages=(source?.pages||[]).filter(p=>typeof p.text==='string'&&p.text.trim()).map(p=>({...p,normalized:normalizeDocumentText(p.text)}));return {...d,pages,indexed:pages.length>0,reason:source?.reason||'暂未收录正文',metadata:normalizeDocumentText([d.title,d.group,d.version].filter(Boolean).join(' '))}});
}
function normalizedMap(text){
 let value='',positions=[];let offset=0;
 for(const c of text){for(const unit of c.normalize('NFKC').toLowerCase()){if(!/\s/.test(unit)){value+=unit;for(let i=0;i<unit.length;i++)positions.push([offset,offset+c.length]);}}offset+=c.length;}
 return {value,positions};
}
export function documentMatchRanges(text,tokens){
 const {value,positions}=normalizedMap(text),ranges=[];
 for(const token of tokens){let start=0;for(let n=0;n<12;n++){const i=value.indexOf(token,start);if(i<0)break;ranges.push([positions[i][0],positions[i+token.length-1][1]]);start=i+token.length;}}
 const merged=[];for(const r of ranges.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}return merged;
}
export function documentSnippet(text,tokens){
 const ranges=documentMatchRanges(text,tokens);
 const candidates=(ranges.length?ranges:[[0,0]]).map(range=>{const at=range[0],start=Math.max(0,at-45),end=Math.min(text.length,Math.max(at+125,range[1]+35)),sample=normalizeDocumentText(text.slice(start,end));return {start,end,hits:tokens.filter(t=>sample.includes(t)).length}}).sort((a,b)=>b.hits-a.hits||a.start-b.start);
 const {start,end}=candidates[0];
 return {text:text.slice(start,end).replace(/\s+/g,' '),before:start>0,after:end<text.length};
}
export function searchDocuments(rows,query){
 const tokens=documentSearchTokens(query);
 return rows.flatMap(d=>{
  if(!tokens.length)return [{document:d,matches:[]}];
  if(!tokens.every(t=>d.metadata.includes(t)||d.pages.some(p=>p.normalized.includes(t))))return [];
  const matching=d.pages.map(p=>({page:p.page,text:p.text,hits:tokens.filter(t=>p.normalized.includes(t)).length})).filter(p=>p.hits).sort((a,b)=>b.hits-a.hits||(a.page||0)-(b.page||0)).slice(0,3).map(p=>({...p,snippet:documentSnippet(p.text,tokens)}));
  return [{document:d,matches:matching}];
 });
}
