import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';

const coreSource=(await readFile(new URL('../src/contracts.js',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../src/core.js',import.meta.url),'utf8'));
const contentSource=await readFile(new URL('../src/content.js',import.meta.url),'utf8');
const source=coreSource+'\n'+(await readFile(new URL('../src/background.js',import.meta.url),'utf8'));
function setup(fetcher=async(url,options)=>new Response(JSON.stringify({note:{...JSON.parse(options.body).note,revision:1}}),{status:200}),server) {
  const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.test',name:'Test'};
  const data={};let listener,installed,clicked;const menus=[],injections=[];const noop=()=>{};
  const api={runtime:{id:'extension-id',getURL:s=>'chrome-extension://extension-id/'+s,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener:fn=>installed=fn},onStartup:{addListener:noop}},
    storage:{local:{get:async()=>structuredClone(data),set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete data[key];}}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{onAlarm:{addListener:noop}},contextMenus:{removeAll:async()=>{},create:item=>menus.push(item),onClicked:{addListener:fn=>clicked=fn}},scripting:{executeScript:async data=>{injections.push(data);return [{frameId:data.target.frameIds[0],result:data.func?{ok:true}:null}];}},tabs:{sendMessage:async()=>{throw new Error('Page commands must not use tabs.sendMessage');}}};
  const sandbox={browser:api,DoompileServer:server,URL,crypto:webcrypto,AbortSignal,fetch:async(url,options)=>url.endsWith('/api/session')&&options?.headers?.Authorization?Response.json({authenticated:true,user}):fetcher(url,options),console,setTimeout,clearTimeout};vm.runInNewContext(source,sandbox);
  const send=(message,sender={id:'extension-id',url:'chrome-extension://extension-id/popup.html'})=>new Promise(resolve=>listener({...message,...(['doompile:capture','doompile:capture-popup','doompile:tags'].includes(message.type)&&!Object.hasOwn(message,'account')?{account:data.connection?.user?.id?data.connection.endpoint+'|'+data.connection.user.id:null}:{})},sender,resolve));
  return {data,send,installed,clicked,menus,injections,api};
}
const outbox=data=>Object.fromEntries([...Object.entries(data.outbox||{}),...Object.entries(data).filter(([key])=>key.startsWith('clip:')).map(([,item])=>[item.note.id,item])]);
const capture={url:'https://example.com/article',title:'An article',quote:'Something useful',comment:'My thought'};
test('a capture is durably queued without connection and returns no credentials',async()=>{
  const {data,send}=setup();
  const result=await send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
  assert.equal(result.ok,true);assert.equal(result.configured,false);assert.equal(Object.keys(outbox(data)).length,1);assert.equal(result.token,undefined);
});
test('page content cannot read or configure the connection',async()=>{
  const {send}=setup();
  const result=await send({type:'doompile:configure',endpoint:'https://evil.test',token:'x'},{id:'extension-id',tab:{id:1}});
  assert.equal(result.error,'Неподдерживаемое действие расширения.');
});
test('concurrent captures do not overwrite each other',async()=>{
  const {data,send}=setup();
  await Promise.all(Array.from({length:12},()=>send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}})));
  assert.equal(Object.keys(outbox(data)).length,12);
});
test('failed uploads retain captures, successful retry removes them',async()=>{
  let fail=true;const requests=[];
  const {data,send}=setup(async(url,options)=>{requests.push({url,options});if(fail)throw new Error('Offline');return new Response(JSON.stringify({note:{...JSON.parse(options.body).note,revision:1}}),{status:200});});
  await send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-token'});
  await send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(Object.keys(outbox(data)).length,1);assert.equal(requests[0].options.headers.Authorization,'Bearer test-token');assert.equal(requests[0].options.redirect,'error');
  fail=false;await send({type:'doompile:retry'});
  assert.equal(Object.keys(outbox(data)).length,0);
});
test('an existing account sends its queued captures to the new origin after a server move',async()=>{
  const previousEndpoint='https://old.example.test',endpoint='https://notes.example.test';
  const before=setup(async()=>{throw new Error('Offline');});
  await before.send({type:'doompile:configure',endpoint:previousEndpoint,token:'test-token'});
  const clip=await before.send({type:'doompile:capture-popup',capture});
  await before.send({type:'doompile:retry'});
  assert.equal(Object.keys(outbox(before.data)).length,1);

  const requests=[];
  const after=setup(async(url,options)=>{
    requests.push({url,token:options.headers.Authorization});
    return Response.json({note:{...JSON.parse(options.body).note,revision:1}});
  },{endpoint,previousEndpoint});
  Object.assign(after.data,structuredClone(before.data));
  const status=await after.send({type:'doompile:retry'});
  assert.equal(status.endpoint,endpoint);
  assert.equal(status.queued,0);
  assert.deepEqual(requests,[{url:`${endpoint}/api/notes/${clip.id}`,token:'Bearer test-token'}]);
});
test('a duplicate already accepted before a lost response is acknowledged',async()=>{
  const {data,send}=setup(async(url,options)=>new Response(JSON.stringify({current:{...JSON.parse(options.body).note,revision:1}}),{status:409}));
  await send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-token'});
  await send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(Object.keys(outbox(data)).length,0);
});
test('unexpected successful responses never discard the durable capture',async()=>{
  const {data,send}=setup(async()=>new Response('{}',{status:200}));
  await send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-token'});
  await send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
  await new Promise(resolve=>setTimeout(resolve,10));
  const items=Object.values(outbox(data));
  assert.equal(items.length,1);assert.match(items[0].error,/неожиданный ответ/);
});

