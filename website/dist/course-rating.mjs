export const ratingDimensions=[
 {key:'grading',label:'给分情况',levels:['极差','较差','一般','较好','极好']},
 {key:'difficulty',label:'内容难度',levels:['极易','较易','适中','较难','极难']},
 {key:'workload',label:'课业负担',levels:['极轻','较轻','适中','较重','极重']},
 {key:'assessment',label:'考核要求',levels:['极低','较低','适中','较高','极高']},
 {key:'overall',label:'总体评价',levels:['极差','较差','一般','较好','极好']}
];
export function academicTerms(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric'}).formatToParts(now).map(p=>[p.type,p.value]));
 const year=Number(parts.year),month=Number(parts.month),start=month>=9?year:year-1,isSpring=month>=2&&month<9,terms=[];
 for(let y=2022;y<=start;y++){terms.push(`${y}-${y+1}秋`);if(y<start||isSpring)terms.push(`${y}-${y+1}寒假`);if(y<start||isSpring)terms.push(`${y}-${y+1}春`);if(y<start||month>=7&&month<9)terms.push(`${y}-${y+1}暑假`)}return terms.reverse();
}
export const termLabel=term=>String(term).replace(/(秋|春|寒假|暑假)$/,' $1');
export function ratingSummary(rows){return ratingDimensions.map(d=>({key:d.key,label:d.label,levels:d.levels,counts:d.levels.map((_,i)=>rows.filter(r=>r[d.key]===i+1).length)}))}

export const teacherKey=value=>[...new Set(String(value||'').normalize('NFKC').split(/[,、;；]/u).map(name=>name.trim().replace(/\s+/gu,' ')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')).join('、');
export function teacherRatingGroups(rows,imported=[]){
 const groups=new Map();
 for(const row of rows){const teacher=teacherKey(row.teacher);if(!groups.has(teacher))groups.set(teacher,{teacher,rows:[],scores:[]});const g=groups.get(teacher);g.rows.push(row);g.scores.push(row.overall)}
 for(const row of imported){const teacher=teacherKey(row.teacher);if(!groups.has(teacher))groups.set(teacher,{teacher,rows:[],scores:[]});groups.get(teacher).scores.push(row.overall_score)}
 return [...groups.values()].sort((a,b)=>a.teacher.localeCompare(b.teacher,'zh-CN')).map(g=>({teacher:g.teacher,count:g.rows.length,dimensions:ratingSummary(g.rows),overall:{count:g.scores.length,average:g.scores.length?g.scores.reduce((a,b)=>a+b,0)/g.scores.length:null}}));
}
