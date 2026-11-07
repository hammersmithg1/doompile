import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {asciiScript} from '../script-encoding.mjs';
test('background messages preserve Cyrillic and emoji regardless of script charset',()=>{
 const source="globalThis.message = `Сначала укажи адрес хранилища. ✓ 🚀`;";
 const encoded=asciiScript(source);assert.doesNotMatch(encoded,/[^\x00-\x7f]/);
 const sandbox={};vm.runInNewContext(encoded,sandbox);assert.equal(sandbox.message,'Сначала укажи адрес хранилища. ✓ 🚀');
});