test('a capture receipt distinguishes queued from uploaded and isolates tabs',async()=>{
 let fail=true;
 const {data,send}=setup(async(url,options)=>{if(fail)throw new Error('Offline');return new Response(JSON.stringify({note:{...JSON.parse(options.body).note,revision:1}}));});
 await send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-token'});
 const result=await send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:4}});
 await new Promise(resolve=>setTimeout(resolve,10));
 const pending=await send({type:'doompile:receipt',id:result.id},{id:'extension-id',tab:{id:4}});
 assert.equal(pending.uploaded,false);assert.match(pending.error,/Offline/);
 const denied=await send({type:'doompile:receipt',id:result.id},{id:'extension-id',tab:{id:5}});
 assert.match(denied.error,/Неподдерживаемое/);
 fail=false;await send({type:'doompile:retry'});
 assert.equal((await send({type:'doompile:receipt',id:result.id},{id:'extension-id',tab:{id:4}})).uploaded,true);
 assert.equal(Object.keys(outbox(data)).length,0);
});
test('connection check validates the real notes API and does not report a false success',async()=>{
 let mode='invalid';
 const {send}=setup(async()=>mode==='unauthorized'?new Response('{}',{status:401}):new Response(JSON.stringify(mode==='valid'?{notes:[{deletedAt:null},{deletedAt:'2026-01-01'}]}:{})));
 await send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-token'});
 assert.match((await send({type:'doompile:check'})).error,/API Doompile/);
 mode='unauthorized';assert.match((await send({type:'doompile:check'})).error,/Ключ/);
 mode='valid';assert.equal((await send({type:'doompile:check'})).count,1);
});
test('receipt keeps the message alive until an in-flight upload is acknowledged',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);
 const {send}=setup(async(url,options)=>{await gate;return new Response(JSON.stringify({note:{...JSON.parse(options.body).note,revision:1}}));});
 await send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-token'});
 const saved=await send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:8}});
 let settled=false;const receipt=send({type:'doompile:receipt',id:saved.id},{id:'extension-id',tab:{id:8}}).then(value=>{settled=true;return value;});
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(settled,false);
 release();assert.equal((await receipt).uploaded,true);
});

test('image context menu forwards the clicked image and correct frame',async()=>{
 const api=setup();api.installed();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(api.menus.length,1);assert.ok(api.menus.every(m=>m.title==='Сохранить в Doompile'));
 const menu=api.menus.find(m=>m.id==='doompile-save');assert.deepEqual(Array.from(menu.contexts),['page','selection','image','video','link']);
 api.clicked({menuItemId:'doompile-save',mediaType:'image',srcUrl:'https://cdn.example.com/picture.png',pageUrl:'https://example.com/article',frameId:3},{id:7});
 await new Promise(resolve=>setTimeout(resolve,0));
 const command=api.injections.find(call=>call.func);assert.equal(command.target.tabId,7);assert.equal(command.args[0].imageUrl,'https://cdn.example.com/picture.png');assert.equal(command.args[0].pageUrl,'https://example.com/article');assert.equal(command.target.frameIds[0],3);assert.equal(api.injections[0].target.frameIds[0],3);
});

