import test from 'node:test';
import assert from 'node:assert/strict';
import {hasVisibleReaderContent,shouldAutoCollapseReaderSidebar} from '../dist/reader-content.mjs';

test('empty parent reader can collapse while text and non-text content stay visible',()=>{
 assert.equal(hasVisibleReaderContent(' \n\t\u00a0\u200b\ufeff '),false);
 assert.equal(hasVisibleReaderContent('真实正文'),true);
 assert.equal(hasVisibleReaderContent('',true),true);
 assert.equal(shouldAutoCollapseReaderSidebar(true,false),true);
 assert.equal(shouldAutoCollapseReaderSidebar(true,true),false);
 assert.equal(shouldAutoCollapseReaderSidebar(false,false),false);
});
test('course home keeps its note visible while the duplicate sidebar defaults closed',()=>{
 assert.equal(hasVisibleReaderContent('用户确认的栏目说明'),true);
 assert.equal(shouldAutoCollapseReaderSidebar(true,true,true),true);
 assert.equal(shouldAutoCollapseReaderSidebar(false,true,true),false);
 assert.equal(shouldAutoCollapseReaderSidebar(true,true,false),false);
});
