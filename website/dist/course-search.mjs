import {initialGroups} from './pinyin-initials-data.mjs';

const normalize=value=>String(value??'').normalize('NFKC').toLowerCase();
const initials=new Map();
for(const [letters,characters] of Object.entries(initialGroups)){
 for(const character of characters)initials.set(character,letters);
}
const textCache=new Map(),courseCache=new WeakMap();
function searchField(value){
 const text=normalize(value).replace(/\s+/gu,'');
 let field=textCache.get(text);
 if(!field){
  field={text,letters:[...text].filter(c=>/[\p{L}\p{N}]/u.test(c)).map(c=>initials.get(c)||c)};
  textCache.set(text,field);
 }
 return field;
}
function initialsMatch(letters,token){
 if(!/^[a-z0-9]+$/.test(token))return false;
 for(let start=0;start<=letters.length-token.length;start++){
  let offset=0;
  while(offset<token.length&&letters[start+offset].includes(token[offset]))offset++;
  if(offset===token.length)return true;
 }
 return false;
}
const fieldMatches=(field,token)=>field.text.includes(token)||initialsMatch(field.letters,token);
export const searchTokens=query=>normalize(query).trim().split(/\s+/u).filter(Boolean);

// Each keyword must match one complete field; fields are never joined together.
export function createCourseMatcher(query){
 const tokens=searchTokens(query);
 return course=>{
  if(!tokens.length)return true;
  let fields=courseCache.get(course);
  if(!fields){
   fields=[course.name,...(course.codes||[course.code]),...(course.teachers||[])].filter(Boolean).map(searchField);
   courseCache.set(course,fields);
  }
  return tokens.every(token=>fields.some(field=>fieldMatches(field,token)));
 };
}
export function createTitleMatcher(query){
 const tokens=searchTokens(query);
 return title=>tokens.every(token=>fieldMatches(searchField(title),token));
}
