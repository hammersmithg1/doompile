import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/selection.js',import.meta.url),'utf8');
test('desktop pages do not install mobile listeners or prepare an editor',()=>{
 const sandbox={navigator:{userAgent:'Macintosh Safari',platform:'MacIntel',maxTouchPoints:0}};
 vm.runInNewContext(source,sandbox);assert.equal(sandbox.__doompileSelection,undefined);
});
