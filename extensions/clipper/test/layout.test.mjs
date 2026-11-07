import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const sandbox={};vm.runInNewContext(await readFile(new URL('../src/layout.js',import.meta.url),'utf8'),sandbox);const layout=sandbox.DoompileLayout.mobile;
const view={left:0,top:0,width:393,height:852};
for (const [name, selection] of Object.entries({top:{top:15,bottom:55},middle:{top:370,bottom:420},bottom:{top:700,bottom:750}})) {
 test('compact annotation reserves BOTH native menu sides near the '+name,()=>{
  const box=layout({view,selection,height:112});
  assert.equal(box.menuSide,'both');
  assert.ok(box.top+112<=selection.top-96 || box.top>=selection.bottom+96);
 });
}
test('full screen fills the visual viewport, including keyboard and pan offsets',()=>{const box=layout({view:{left:7,top:130,width:375,height:320},height:100,expanded:true});assert.deepEqual(JSON.parse(JSON.stringify(box)),{left:7,top:130,width:375,height:320,menuSide:null});});