test('blank tokens never enable a development or remote account bypass',async()=>{
 const t=setup();
 for(const endpoint of ['http://localhost:3000','https://notes.example.com'])assert.match((await t.send({type:'doompile:configure',endpoint,token:''})).error,/ключ|Войди/);
 assert.equal(t.data.connection,undefined);
});

test('successful delivery removes a clip even when all storage writes are rejected at quota',async()=>{
 const t=setup();const clip=await t.send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
 t.data.connection={endpoint:'https://notes.example.com',token:'test',user:{id:'11111111-1111-4111-8111-111111111111'}};
 for(const item of Object.values(outbox(t.data)))item.owner=t.data.connection.endpoint+'|'+t.data.connection.user.id;
 t.api.storage.local.set=async()=>{throw new Error('Exceeded storage quota');};
 const result=await t.send({type:'doompile:retry'});assert.equal(result.queued,0);assert.equal(Object.keys(outbox(t.data)).length,0);assert.ok(clip.ok);
});
test('legacy queue is drained without rewriting or dropping unsent clips at quota',async()=>{
 let offline=true;const t=setup(async(url,options)=>{const note=JSON.parse(options.body).note;if(note.title==='Pending'&&offline)throw new Error('Offline');return new Response(JSON.stringify({current:{...note,revision:1}}),{status:409});});
 await t.send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
 await t.send({type:'doompile:capture',capture:{...capture,title:'Pending'}},{id:'extension-id',tab:{id:1}});
 t.data.outbox=structuredClone(outbox(t.data));for(const key of Object.keys(t.data))if(key.startsWith('clip:'))delete t.data[key];
 t.data.connection={endpoint:'https://notes.example.com',token:'test',user:{id:'11111111-1111-4111-8111-111111111111'}};
 for(const item of Object.values(outbox(t.data)))item.owner=t.data.connection.endpoint+'|'+t.data.connection.user.id;
 const original=JSON.stringify(t.data.outbox);
 t.api.storage.local.set=async()=>{throw new Error('Exceeded storage quota');};
 assert.equal((await t.send({type:'doompile:retry'})).queued,1);assert.equal(JSON.stringify(t.data.outbox),original);
 offline=false;assert.equal((await t.send({type:'doompile:retry'})).queued,0);assert.equal(t.data.outbox,undefined);
});
test('context-menu injection failures are shown instead of being silently swallowed',async()=>{
 const t=setup();t.api.scripting.executeScript=async()=>{throw new Error('Site permission denied');};
 t.clicked({menuItemId:'doompile-save'},{id:7});await new Promise(resolve=>setTimeout(resolve,5));
 assert.match((await t.send({type:'doompile:status'})).error,/Не удалось открыть аннотацию/);
});
test('a full queue reports failure without claiming that a new clip was saved',async()=>{
 const t=setup();t.api.storage.local.set=async()=>{throw new Error('Quota');};
 const result=await t.send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:1}});
 assert.match(result.error,/хранилище расширения заполнено/);assert.equal(result.ok,undefined);assert.equal(Object.keys(outbox(t.data)).length,0);
});

test('link context forwards destination and label to the annotation composer',async()=>{
 const t=setup();t.clicked({menuItemId:'doompile-save',linkUrl:'https://example.com/target',linkText:'Linked article',pageUrl:'https://example.com/source'},{id:5});await new Promise(resolve=>setTimeout(resolve,0));
 const command=t.injections.find(call=>call.func);assert.equal(command.args[0].linkUrl,'https://example.com/target');assert.equal(command.args[0].linkText,'Linked article');
});
test('toolbar capture is accepted only from trusted popup and reports acknowledgement',async()=>{
 const t=setup();
 const denied=await t.send({type:'doompile:capture-popup',capture},{id:'extension-id',tab:{id:1}});assert.match(denied.error,/Неподдерживаемое/);
 await t.send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test'});
 const saved=await t.send({type:'doompile:capture-popup',capture:{...capture,articleText:'Saved article text'}});assert.equal(saved.ok,true);
 await t.send({type:'doompile:retry'});const status=await t.send({type:'doompile:status'});
 assert.equal(status.delivery.state,'uploaded');assert.equal(status.delivery.articleCharacters,undefined);
});

