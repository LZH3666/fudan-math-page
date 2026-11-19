import {diffLines,diffArrays} from 'diff';

// Server worker only. Retain every original code point; never expand colored spans.
export const DIFF_VERSION='lines-chars-2';
export function textDiff(oldText='',newText='',{timeout=250,characterDiff}={}){
 const deadline=performance.now()+timeout,parts=[];
 const remaining=()=>Math.max(0,deadline-performance.now());
 const push=(type,text)=>{if(!text)return;const last=parts.at(-1);if(last?.type===type)last.text+=text;else parts.push({type,text})};
 const incomplete=()=>({status:'incomplete',exact:false,added:null,removed:null,changed:null,parts:null});
 const chars=(a,b)=>{
  if(a===b){push('equal',a);return true}
  if(!a||!b){push('delete',a);push('insert',b);return true}
  if(remaining()<=0)return false;
  if(characterDiff && a.length+b.length>=2048 && characterDiff(a,b,push,deadline))return true;
  if(remaining()<=0)return false;
  const changes=diffArrays(Array.from(a),Array.from(b),{timeout:remaining()});
  if(!changes)return false;
  for(const c of changes)push(c.added?'insert':c.removed?'delete':'equal',c.value.join(''));
  return true;
 };
 if(oldText===newText)push('equal',oldText);
 else if(!oldText||!newText){push('delete',oldText);push('insert',newText)}
 else if(oldText.length+newText.length<2048){if(!chars(oldText,newText))return incomplete()}
 else{
  if(remaining()<=0)return incomplete();
  const lines=diffLines(oldText,newText,{timeout:remaining()});
  if(!lines)return incomplete();
  let deleted='',inserted='';
  for(const c of lines){
   if(c.removed)deleted+=c.value;
   else if(c.added)inserted+=c.value;
   else{if(!chars(deleted,inserted))return incomplete();deleted='';inserted='';push('equal',c.value)}
  }
  if(!chars(deleted,inserted))return incomplete();
 }
 let added=0,removed=0;
 for(const p of parts){if(p.type==='equal')continue;let n=0;for(const c of p.text)n++;if(p.type==='insert')added+=n;else removed+=n}
 return {status:'complete',exact:true,added,removed,changed:added+removed,parts};
}
