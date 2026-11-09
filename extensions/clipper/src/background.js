(function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const core = globalThis.DoompileCore;
  const telemetry = globalThis.DoompileTelemetryRuntime?.extensionTelemetry(api, globalThis.DoompileBuild, core);
  const fetch = telemetry ? telemetry.fetch : globalThis.fetch.bind(globalThis);
  const flushTelemetry = () => telemetry?.flush().catch(() => {});
  const forwardedEvents = new Set(['editor.ready','editor.action','editor.failed','runtime.error','clipper.opened','clipper.failed']);
  globalThis.addEventListener?.('error', event => telemetry?.error('runtime.error',event.error));
  globalThis.addEventListener?.('unhandledrejection', event => telemetry?.error('runtime.error',event.reason));
  let serial = Promise.resolve();
  let flushing = false;
  let flushPromise;
  let lastError=null;
  let lastDelivery=null;
  const readingListErrors=new Map();
  const acknowledgedLegacy=new Set();
  const transientErrors=new Map();
  const queueKey=id=>'clip:'+id;
  function exclusive(work) {
    const job = serial.then(work, work);
    serial = job.catch(() => {});
    return job;
  }
  const trustedUI = sender => sender.id === api.runtime.id && !sender.tab && sender.url?.startsWith(api.runtime.getURL(''));
  const configured = connection => !!(connection?.token && connection?.user?.id);
  const accountKey = connection => configured(connection) ? core.scopeEndpoint(connection.endpoint)+'|'+connection.user.id : null;
  const authHeaders = connection => ({'X-Doompile-API-Version':String(globalThis.DoompileContracts.apiVersion),...(connection.token ? {Authorization:'Bearer '+connection.token,'X-Doompile-User-ID':connection.user?.id||''} : {})});
  function canUseReadingList(){return !!api.readingList?.addEntry || !!(api.runtime.getManifest?.().permissions?.includes('nativeMessaging'));}
  function bounded(work, milliseconds, message){let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));}
  async function addToReadingList(note){
    const url=core.sourceURL(note.source?.url);
    if(api.readingList?.addEntry){
      const existing=await api.readingList.query({url});
      if(!existing.length)await api.readingList.addEntry({url,title:note.source?.title||note.title,hasBeenRead:false});
      return;
    }
    if(!api.runtime.sendNativeMessage || !canUseReadingList())throw new Error('Список чтения недоступен в этом браузере. Сними галочку, чтобы сохранить заметку со ссылкой.');
    try{
      const result=await api.runtime.sendNativeMessage('app.doompile',{type:'reading-list:add',url,title:note.source?.title||note.title,previewText:note.source?.quote?.slice(0,500)||''});
      if(!result?.ok)throw new Error(result?.error||'Список чтения не подтвердил добавление.');
    }catch(error){throw new Error('Не удалось добавить в список чтения Safari. Используй расширение из Doompile.app вместо временной папки; или сними галочку и сохрани заметку. '+String(error.message||''));}
  }
  async function makeConnection(endpoint, token) {
    const connection={endpoint:core.endpoint(endpoint),token:String(token||'').trim()};
    if(!connection.token)throw new Error('Войди через браузер или укажи персональный ключ доступа.');
    const response=await fetch(connection.endpoint+'/api/session',{headers:{Authorization:'Bearer '+connection.token},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Не удалось проверить аккаунт.');
    const result=await response.json();
    if(!result.authenticated || !result.user?.id)throw new Error('Ключ не подошёл. Войди через браузер.');
    return {...connection,user:{id:result.user.id,email:result.user.email,name:result.user.name}};
  }
  async function state() {
    const data=await api.storage.local.get(null);
    const saved=data.connection;
    const connection=saved?{...saved,endpoint:core.currentEndpoint(saved.endpoint)}:null;
    const outbox={},owner=accountKey(connection);
    for(const [id,item] of Object.entries(data.outbox||{}))if(!acknowledgedLegacy.has(id)&&(item.owner||null)===owner)outbox[id]=transientErrors.get(id)||item;
    for(const [key,item] of Object.entries(data))if(key.startsWith('clip:')&&item?.note?.id&&(item.owner||null)===owner)outbox[item.note.id]=transientErrors.get(item.note.id)||item;
    const recent=lastDelivery||data.lastDelivery;
    return {connection,outbox,delivery:recent&&(recent.owner||null)===owner?recent:null};
  }
  async function removeQueued(id) {
    // Removal must not rewrite the entire queue: it must work even at the quota limit.
    await api.storage.local.remove(queueKey(id));transientErrors.delete(id);
    const {outbox}=await api.storage.local.get('outbox');
    if(outbox?.[id]){
      acknowledgedLegacy.add(id);
      if(Object.keys(outbox).every(key=>acknowledgedLegacy.has(key)))await api.storage.local.remove('outbox');
    }
  }
  async function delivery(item,state) {
    lastDelivery={owner:item.owner||null,id:item.note.id,title:item.note.title,state,at:Date.now(),warning:readingListErrors.get(item.note.id)||item.readingListError||null};
    try{await api.storage.local.set({lastDelivery});}catch{}
  }
  async function recordFailure(item,error) {
    telemetry?.error('sync.failed',error,{pending:1});
    const next={...item,attempts:item.attempts+1,nextAttempt:Date.now()+core.retryDelay(item.attempts),error:String(error.message||error)};
    transientErrors.set(item.note.id,next);
    const stored=await api.storage.local.get(queueKey(item.note.id));
    if(stored[queueKey(item.note.id)])try{await api.storage.local.set({[queueKey(item.note.id)]:next});}catch{/* Keep the existing durable clip even if there is no room for error metadata. */}
  }
  async function badge() {
    try {
      const {outbox} = await state();
      const count = Object.keys(outbox).length;
      await api.action?.setBadgeText?.({text: count || lastError ? '!' : ''});
      await api.action?.setBadgeBackgroundColor?.({color:'#ff6832'});
      await api.action?.setTitle?.({title:lastError || (count ? `Doompile · ждут отправки: ${count}. Открой, чтобы проверить соединение.` : 'Сохранить в Doompile')});
    } catch { /* A badge failure must never make a persisted capture look lost. */ }
  }
  async function status() {
    const {connection, outbox, delivery} = await state();
    const queued = Object.values(outbox);
    return {delivery:delivery&&Date.now()-delivery.at<600000?delivery:null,configured:configured(connection), endpoint:connection?.endpoint || '', user:configured(connection)?connection.user:null, account:accountKey(connection), queued:queued.length, items:configured(connection)?queued.map(x=>({title:x.note.title,error:x.error})):[], error:lastError || queued.find(x=>x.error)?.error || (delivery&&Date.now()-delivery.at<600000?delivery.warning:null) || null};
  }
  async function flush(force = false) {
    if (flushing) { await flushPromise; if(force)return flush(true); return; }
    flushing = true;
    let finish; flushPromise=new Promise(resolve=>finish=resolve);
    try {
      const {connection, outbox} = await state();
      if (!connection?.endpoint || !configured(connection)) return;
      telemetry?.record('sync.started',{pending:Object.keys(outbox).length,pull:false},undefined,connection);
      for (const item of Object.values(outbox)) {
        if (!force && item.nextAttempt > Date.now()) continue;
        try {
          if(!item.noteAccepted){
          const response = await fetch(`${connection.endpoint}/api/notes/${encodeURIComponent(item.note.id)}`, {
            method:'PUT', headers:{'Content-Type':'application/json', ...authHeaders(connection)},
            body:JSON.stringify({note:item.note, baseRevision:0}), signal:AbortSignal.timeout(12000), redirect:'error', credentials:'omit'
          });
          let accepted = false;
          if (response.ok || response.status === 409) {
            const result = await response.json();
            accepted = core.sameCapture(item.note, response.ok ? result.note : result.current);
            if (response.ok && !accepted) throw new Error('Хранилище вернуло неожиданный ответ. Клип сохранён на устройстве.');
          }
          if (!accepted) throw new Error(response.status === 401 ? 'Сеанс завершён. Войди в аккаунт в настройках.' : `Хранилище вернуло ошибку ${response.status}. Клип сохранён на устройстве.`);
          }
          await exclusive(()=>removeQueued(item.note.id));
          await delivery(item,'uploaded');
        } catch (error) {
          await exclusive(()=>recordFailure(item,error));
          if (error.message?.includes('Сеанс завершён')) break;
        }
      }
    } finally { flushing = false; await badge(); finish(); void flushTelemetry(); }
  }
  async function inject(tabId, action = 'doompile:inspect', selectionText, context = {}) {
    if(action==='doompile:open')telemetry?.record('clipper.opened',{screen:'capture'});
    try {
      const frameId=context.frameId>0?context.frameId:0;
      const {connection}=await state();
      const target={tabId,frameIds:[frameId]};
      const loaded=await api.scripting.executeScript({target,files:['core.js','transport.js','layout.js','composer.js','content.js']});
      const loadError=loaded?.find(item=>item.error)?.error;
      if(loadError)throw new Error('Ошибка запуска скрипта: '+String(loadError.message||loadError));
      // Use executeScript's return value instead of a second, unacknowledged tabs message.
      // Explicit frame targeting also avoids a response from a different iframe.
      const results=await api.scripting.executeScript({target,func:message=>{
        try{
          const bridge=globalThis.__doompileClipper;
          if(typeof bridge?.dispatch!=='function')return {error:'Скрипт Doompile не запущен. Разреши расширению доступ к этому сайту в Safari.'};
          return bridge.dispatch(message);
        }catch(error){return {error:String(error.message||error)};}
      },args:[{type:action,account:accountKey(connection),readingListAvailable:canUseReadingList(),selectionText,imageUrl:context.imageUrl,pageUrl:context.pageUrl,linkUrl:context.linkUrl,linkText:context.linkText,initialDraft:context.initialDraft,expandEditor:context.expandEditor,auto:context.auto}]});
      const execution=results?.find(item=>item.frameId===frameId);
      const result=execution?.result;
      if(execution?.error)throw new Error(String(execution.error.message||execution.error));
      if(!result || result.error)throw new Error(result?.error||'Safari не вернул результат скрипта. Проверь доступ Doompile к этому сайту.');
      lastError=null;return result;
    } catch(error) {
      if(context.frameId>0)return inject(tabId,action,selectionText,{...context,frameId:0});
      throw new Error((action==='doompile:open'?'Не удалось открыть аннотацию. ':'Не удалось прочитать страницу. ')+String(error.message||error));
    }
  }
  function setup() {
    try {
      if (api.contextMenus) {
        Promise.resolve(api.contextMenus.removeAll()).then(() => {
          api.contextMenus.create({id:'doompile-save', title:'Сохранить в Doompile', contexts:['page','selection','image','video','link']});
        }).catch(() => {});
      }
    } catch { /* contextMenus is unavailable on iOS. The action remains usable. */ }
    try { Promise.resolve(api.alarms?.create('doompile-retry', {periodInMinutes:1})).catch(() => {}); } catch {}
    badge(); flush().catch(() => {});
  }
  api.runtime.onInstalled.addListener(setup);
  api.runtime.onStartup.addListener(setup);
  api.alarms?.onAlarm.addListener(alarm => { if (alarm.name === 'doompile-retry') flush(); });
  api.contextMenus?.onClicked.addListener((info, tab) => {
    if (String(info.menuItemId).startsWith('doompile-') && tab?.id != null) inject(tab.id, 'doompile:open', info.selectionText, {imageUrl:info.mediaType==='image'?info.srcUrl:undefined,pageUrl:info.pageUrl,linkUrl:info.mediaType==='image'||info.selectionText?undefined:info.linkUrl,linkText:info.linkText,frameId:info.frameId}).catch(error=>{lastError=error.message;void badge();try{Promise.resolve(api.action?.openPopup?.()).catch(()=>{});}catch{}});
  });
  api.runtime.onMessage.addListener((message, sender, reply) => {
    const respond = async () => {
      if(message?.type==='doompile:telemetry' && sender.id===api.runtime.id && (sender.tab || trustedUI(sender)) && forwardedEvents.has(message.name)) {
        telemetry?.record(message.name,message.properties||{});return {ok:true};
      }
      if (((message?.type === 'doompile:capture' && sender.tab) || (message?.type==='doompile:capture-popup' && trustedUI(sender)))) {
        const {connection:initialConnection}=await state();
        const owner=accountKey(initialConnection);
        if((message.account||null)!==owner)throw new Error('Аккаунт изменился. Открой аннотацию заново.');
        const now = /^\d{4}-\d\d-\d\dT/.test(message.captureAt||'') && Number.isFinite(Date.parse(message.captureAt)) ? new Date(message.captureAt).toISOString() : new Date().toISOString();
        const id=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.captureId||'')?message.captureId:crypto.randomUUID();
        const note = core.makeNote(message.capture || {}, now, id);
        await exclusive(async () => {
          try{await api.storage.local.set({[queueKey(note.id)]:{note,owner,tabId:sender.tab?.id,attempts:0,nextAttempt:0,error:null}});}
          catch{throw new Error('Не удалось сохранить клип на устройстве: хранилище расширения заполнено. Отправь очередь через значок Doompile. Текст пока остаётся в форме.');}
        });
        telemetry?.record('capture.saved',{note_id:note.id,kind:note.kind},undefined,initialConnection,note.id);
        if(message.readingList){
          try{await bounded(addToReadingList(note),9000,'Список чтения не ответил. Заметка сохранена.');}catch(error){
            const warning=String(error.message||error);readingListErrors.set(note.id,warning);if(accountKey((await state()).connection)===owner)lastError=warning;
            try{await exclusive(async()=>{const key=queueKey(note.id),stored=await api.storage.local.get(key);if(stored[key])await api.storage.local.set({[key]:{...stored[key],readingListError:warning}});});}catch{/* The already durable note must survive an optional Reading List failure. */}
          }
        }
        const pending=(await state()).outbox[note.id];
        await delivery({note,owner},pending?'queued':'uploaded');
        void badge();
        const {connection} = await state();
        void flush(true).catch(error=>{lastError=error.message;});
        return {ok:true, queued:true, configured:configured(connection), id:note.id};
      }
      if(message?.type==='doompile:show-delivery' && sender.tab){
        // Open only a short-lived receipt, never the note composer after sending.
        try{
          if(api.action?.setPopup&&api.action?.openPopup){
            await api.action.setPopup({popup:'receipt.html?id='+encodeURIComponent(message.id)});
            await api.action.openPopup();
          }
        }catch{}finally{try{await api.action?.setPopup?.({popup:'popup.html'});}catch{}}
        await flush();return {ok:true};
      }
      if(message?.type==='doompile:receipt' && sender.tab){
        // Keep the message event alive while Safari's non-persistent background uploads.
        await flush();
        const {outbox,connection,delivery:recent}=await state();const item=outbox[message.id];
        if(item && item.tabId!==sender.tab.id)throw new Error('Неподдерживаемое действие расширения.');
        return {uploaded:!item&&recent?.id===message.id&&recent.state==='uploaded',queued:!!item,error:item?.error||null,warning:(item||recent?.id===message.id)?readingListErrors.get(message.id)||(recent?.id===message.id?recent.warning:null):null,noteURL:!item&&recent?.id===message.id&&recent.state==='uploaded'&&connection?.endpoint?connection.endpoint+'/notes/'+encodeURIComponent(message.id):null};
      }
      if(message?.type==='doompile:account' && sender.tab){const {connection}=await state();return {account:accountKey(connection)};}
      if(message?.type==='doompile:prepare-mobile' && sender.tab){return inject(sender.tab.id,'doompile:ready',undefined,{frameId:sender.frameId});}
      if(message?.type==='doompile:tags' && (sender.tab || trustedUI(sender))){
        const {connection}=await state();if((message.account||null)!==accountKey(connection))throw new Error('Аккаунт изменился. Открой аннотацию заново.');if(!configured(connection))return {tags:[]};
        const response=await fetch(connection.endpoint+'/api/notes',{headers:authHeaders(connection),redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)});
        if(!response.ok)return {tags:[]};const data=await response.json();
        return {tags:[...new Set((data.notes||[]).filter(note=>!note.deletedAt).flatMap(note=>note.tags||[]))]};
      }
      if(message?.type==='doompile:load-editor' && sender.tab){
        const results=await api.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[sender.frameId||0]},files:[globalThis.DoompileEditorBuild?.file||'rich-editor.js']});
        const error=results?.find(item=>item.error)?.error;if(error)throw new Error(String(error.message||error));return {ok:true};
      }
      if (!trustedUI(sender)) throw new Error('Неподдерживаемое действие расширения.');
      if(message?.type==='doompile:diagnostics'){return telemetry ? telemetry.dump() : {format:'doompile-diagnostics',events:[]};}
      if(message?.type==='doompile:diagnostics-state'){return telemetry ? telemetry.state() : {enabled:false};}
      if(message?.type==='doompile:diagnostics-enabled'){await telemetry?.setEnabled(message.enabled===true);return {ok:true};}
      if(message?.type==='doompile:receipt-status'){
        const {connection,outbox,delivery}=await state();const item=outbox[message.id];
        const phase=delivery?.id===message.id?delivery.state:'unknown';
        const saved=item?.noteAccepted||phase==='uploaded';
        return {state:item?'queued':phase,warning:(item||phase!=='unknown')?readingListErrors.get(message.id)||(delivery?.id===message.id?delivery.warning:null):null,noteURL:saved&&connection?.endpoint?connection.endpoint+'/notes/'+encodeURIComponent(message.id):null};
      }
      if(message?.type==='doompile:check'){
        const {connection}=await state();if(!connection)throw new Error('Сначала укажи адрес хранилища.');
        try{const response=await fetch(connection.endpoint+'/api/notes',{headers:authHeaders(connection),redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)});
          if(!response.ok)throw new Error(response.status===401?'Ключ доступа не подошёл.':`Хранилище вернуло ${response.status}.`);
          const result=await response.json();if(!Array.isArray(result.notes))throw new Error('По этому адресу нет API Doompile.');
          return {ok:true,count:result.notes.filter(n=>!n.deletedAt).length};
        }catch(error){throw new Error(error.message==='Failed to fetch'?'Хранилище недоступно. Проверь адрес, разрешения Safari и запущен ли сервер.':error.message);}
      }
      if (message?.type === 'doompile:status') { void flush().catch(error=>{lastError=error.message;}); return status(); }
      if(message?.type==='doompile:login'){
        const endpoint=core.endpoint(message.endpoint);
        const response=await fetch(endpoint+'/api/auth/device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'Doompile Web Clipper'}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('Не удалось начать вход. Проверь адрес сервера.');
        const flow=await response.json();
        const url=new URL(flow.verificationUrl);
        if(url.origin!==new URL(endpoint).origin||url.pathname!=='/connect')throw new Error('Неправильный адрес входа.');
        await api.storage.local.set({pendingLogin:{endpoint,code:flow.code,secret:flow.secret,expires:flow.expires}});
        return {verificationUrl:url.toString()};
      }
      if(message?.type==='doompile:login-status'){
        const {pendingLogin:flow}=await api.storage.local.get('pendingLogin');
        if(!flow)return {pending:false};
        if(flow.expires<Date.now()){await api.storage.local.remove('pendingLogin');throw new Error('Ссылка входа истекла. Начни ещё раз.');}
        const endpoint=core.currentEndpoint(flow.endpoint);
        const response=await fetch(endpoint+'/api/auth/device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:flow.code,secret:flow.secret}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok){await api.storage.local.remove('pendingLogin');throw new Error('Вход не завершён. Начни ещё раз.');}
        const result=await response.json();
        if(result.status==='approved'){
          const connection=await makeConnection(endpoint,result.token);
          const installed=await exclusive(async()=>{const {pendingLogin:current}=await api.storage.local.get('pendingLogin');if(current?.code!==flow.code)return false;await api.storage.local.set({connection});await api.storage.local.remove('pendingLogin');return true;});
          if(!installed)return {pending:false};lastError=null;
          void flush(true).catch(error=>{lastError=error.message;});
          return {pending:false,authenticated:true};
        }
        return {pending:true};
      }
      if(message?.type==='doompile:logout'){
        const {connection}=await state();
        await exclusive(()=>api.storage.local.remove(['connection','pendingLogin','lastDelivery']));lastDelivery=null;lastError=null;
        if(configured(connection))try{await fetch(connection.endpoint+'/api/session',{method:'DELETE',headers:authHeaders(connection),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});}catch{}
        return {ok:true};
      }
      if (message?.type === 'doompile:configure') {
        const connection = await makeConnection(message.endpoint,message.token);
        await exclusive(async () => {await api.storage.local.set({connection});await api.storage.local.remove('pendingLogin');});lastError=null;lastDelivery=null;readingListErrors.clear();
        void flush(true).catch(error=>{lastError=error.message;});
        return {ok:true};
      }
      if (message?.type === 'doompile:native-configure') {
        const result = await api.runtime.sendNativeMessage('app.doompile', {type:'configuration'});
        const connection = await makeConnection(core.currentEndpoint(result.endpoint),result.token);
        await exclusive(async () => {await api.storage.local.set({connection});await api.storage.local.remove('pendingLogin');});lastError=null;lastDelivery=null;readingListErrors.clear(); void flush(true).catch(error=>{lastError=error.message;}); return {ok:true};
      }
      if (message?.type === 'doompile:retry') { await flush(true); return status(); }
      if (message?.type === 'doompile:inspect' || message?.type === 'doompile:open') {
        const tabs = await api.tabs.query({active:true, currentWindow:true});
        if (tabs[0]?.id == null) throw new Error('Нет открытой страницы.');
        return inject(tabs[0].id,message.type,message.selectionText,{initialDraft:message.initialDraft,expandEditor:message.expandEditor,auto:message.auto});
      }
      throw new Error('Неизвестное действие расширения.');
    };
    const acknowledge = result => {
      try { reply(result); } catch { /* Safari may already have closed its reply channel. */ }
      if (sender.tab && typeof message?.requestId === 'string') {
        // Never expose this result in the page world. No credentials are returned
        // by content commands; only the originating frame can settle its nonce.
        void api.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[sender.frameId||0]},func:(id,value)=>globalThis.__doompileClipper?.settle?.(id,value),args:[message.requestId,result]}).catch(()=>{});
      }
    };
    respond().then(async result => {await telemetry?.settled();acknowledge(result);}, async error => {telemetry?.error('clipper.failed',error);await telemetry?.settled();acknowledge({error:String(error.message || error)});});
    return true;
  });
})();
