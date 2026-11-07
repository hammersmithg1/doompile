import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const built=await build({entryPoints:[new URL('../src/telemetry.ts',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'DoompileTelemetryRuntime',target:'safari17'});
const source=built.outputFiles[0].text+'\n'+await readFile(new URL('../src/contracts.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../src/core.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../src/background.js',import.meta.url),'utf8');
function setup(data={}) {
  let listener;
  const event={addListener(){}};
  const api={runtime:{id:'extension-id',getURL:name=>'chrome-extension://extension-id/'+name,onMessage:{addListener(fn){listener=fn;}},onInstalled:event,onStartup:event},storage:{local:{async get(key){if(key===null)return structuredClone(data);return Object.fromEntries((Array.isArray(key)?key:[key]).map(name=>[name,structuredClone(data[name])]));},async set(values){Object.assign(data,structuredClone(values));},async remove(key){for(const name of Array.isArray(key)?key:[key])delete data[name];}}},alarms:{onAlarm:event},contextMenus:{onClicked:event},action:{async setBadgeText(){},async setBadgeBackgroundColor(){}}};
  const sandbox={browser:api,DoompileBuild:{platform:'clipper_chromium',release:'test.1'},URL,Headers,AbortSignal,crypto:webcrypto,performance,setTimeout,clearTimeout,fetch:async()=>{throw new TypeError('private URL and token must never appear');}};
  vm.runInNewContext(source,sandbox);
  const send=(message,sender={id:'extension-id',url:'chrome-extension://extension-id/popup.html'})=>new Promise(resolve=>listener(message,sender,resolve));
  return {send,data};
}
test('clipper exports a durable offline journal without exporting connection credentials or captured content',async()=>{
  const {send,data}=setup();
  await send({type:'doompile:telemetry',name:'editor.failed',properties:{error_code:'unknown',token:'secret',plainText:'private capture'}},{id:'extension-id',tab:{id:1}});
  const dump=await send({type:'doompile:diagnostics'});
  assert.equal(dump.format,'doompile-diagnostics');assert.ok(dump.events.some(event=>event.name==='editor.failed'));
  assert.ok(!JSON.stringify(dump).includes('secret'));assert.ok(!JSON.stringify(dump).includes('private capture'));
  const restart=setup(data);const later=await restart.send({type:'doompile:diagnostics'});
  assert.ok(later.events.some(event=>event.id===dump.events.find(event=>event.name==='editor.failed').id));
});
test('content scripts cannot read dumps or change telemetry preferences; account journals stay isolated',async()=>{
  const data={connection:{endpoint:'https://notes.test',token:'secret-token',user:{id:'11111111-1111-4111-8111-111111111111'}}};
  const {send}=setup(data);
  assert.match((await send({type:'doompile:diagnostics'},{id:'extension-id',tab:{id:1}})).error,/Неподдерживаемое/);
  assert.match((await send({type:'doompile:diagnostics-enabled',enabled:false},{id:'extension-id',tab:{id:1}})).error,/Неподдерживаемое/);
  await send({type:'doompile:telemetry',name:'editor.failed',properties:{error_code:'quota'}},{id:'extension-id',tab:{id:1}});
  const first=await send({type:'doompile:diagnostics'});
  assert.ok(!JSON.stringify(first).includes('secret-token'));
  data.connection.user.id='22222222-2222-4222-8222-222222222222';
  const other=await send({type:'doompile:diagnostics'});
  assert.ok(!other.events.some(event=>event.id===first.events.find(event=>event.name==='editor.failed').id));
  await send({type:'doompile:diagnostics-enabled',enabled:false});
  assert.equal((await send({type:'doompile:diagnostics-state'})).enabled,false);
});
