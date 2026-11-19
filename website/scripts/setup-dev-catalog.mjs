import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('../dist/course-atlas/data/', import.meta.url));
const fixtures = {
 'catalog.json': {scope: [], reviews: [], syllabi: []},
 'university-courses.json': {},
 'full-reviews.json': {groups: [], reviews: []},
 'fitness.json': {weights: {}, groups: {}},
};
const files = Object.keys(fixtures);
const existing = files.filter(name => {
 const entry = fs.lstatSync(path.join(directory, name), {throwIfNoEntry: false});
 if (entry && !entry.isFile()) throw new Error(`目录数据路径不是普通文件：${name}`);
 return entry !== undefined;
});

if (existing.length === files.length) {
 console.log('目录数据已齐全。');
} else if (existing.length > 0) {
 throw new Error(`目录数据不完整，缺少 ${files.filter(name => !existing.includes(name)).join('、')}。`);
} else {
 fs.mkdirSync(directory, {recursive: true});
 const created = [];
 try {
  for (const [name, value] of Object.entries(fixtures)) {
   const target = path.join(directory, name);
   const fd = fs.openSync(target, 'wx');
   created.push(target);
   try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
   } finally {
    fs.closeSync(fd);
   }
  }
 } catch (error) {
  for (const target of created) fs.unlinkSync(target);
  throw error;
 }
 console.log('已生成本地开发用的空目录数据。');
}
