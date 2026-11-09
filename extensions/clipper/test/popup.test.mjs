import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const design=await readFile(new URL('../src/design.generated.js',import.meta.url),'utf8');
const transport=await readFile(new URL('../src/transport.js',import.meta.url),'utf8');
const core=(await readFile(new URL('../src/contracts.js',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../src/core.js',import.meta.url),'utf8')),source=await readFile(new URL('../src/popup.js',import.meta.url),'utf8');
async function setup(){
 const nodes=new Map(),sent=[],permissions=[],view={};let mounted,receipt;
 function node(id){if(!nodes.has(id))nodes.set(id,{value:'',defaultValue:'',hidden:true,textContent:'',className:'',classList:{toggle(){}},listeners:{},classList:{toggle(){}},addEventListener(name,fn){this.listeners[name]=fn;},replaceChildren(){},append(){},setAttribute(){}});return nodes.get(id);}
 const browser={runtime:{getManifest:()=>({permissions:[]}),getURL:s=>'chrome-extension://test/'+s,sendMessage:async m=>{sent.push(m);return m.type==='doompile:status'?{configured:false,endpoint:'http://localhost:3000',queued:0}:m.type==='doompile:inspect'?{title:'Article',url:'https://example.com',video:true,timestampSeconds:0}:{ok:true,id:'saved'};}},permissions:{contains:async p=>{permissions.push(p);return true;},request:async p=>{permissions.push(p);return true;}}};
 const sandbox={browser,URL,crypto:webcrypto,setTimeout,clearTimeout,document:{getElementById:node,querySelector:()=>node('gear-svg'),createElementNS:()=>node(Math.random()),createElement:()=>node(Math.random()),documentElement:node('html')},window:{addEventListener(){}},setInterval:()=>0,clearInterval(){},DoompileComposer:{mount(options){mounted=options;return {focus(){view.focused=true;},setReady(v){view.ready=v;},setContext(v){view.context=v;},destroy(){view.destroyed=true;}};}},DoompileReceipt:{mount(root,id){receipt=id;return {destroy(){}};}}};
 vm.runInNewContext(design,sandbox);vm.runInNewContext(core,sandbox);vm.runInNewContext(transport,sandbox);await vm.runInNewContext(source,sandbox);
 return {node,sent,permissions,view,submit:values=>mounted.onSubmit(values),get receipt(){return receipt;}};
}
test('popup keeps port-free permission patterns and preserves the API port',async()=>{
 const t=await setup();t.node('endpoint').value='http://localhost:3000';t.node('token').value='';await t.node('connection-form').listeners.submit({preventDefault(){}});await t.node('grant').listeners.click();for(const p of t.permissions)assert.equal(p.origins[0],'http://localhost/*');assert.equal(t.sent.find(m=>m.type==='doompile:configure').endpoint,'http://localhost:3000');
});
test('popup starts the shared composer, settings require the gear, and save replaces it with a receipt',async()=>{
 const t=await setup();assert.equal(t.node('settings').hidden,true);assert.equal(t.node('capture').hidden,false);assert.equal(t.view.focused,true);assert.equal(t.view.ready,true);assert.equal(t.view.context.timestampSeconds,0);
 t.node('settings-toggle').listeners.click();assert.equal(t.node('settings').hidden,false);t.node('back').listeners.click();assert.equal(t.node('settings').hidden,true);
 await t.submit({comment:'My thought',timestampSeconds:154,readingList:true});const capture=t.sent.find(m=>m.type==='doompile:capture-popup').capture;assert.equal(capture.comment,'My thought');assert.equal(capture.timestampSeconds,154);assert.equal(t.sent.find(m=>m.type==='doompile:capture-popup').readingList,true);assert.equal(t.sent.some(m=>m.type==='doompile:archive'),false);assert.equal(t.view.destroyed,true);assert.equal(t.receipt,'saved');assert.equal(t.node('capture').hidden,true);assert.equal(t.node('html').className,'receipt-mode');
});
