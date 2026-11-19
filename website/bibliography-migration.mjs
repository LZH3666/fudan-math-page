import {stringify} from './banana-runtime/node_modules/yaml/dist/index.js';
import {protectedToken,readMath} from './banana-runtime/scripts/prebuild/markup.mjs';
import {parseLists} from './banana-runtime/scripts/prebuild/lists.mjs';
export const bibliographyKey=anchor=>'b-'+anchor.slice(2);
export function migrateBibliography(source,entries,targets){
 let result=source;
 for(const e of [...entries].sort((a,b)=>b.lineStart-a.lineStart)){
  const token='<!-- FudanAnchor:'+e.anchor+' -->',position=result.indexOf(token,e.lineStart);
  if(position<e.lineStart||position>=e.end||result.slice(position+token.length,e.end).trim()!==e.body)throw Error('Bibliography source binding mismatch');
  result=result.slice(0,e.lineStart)+'<!-- FudanAnchor:'+e.anchor+' -->\n\n```bibliography\n'+stringify({[bibliographyKey(e.anchor)]:e.fields})+'```'+result.slice(e.end);
 }
 const {codeBlocks}=parseLists(result);let out='',citations=0;
 for(let i=0;i<result.length;){const stop=codeBlocks.find(([a,b])=>i>=a&&i<b)?.[1]??protectedToken(result,i,{indentedCode:false})??readMath(result,i)?.end;if(stop){out+=result.slice(i,stop);i=stop;continue}
  const nested=result.slice(i).match(/^\[\[([^\[\]\n]+)\]\]\(#(l-[a-f0-9]{24})\)/),single=nested?null:result.slice(i).match(/^\[([^\[\]\n]+)\]\(#(l-[a-f0-9]{24})\)/),m=nested||single;
  if(m&&targets.has(m[2])){const target=targets.get(m[2]),automatic=Boolean(nested)||/^&#91;[\s\S]*&#93;$/.test(m[1]);out+=automatic?'[@'+bibliographyKey(m[2])+']':'['+m[1]+'](@'+bibliographyKey(m[2])+')';i+=m[0].length;citations++;continue}
  out+=result[i++];
 }
 return {markdown:out,citations};
}