test('delivery confirmation requests the real toolbar popup and survives a browser denial',async()=>{
 const t=setup();let attempts=0;const popups=[];t.api.action.setPopup=async value=>popups.push(value.popup);t.api.action.openPopup=async()=>{attempts++;throw new Error('Gesture required');};
 const saved=await t.send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:9}});
 assert.equal((await t.send({type:'doompile:show-delivery',id:saved.id},{id:'extension-id',tab:{id:9}})).ok,true);
 assert.equal(attempts,1);assert.equal(popups[0],'receipt.html?id='+saved.id);assert.equal(popups.at(-1),'popup.html');const status=await t.send({type:'doompile:status'});assert.equal(status.delivery.id,saved.id);assert.equal(status.delivery.state,'queued');assert.equal(status.queued,1);
});

test('a selected quote keeps priority when its text contains a link',async()=>{
 const t=setup();t.clicked({menuItemId:'doompile-save',selectionText:'Selected linked words',linkUrl:'https://example.com/target'},{id:5});await new Promise(resolve=>setTimeout(resolve,0));
 const command=t.injections.find(call=>call.func);assert.equal(command.args[0].selectionText,'Selected linked words');assert.equal(command.args[0].linkUrl,undefined);
});

test('page inspection reads the actual isolated content bridge even when tabs messages have no response',async()=>{
 const t=setup();t.api.tabs.query=async()=>[{id:11}];t.api.tabs.sendMessage=async()=>undefined;
 const page=vm.createContext({browser:{runtime:{id:'page-runtime-id',onMessage:{addListener(){},removeListener(){}}}},URL,document:{title:'Actual page',querySelector:()=>null},window:{getSelection:()=>({toString:()=> 'Exact live selection',rangeCount:0})},location:{href:'https://example.com/actual',hostname:'example.com'},innerHeight:800});
 t.api.scripting.executeScript=async request=>{
  assert.equal(request.target.tabId,11);assert.equal(request.target.frameIds[0],0);assert.equal(request.world,undefined);
  if(request.files){vm.runInContext(coreSource,page);vm.runInContext(contentSource,page);return [{frameId:0}];}
  const dispatch=vm.runInContext('('+request.func.toString()+')',page);
  return [{frameId:0,result:dispatch(...JSON.parse(JSON.stringify(request.args)))}];
 };
 const result=await t.send({type:'doompile:inspect'});
 assert.equal(result.url,'https://example.com/actual');assert.equal(result.title,'Actual page');assert.equal(result.quote,'Exact live selection');
});
test('resolved injection errors report the real script failure rather than a missing-message error',async()=>{
 const t=setup();let commands=0;t.api.tabs.query=async()=>[{id:11}];
 t.api.scripting.executeScript=async request=>{commands++;return [{frameId:0,error:{message:'Unexpected token in content script'}}];};
 const result=await t.send({type:'doompile:inspect'});assert.match(result.error,/Unexpected token in content script/);assert.equal(commands,1);
});
test('a missing iframe result falls back explicitly to frame zero',async()=>{
 const t=setup();const frames=[];
 t.api.scripting.executeScript=async request=>{frames.push(request.target.frameIds[0]);return request.files?[{frameId:request.target.frameIds[0]}]:request.target.frameIds[0]===3?[]:[{frameId:0,result:{ok:true}}];};
 t.clicked({menuItemId:'doompile-save',selectionText:'Frame quote',frameId:3},{id:7});await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(frames,[3,3,0,0]);assert.equal((await t.send({type:'doompile:status'})).error,null);
});
test('silently skipped content files produce an explicit page-access error',async()=>{
 const t=setup();t.api.tabs.query=async()=>[{id:11}];const page=vm.createContext({});
 t.api.scripting.executeScript=async request=>request.files?[{frameId:0}]:[{frameId:0,result:vm.runInContext('('+request.func.toString()+')',page)(...request.args)}];
 const result=await t.send({type:'doompile:inspect'});assert.match(result.error,/Скрипт Doompile не запущен/);assert.match(result.error,/доступ/);assert.equal(result.url,undefined);
});

test('lazy editor targets the requesting content frame and receipt status never invents a delivery',async()=>{
 const t=setup();assert.equal((await t.send({type:'doompile:load-editor'},{id:'extension-id',tab:{id:7},frameId:3})).ok,true);assert.equal(t.injections[0].target.frameIds[0],3);assert.deepEqual(Array.from(t.injections[0].files),['rich-editor.js']);
 assert.equal((await t.send({type:'doompile:receipt-status',id:'missing'})).state,'unknown');
 const saved=await t.send({type:'doompile:capture-popup',capture});assert.equal((await t.send({type:'doompile:receipt-status',id:saved.id})).state,'queued');
});

