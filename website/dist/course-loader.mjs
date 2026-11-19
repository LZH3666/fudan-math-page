export function createCatalogLoader(request=(...args)=>fetch(...args)){
 let pending;const details=new Map();
 async function json(url){const response=await request('/course-atlas/data/'+url,{cache:'no-cache'});if(!response.ok)throw Error('课程数据加载失败，请重试');return response.json()}
 const index=()=>pending??=json('catalog-index.json').then(d=>{if(d.schema_version!==1||!Array.isArray(d.scope))throw Error('课程目录格式不正确，请重试');return d}).catch(error=>{pending=null;throw error});
 async function course(id){
  const catalog=await index(),row=catalog.scope.find(g=>g.id===id||g.legacy_ids?.includes(id));if(!row)throw Error('课程不存在');
  if(!/^courses\/[a-f0-9]{64}\.json$/.test(row.detail))throw Error('课程详情地址不正确');
  if(!details.has(row.id))details.set(row.id,json(row.detail).then(d=>{if(d.schema_version!==1||d.scope?.[0]?.id!==row.id||!Array.isArray(d.reviews))throw Error('课程详情格式不正确');return {...d,scope:[{...d.scope[0],review_stats:row.review_stats}],full_reviews:d.reviews}}).catch(error=>{details.delete(row.id);throw error}));
  return details.get(row.id);
 }
 return {index,course};
}
