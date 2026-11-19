import {publicCatalog} from '../scripts/build-course-catalog.mjs';
export function catalogFetch(base,extra={},full={}){
 const {files}=publicCatalog(structuredClone(base),structuredClone(extra),structuredClone(full));
 return async url=>{const key=String(url).replace('/course-atlas/data/',''),bytes=files.get(key);return {ok:!!bytes,status:bytes?200:404,json:async()=>JSON.parse(bytes)}};
}