test('old PDF jobs retain their note but no longer download or call the renderer',async()=>{
 const calls=[];const t=setup(async(url,options)=>{calls.push(url);return new Response(JSON.stringify({note:{...JSON.parse(options.body).note,revision:1}}));});
 t.data.connection={endpoint:'https://notes.example.com',token:'test',user:{id:'11111111-1111-4111-8111-111111111111'}};
 t.data['clip:legacy']={note:{id:'legacy',title:'Keep',body:{type:'doc',content:[]},plainText:'Keep'},archive:{html:'old snapshot'},noteAccepted:true,attempts:0,nextAttempt:0};
 assert.equal((await t.send({type:'doompile:retry'})).queued,0);assert.equal(calls.length,0);assert.ok(t.data['clip:legacy']);
});
test('Chromium reading list receives the source URL and does not duplicate existing entries',async()=>{
 const t=setup();let adds=0;const entries=[];t.api.readingList={query:async()=>entries,addEntry:async entry=>{adds++;entries.push(entry);}};
 const saved=await t.send({type:'doompile:capture-popup',capture,readingList:true});assert.equal(saved.ok,true);assert.equal(entries[0].url,capture.url);assert.equal(outbox(t.data)[saved.id].note.source.url,capture.url);
 assert.equal((await t.send({type:'doompile:capture-popup',capture,readingList:true})).ok,true);assert.equal(adds,1);
});
test('Safari reading list uses native messaging without exposing the app connection',async()=>{
 const t=setup();let native;t.api.runtime.getManifest=()=>({permissions:['nativeMessaging']});t.api.runtime.sendNativeMessage=async(host,message)=>{native={host,message};return {ok:true};};
 const saved=await t.send({type:'doompile:capture',capture,readingList:true},{id:'extension-id',tab:{id:2}});assert.equal(saved.ok,true);assert.equal(native.message.type,'reading-list:add');assert.equal(native.message.url,capture.url);assert.equal(native.message.token,undefined);assert.equal(native.host,'app.doompile');
});
test('unavailable native reading list never loses an already captured note',async()=>{
 const t=setup();t.api.runtime.getManifest=()=>({permissions:['nativeMessaging']});t.api.runtime.sendNativeMessage=async()=>{throw new Error('No containing app');};
 const result=await t.send({type:'doompile:capture-popup',capture,readingList:true});assert.equal(result.ok,true);const receipt=await t.send({type:'doompile:receipt-status',id:result.id});assert.match(receipt.warning,/Doompile.app/);assert.equal(Object.keys(outbox(t.data)).length,1);
 assert.equal((await t.send({type:'doompile:capture-popup',capture,readingList:false})).ok,true);
});

test('content requests receive a second acknowledgement in the same isolated frame',async()=>{
 const t=setup();const requestId='nonce';const result=await t.send({type:'doompile:capture',capture,requestId},{id:'extension-id',tab:{id:7},frameId:3});
 await new Promise(resolve=>setTimeout(resolve,0));
 const ack=t.injections.find(call=>call.args?.[0]===requestId);
 assert.equal(ack.target.tabId,7);assert.deepEqual(Array.from(ack.target.frameIds),[3]);assert.equal(ack.world,undefined);assert.equal(ack.args[1].id,result.id);
 let received;const page={__doompileClipper:{settle:(id,value)=>received={id,value}}};
 vm.runInNewContext('('+ack.func.toString()+')',page)(...ack.args);assert.equal(received.value.ok,true);
});
test('retry after a lost acknowledgement uses the same note identity and server payload',async()=>{
 const requests=[];const t=setup(async(url,options)=>{requests.push(JSON.parse(options.body).note);return new Response(JSON.stringify({note:{...requests.at(-1),revision:1}}));});
 await t.send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test'});
 const message={type:'doompile:capture',capture,captureId:'17c5b352-325f-4e2a-9a03-74baf248ab85',captureAt:'2026-10-30T10:00:00.000Z'};
 const first=await t.send(message,{id:'extension-id',tab:{id:7}});await t.send({type:'doompile:retry'});
 const second=await t.send(message,{id:'extension-id',tab:{id:7}});await t.send({type:'doompile:retry'});
 assert.equal(first.id,second.id);assert.ok(requests.length>=2);assert.equal(JSON.stringify(requests[0]),JSON.stringify(requests.at(-1)));
});

