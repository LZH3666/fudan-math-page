import test from 'node:test';
import assert from 'node:assert/strict';
import {textDiff} from '../dist/text-diff.js';
import {diffView} from '../dist/diff-view.js';
function check(a,b,added,removed){
 const d=textDiff(a,b,{timeout:1000});assert.equal(d.status,'complete');
 if(added!==undefined){assert.equal(d.added,added);assert.equal(d.removed,removed)}
 assert.equal(d.parts.filter(p=>p.type!=='insert').map(p=>p.text).join(''),a);
 assert.equal(d.parts.filter(p=>p.type!=='delete').map(p=>p.text).join(''),b);
 assert.equal(d.added,d.parts.filter(p=>p.type==='insert').reduce((n,p)=>n+Array.from(p.text).length,0));
 assert.equal(d.removed,d.parts.filter(p=>p.type==='delete').reduce((n,p)=>n+Array.from(p.text).length,0));
 return d;
}
test('Unicode, replacements, whitespace and literal markup preserve both sources',()=>{
 for(const [a,b,n,m] of [['甲乙丙','甲丁丙',1,1],['abcXYZdef','aBcXYZdeF',2,2],['😀甲','😃甲乙',2,1],['','新页面',3,0],['abc','',0,3],['same','same',0,0],['甲乙\n丙','甲\n乙\n丙',1,0],['a\r\nb','a\nb',0,1],['<script>甲</script>','<script>乙</script>',1,1]])check(a,b,n,m);
});
test('long articles retain all unchanged text between separated edits',()=>{
 const lines=Array.from({length:4000},(_,i)=>`第${i}段：设函数连续，则结论成立。\\[x_${i}+y_${i}=0\\]\n`),a=lines.join('');
 check(a,lines.map((s,i)=>i===5||i===3995?s.replace('连续','光滑'):s).join(''),4,4);
 check(a,lines.map((s,i)=>i%20===0?s.replace('连续','光滑'):s).join(''),400,400);
 check(a,a.replace('设函数连续','设函数\n连续'),1,0);
});
test('repeated mathematical environments and line split/merge preserve alignment',()=>{
 const line='::: theorem\n设 $x=1$。\n::: proof\n由定义可知。\n::: end\n';
 const a=line.repeat(100),b=line.repeat(50)+line.replace('x=1','x=2')+line.repeat(49);check(a,b,1,1);
 const prose=('这是连续的中文正文，不含空格。').repeat(300);check(prose,prose.slice(0,600)+'\n'+prose.slice(600),1,0);
});
test('unfinished comparisons never publish estimated numbers or misleading colors',()=>{
 const d=textDiff('甲'.repeat(10000),'乙'.repeat(10000),{timeout:0});
 assert.equal(d.status,'incomplete');assert.equal(d.added,null);assert.equal(d.removed,null);assert.equal(d.parts,null);
 assert.doesNotMatch(diffView(d).html,/<ins>|<del>|增加 \d/);
});
test('small random examples agree with an independent LCS reference',()=>{
 let seed=37;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
 const alphabet=['甲','乙','😀','\n',' '];
 for(let trial=0;trial<300;trial++){
  const a=Array.from({length:Math.floor(random()*25)},()=>alphabet[Math.floor(random()*alphabet.length)]),b=Array.from({length:Math.floor(random()*25)},()=>alphabet[Math.floor(random()*alphabet.length)]);
  const l=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)l[i][j]=a[i-1]===b[j-1]?l[i-1][j-1]+1:Math.max(l[i-1][j],l[i][j-1]);
  check(a.join(''),b.join(''),b.length-l[a.length][b.length],a.length-l[a.length][b.length]);
 }
});
test('view escapes HTML and keeps folded source outside the initial DOM',()=>{
 const a='start\n'+'<img onerror=alert(1)>未改\n'.repeat(1000)+'旧结尾',b=a.replace('旧结尾','新结尾');
 const d=check(a,b,1,1),view=diffView(d);
 assert.ok(view.folds.length);assert.ok(view.html.length<1500);assert.doesNotMatch(view.html,/<img|onerror="/);assert.match(view.html,/<ins>新<\/ins>/);
 assert.ok(view.folds.join('').includes('<img onerror=alert(1)>'));
});

import {bitsetDiff} from '../bitset-diff.mjs';
test('bounded fallback matches independent edit counts and reconstructs Unicode on both sides',()=>{
 let seed=91;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32};
 const alphabet=Array.from('甲β😄a\n ');
 for(let test=0;test<120;test++){
  const generate=()=>Array.from({length:Math.floor(random()*95)},()=>alphabet[Math.floor(random()*alphabet.length)]);
  const a=generate(),b=generate(),parts=[];
  assert(bitsetDiff(a.join(''),b.join(''),(type,text)=>parts.push({type,text}),Infinity));
  assert.equal(parts.filter(p=>p.type!=='insert').map(p=>p.text).join(''),a.join(''));
  assert.equal(parts.filter(p=>p.type!=='delete').map(p=>p.text).join(''),b.join(''));
  let prev=new Uint16Array(b.length+1);
  for(const c of a){
   const next=new Uint16Array(b.length+1);
   for(let j=1;j<=b.length;j++)next[j]=c===b[j-1]?prev[j-1]+1:Math.max(prev[j],next[j-1]);
   prev=next;
  }
  assert.equal(parts.filter(p=>p.type==='equal').length,prev[b.length]);
 }
 assert.equal(bitsetDiff('abc','def',()=>assert.fail(),0),false);
});

test('a wide alphabet can use the remaining worker budget after the mask memory guard',()=>{
 const shared=Array.from({length:20500},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
 const a='a'.repeat(1500)+shared+'x',b='b'.repeat(1500)+shared+'y';
 const d=textDiff(a,b,{timeout:15000,characterDiff:bitsetDiff});
 assert.equal(d.status,'complete');assert.equal(d.added,1501);assert.equal(d.removed,1501);
 assert.equal(d.parts.filter(p=>p.type!=='insert').map(p=>p.text).join(''),a);
 assert.equal(d.parts.filter(p=>p.type!=='delete').map(p=>p.text).join(''),b);
});
