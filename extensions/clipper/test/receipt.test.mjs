import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
const design=await readFile(new URL('../src/design.generated.js',import.meta.url),'utf8');
const source=await readFile(new URL('../src/receipt.js',import.meta.url),'utf8');
test('receipt is compact, distinguishes queue from upload, and closes after 2.2 seconds',async()=>{
 let timer,poll,closed=0,mode='queued',delay;const nodes=[];
 const element=()=>{const node={textContent:'',children:[],setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};nodes.push(node);return node;};
 const sandbox={browser:{runtime:{sendMessage:async()=>({state:mode,noteURL:mode==='uploaded'?'https://notes.example.com/?note=clip':null})}},document:{getElementById:()=>null,createElementNS:element,createElement:element},window:{close(){closed++;},addEventListener(){}},setInterval:fn=>{poll=fn;return 1;},clearInterval(){},setTimeout:(fn,ms)=>{timer=fn;delay=ms;return 2;},clearTimeout(){}};
 vm.runInNewContext(design,sandbox);vm.runInNewContext(source,sandbox);const root=element();sandbox.DoompileReceipt.mount(root,'clip');await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes.find(n=>n.className==='receipt-text').textContent,'Сохранено · в очереди');mode='uploaded';poll();await new Promise(resolve=>setImmediate(resolve));assert.equal(nodes.find(n=>n.className==='receipt-text').textContent,'Отправлено');assert.equal(nodes.find(n=>n.className==='receipt-link').href,'https://notes.example.com/?note=clip');assert.equal(nodes.find(n=>n.className==='receipt-link').hidden,false);assert.equal(delay,2200);timer();assert.equal(closed,1);assert.equal(root.hidden,true);
});
