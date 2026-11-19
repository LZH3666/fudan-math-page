import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseOfficialWindow} from '../scripts/install-university-courses.mjs';
test('a completed expanded official window survives imports from the running narrower review collector',()=>{
 const small={coverage:{catalog_terms:['2025-2026秋','2026-2027秋']}},large={coverage:{complete:true,catalog_terms:['2022-2023秋',...small.coverage.catalog_terms]}};
 assert.equal(chooseOfficialWindow(small,large),large);
 assert.equal(chooseOfficialWindow(small,{coverage:{...large.coverage,complete:false}}),small);
 assert.equal(chooseOfficialWindow(small,null),small);
 assert.equal(chooseOfficialWindow({coverage:{catalog_terms:['2099-2100秋']}},large).coverage.catalog_terms[0],'2099-2100秋');
});
