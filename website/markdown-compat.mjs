import {protectedToken,readMath} from './banana-runtime/scripts/prebuild/markup.mjs';
import {parseLists} from './banana-runtime/scripts/prebuild/lists.mjs';
export function titleSpacing(title){const parts=[];let plain='',changed=false;const flush=()=>{const fixed=plain.replace(/\\(?:quad|qquad)\b\s*/g,' ');changed||=fixed!==plain;parts.push({text:fixed});plain=''};for(let i=0;i<title.length;){const end=protectedToken(title,i,{indentedCode:false})??readMath(title,i)?.end;if(end){flush();parts.push({text:title.slice(i,end),protected:true});i=end}else plain+=title[i++]}flush();return changed?parts.map(p=>p.protected?p.text:p.text.replace(/\s+/g,' ')).join('').trim():title}
export function citationLinks(source){
 const {codeBlocks}=parseLists(source);let result='';
 for(let i=0;i<source.length;){
  const end=codeBlocks.find(([a,b])=>i>=a&&i<b)?.[1]??protectedToken(source,i,{indentedCode:false})??readMath(source,i)?.end;
  if(end){result+=source.slice(i,end);i=end;continue}
  const match=source.slice(i).match(/^\[\[([^\[\]\n]+)\]\]\((#[^\s)]+|@[^\s)]+|\/[^\s)]+)\)/);
  if(match){result+='[&#91;'+match[1]+'&#93;]('+match[2]+')';i+=match[0].length;continue}
  if((i===0||source[i-1]==='\n')&&/^#{1,6} /.test(source.slice(i))){const e=source.indexOf('\n',i),stop=e<0?source.length:e;result+=titleSpacing(source.slice(i,stop));i=stop;continue}
  result+=source[i++];
 }
 return result;
}

// A trailing ')' is a prose subitem label in the imported notes. CommonMark
// otherwise consumes it as an ordinary decimal list and loses the distinction.
export function subquestionLabels(source){
 let result='';
 const {codeBlocks}=parseLists(source);
 for(let i=0;i<source.length;){
  const end=codeBlocks.find(([a,b])=>i>=a&&i<b)?.[1]??protectedToken(source,i,{indentedCode:false})??readMath(source,i)?.end;
  if(end){result+=source.slice(i,end);i=end;continue}
  if(i===0||source[i-1]==='\n'){
   const sub=source.slice(i).match(/^([ \t]*)(\d+)(?:\\)?\) +/);
   if(sub){result+=sub[1]+'('+sub[2]+') ';i+=sub[0].length;continue}
   const combined=source.slice(i).match(/^([ \t]*\d+(?:\\)?\. +)(\d+)(?:\\)?\) +/);
   if(combined){result+=combined[1]+'\n\n('+combined[2]+') ';i+=combined[0].length;continue}
  }
  result+=source[i++];
 }
 return result;
}
