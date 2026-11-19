import {escapeHtml as e} from './tex.js';

// Hidden unchanged text is kept outside the DOM until explicitly expanded.
export function diffView(diff){
 const folds=[];
 if(diff.status!=='complete')return{html:'<p role="status">'+(diff.status==='incomplete'?'此比较尚未完成，暂不显示增删数；可查看完整源码。':'正在比较，可先查看完整源码。')+'</p>',folds};
 const html=diff.parts.map((p,index)=>{
  if(p.type!=='equal')return '<'+(p.type==='insert'?'ins':'del')+'>'+e(p.text)+'</'+(p.type==='insert'?'ins':'del')+'>';
  const lines=p.text.match(/[^\n]*\n|[^\n]+$/g)||[];
  let head='',hidden='',tail='';
  if(lines.length>10){
   const left=index===0?0:3,right=index===diff.parts.length-1?0:3;
   head=lines.slice(0,left).join('');tail=right?lines.slice(-right).join(''):'';hidden=lines.slice(left,right?-right:undefined).join('');
  }else if(p.text.length>1600){const chars=Array.from(p.text);head=chars.slice(0,160).join('');hidden=chars.slice(160,-160).join('');tail=chars.slice(-160).join('')}
  else return e(p.text);
  const id=folds.push(hidden)-1;
  return e(head)+'<button type="button" class="diff-fold" data-action="diff-expand" data-fold="'+id+'">展开未修改内容（'+Array.from(hidden).length+' 字符）</button>'+e(tail);
 }).join('');
 return{html:'<p>增加 '+diff.added+' / 删除 '+diff.removed+' 字符（正文源码）；绿色为新增，红色删除线为删除。</p><div class="revision-diff">'+(html||'正文无变化。')+'</div>',folds};
}
