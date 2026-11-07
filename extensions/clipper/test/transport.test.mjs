import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../src/transport.js',import.meta.url),'utf8');
function setup(sendMessage){const sandbox={crypto:webcrypto,setTimeout,clearTimeout};vm.runInNewContext(source,sandbox);return sandbox.DoompileTransport.create({runtime:{sendMessage}});}
test('a lost Safari callback is recovered through the isolated response bridge',async()=>{
 let sent;const transport=setup(message=>{sent=message;return new Promise(()=>{});});
 const pending=transport.request({type:'doompile:capture'},100);
 transport.settle('another-frame-nonce',{ok:false});transport.settle(sent.requestId,{ok:true,id:'saved'});
 assert.equal((await pending).id,'saved');
});
test('a stalled background unlocks the editor with an actionable error',async()=>{
 const transport=setup(()=>new Promise(()=>{}));await assert.rejects(transport.request({type:'doompile:load-editor'},5),/Расширение не ответило/);
});
test('closing a composer invalidates pending replies without applying them to its successor',async()=>{
 let sent;const transport=setup(message=>{sent=message;return new Promise(()=>{});});
 const request=transport.request({type:'doompile:load-editor'});transport.destroy();await assert.rejects(request,/закрыт/);transport.settle(sent.requestId,{ok:true});
});
test('a rejected reply port still allows the independent acknowledgement to succeed',async()=>{
 let sent;const transport=setup(message=>{sent=message;return Promise.reject(new Error('Message port closed'));});
 const request=transport.request({type:'doompile:capture'},100);await new Promise(resolve=>setTimeout(resolve,0));transport.settle(sent.requestId,{ok:true,id:'saved'});assert.equal((await request).id,'saved');
});