test('mobile preparation loads only the requesting frame and opens no composer or network request',async()=>{
 let network=0;const t=setup(async()=>{network++;throw new Error('Unexpected network');});
 const result=await t.send({type:'doompile:prepare-mobile'},{id:'extension-id',tab:{id:17},frameId:4});
 assert.equal(result.ok,true);assert.equal(network,0);assert.deepEqual(Array.from(t.injections[0].files),['core.js','transport.js','layout.js','composer.js','content.js']);assert.equal(t.injections[0].target.frameIds[0],4);assert.equal(t.injections[1].args[0].type,'doompile:ready');
});
test('mobile delivery receipt offers a note link only after the server acknowledgement',async()=>{
 const t=setup();await t.send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test'});
 const saved=await t.send({type:'doompile:capture',capture},{id:'extension-id',tab:{id:7}});
 const receipt=await t.send({type:'doompile:receipt',id:saved.id},{id:'extension-id',tab:{id:7}});
 assert.equal(receipt.uploaded,true);assert.equal(receipt.noteURL,'https://notes.example.com/notes/'+saved.id);assert.equal(receipt.token,undefined);
});

test('switching accounts hides old queues and rejects stale composers without moving captures',async()=>{
 const requests=[];const t=setup(async(url,options)=>{requests.push({url,options});throw new Error('Offline');});
 await t.send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'test-a'});
 const owner=t.data.connection.endpoint+'|'+t.data.connection.user.id;
 await t.send({type:'doompile:capture-popup',account:owner,capture});
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await t.send({type:'doompile:status'})).queued,1);
 t.data.connection={endpoint:'https://notes.example.com',token:'test-b',user:{id:'22222222-2222-4222-8222-222222222222',email:'b@example.test'}};
 const count=requests.length;
 const status=await t.send({type:'doompile:retry'});assert.equal(status.queued,0);assert.deepEqual(Array.from(status.items),[]);assert.equal(requests.length,count);
 assert.match((await t.send({type:'doompile:capture-popup',account:owner,capture})).error,/Аккаунт изменился/);
 assert.match((await t.send({type:'doompile:tags',account:owner})).error,/Аккаунт изменился/);
 assert.equal(Object.keys(outbox(t.data)).length,1);assert.equal(Object.values(outbox(t.data))[0].owner,owner);
});
test('unowned clips are preserved but never adopted or uploaded after personal login',async()=>{
 const t=setup();const saved=await t.send({type:'doompile:capture-popup',capture});
 assert.equal(saved.ok,true);assert.deepEqual(Array.from((await t.send({type:'doompile:status'})).items),[]);
 await t.send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'personal'});
 assert.equal((await t.send({type:'doompile:retry'})).queued,0);assert.ok(outbox(t.data)[saved.id]);
});

test('late Reading List errors and receipts never reveal a previous account source',async()=>{
 const t=setup();await t.send({type:'doompile:configure',endpoint:'https://notes.example.com',token:'a'});
 let rejectReading;const reading=new Promise((_,reject)=>{rejectReading=reject;});
 t.api.runtime.getManifest=()=>({permissions:['nativeMessaging']});t.api.runtime.sendNativeMessage=()=>reading;
 const pending=t.send({type:'doompile:capture-popup',capture,readingList:true});
 await new Promise(resolve=>setTimeout(resolve,0));
 t.data.connection={endpoint:'https://notes.example.com',token:'b',user:{id:'22222222-2222-4222-8222-222222222222',email:'bob@example.test'}};
 rejectReading(new Error('private-source https://alice-private.example'));const saved=await pending;
 const status=await t.send({type:'doompile:status'});
 const receipt=await t.send({type:'doompile:receipt-status',id:saved.id});
 const content=await t.send({type:'doompile:receipt',id:saved.id},{id:'extension-id',tab:{id:1}});
 assert.equal(status.error,null);assert.equal(receipt.warning,null);assert.equal(content.warning,null);assert.equal(content.uploaded,false);
 assert.equal(JSON.stringify([status,receipt,content]).includes('alice-private'),false);
});
