// Exact character LCS for large replacement blocks, in a background worker.
// Each set bit is a column where the LCS length increases over its left neighbor.
export function bitsetDiff(oldText,newText,push,deadline){
 const a=Array.from(oldText),b=Array.from(newText);
 const width=Math.ceil(b.length/8),block=Math.max(1,Math.ceil(Math.sqrt(a.length)));
 const alphabet=new Set(b);
 // Budget space for masks, checkpoints and one block of reconstructed rows.
 if(width*(alphabet.size+2*block+4)>48*1024*1024)return false;
 const masks=new Map();
 for(let j=0;j<b.length;j++){
  if((j&255)===0 && performance.now()>=deadline)return false;
  masks.set(b[j],(masks.get(b[j])??0n)|(1n<<BigInt(j)));
 }
 const advance=(row,c)=>{
  const x=row|(masks.get(c)??0n);
  return x & ~(x-((row<<1n)|1n));
 };
 let row=0n;
 const checkpoints=[];
 for(let i=0;i<a.length;i++){
  if(i%block===0){
   if(performance.now()>=deadline)return false;
   checkpoints.push(row);
  }
  row=advance(row,a[i]);
 }
 // Backtrack through one block at a time, storing only its rows and the edit path.
 const path=[],equal=0,del=1,ins=2;
 let i=a.length,j=b.length;
 while(i>0 && j>0){
  const start=Math.floor((i-1)/block)*block;
  row=checkpoints[Math.floor(start/block)];
  const rows=[];
  for(let k=start;k<i;k++){row=advance(row,a[k]);rows.push(row)}
  while(i>start && j>0){
   if((path.length&255)===0 && performance.now()>=deadline)return false;
   if(a[i-1]===b[j-1]){path.push(equal);i--;j--}
   else if(((rows[i-start-1]>>BigInt(j-1))&1n)===0n){path.push(ins);j--}
   else{path.push(del);i--}
  }
 }
 while(i>0){path.push(del);i--}
 while(j>0){path.push(ins);j--}
 for(let k=path.length-1;k>=0;k--){
  switch(path[k]){
   case equal:push('equal',a[i++]);j++;break;
   case del:push('delete',a[i++]);break;
   case ins:push('insert',b[j++]);break;
  }
 }
 return true;
}
