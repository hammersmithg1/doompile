(async function(){
 'use strict';
 const api=globalThis.browser||globalThis.chrome,$=id=>document.getElementById(id);
 let serverOrigin,polling,composer,receipt,capture=null,editorLoading,lastSubmission,captureAccount;
 const endpointField=$('endpoint');
 const defaultEndpoint=globalThis.DoompileServer?.endpoint||'http://localhost:3000';
 const selectedEndpoint=()=>DoompileCore.currentEndpoint(DoompileCore.endpoint(endpointField.value.trim()||defaultEndpoint));
 const transport=DoompileTransport.create(api);
 const report=(name,properties={})=>{void api.runtime.sendMessage({type:'doompile:telemetry',name,properties}).catch(()=>{});};
 report('clipper.opened',{screen:'capture'});
 globalThis.DoompileDiagnostics?.install();
 $('diagnostics-export')?.addEventListener('click',async()=>{try{
   const dump=await message({type:'doompile:diagnostics'});
   const file=new File([JSON.stringify(dump,null,2)],'doompile-clipper-diagnostics.json',{type:'application/json'});
   if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Диагностика Doompile'});return;}catch(error){if(error.name==='AbortError')return;}}
   const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(error){displayError(error);}});
 $('diagnostics-enabled')?.addEventListener('change',event=>{void message({type:'doompile:diagnostics-enabled',enabled:event.target.checked}).catch(displayError);});
 void message({type:'doompile:diagnostics-state'}).then(state=>{if($('diagnostics-enabled'))$('diagnostics-enabled').checked=state.enabled;}).catch(()=>{});
 const gear=document.querySelector('#settings-toggle svg');
 if(gear){gear.replaceChildren();for(const [tag,attrs] of DoompileDesign.icons.settings){const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);gear.append(node);}}
 $('editor-commands')?.addEventListener('click',async()=>{try{await loadEditor();await DoompileRichEditor.showPreferences();}catch(error){displayError(error);}});
 const mobile=/iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent||'')||(globalThis.navigator?.platform==='MacIntel'&&globalThis.navigator?.maxTouchPoints>1);
 document.documentElement.classList.toggle('mobile-popup',mobile);
 $('capture').classList.toggle('mobile-card',mobile);
 $('native').hidden=!api.runtime.getManifest().permissions?.includes('nativeMessaging');
 $('mobile-help').hidden=!/iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent||'');
 async function message(payload){const result=await transport.request(payload,15000);if(result?.error)throw new Error(result.error);return result;}
 function displayError(error){$('status').className='error';$('status').textContent=error.message||String(error);}
 function settings(show){$('settings').hidden=!show;$('capture').hidden=show;$('page-error').hidden=true;if(!show)composer?.focus();}
 async function refresh(){
   try{
     const info=await message({type:'doompile:status'});
     if(captureAccount===undefined)captureAccount=info.account||null;
     $('account').textContent=info.user?.email||'';
     $('logout').hidden=!info.user;
     $('status').className=info.error?'error':'';
     $('status').textContent=info.queued
       ? `Ожидают отправки: ${info.queued}. ${info.error||''}`
       : info.configured
         ? 'Подключение задано'
         : 'Войди в аккаунт. Старые неподключённые клипы сохраняются отдельно.';
     $('queue').replaceChildren();
     for(const item of info.items||[]){
       const row=document.createElement('li'),detail=document.createElement('small');
       row.textContent=item.title;
       detail.textContent=item.error||'Ждёт отправки';
       row.append(detail);
       $('queue').append(row);
     }
     $('retry').hidden=!info.queued||!info.configured;
     // Keep edits, including a cleared address, across status polls.
     const edited=endpointField.value!==endpointField.defaultValue;
     endpointField.defaultValue=info.endpoint===defaultEndpoint?'':(info.endpoint||'');
     if(!edited)endpointField.value=endpointField.defaultValue;
     $('login').disabled=false;
     serverOrigin=info.endpoint?DoompileCore.permissionPattern(info.endpoint):null;
     $('grant').hidden=!info.configured||!serverOrigin||await api.permissions.contains({origins:[serverOrigin]});
     return info;
   }catch(error){displayError(error);}
 }
 function loadEditor(){if(globalThis.DoompileRichEditor?.version===2&&(!globalThis.DoompileEditorBuild||DoompileRichEditor.build===DoompileEditorBuild.hash))return Promise.resolve();if(!editorLoading)editorLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');const timer=setTimeout(()=>{editorLoading=null;script.remove();reject(new Error('Редактор не загрузился. Попробуй ещё раз.'));},10000);script.src=api.runtime.getURL(globalThis.DoompileEditorBuild?.file||'rich-editor.js');script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);editorLoading=null;reject(new Error('Не удалось загрузить редактор.'));};document.head.append(script);});return editorLoading;}
 function mountComposer(){composer?.destroy();composer=DoompileComposer.mount({root:$('composer'),context:capture||{},loadEditor,onExpand:mobile?async draft=>{const result=await message({type:'doompile:open',selectionText:capture?.quote,initialDraft:draft,expandEditor:true,auto:true});if(!result?.ok)throw new Error('Не удалось открыть редактор на странице. Разреши доступ к сайту.');window.close();}:undefined,loadTags:async()=>{const result=await message({type:'doompile:tags',account:captureAccount});return result.tags||[];},onLayout:expanded=>document.documentElement.classList.toggle('expanded',expanded),onSubmit:async values=>{const {readingList,...annotation}=values;const payload={capture:{...(capture||{noteOnly:true}),...annotation},readingList};const signature=JSON.stringify(payload);if(lastSubmission?.signature!==signature)lastSubmission={signature,captureId:crypto.randomUUID(),captureAt:new Date().toISOString()};const saved=await message({type:'doompile:capture-popup',account:captureAccount,...payload,captureId:lastSubmission.captureId,captureAt:lastSubmission.captureAt});if(!saved?.ok)throw new Error('Не удалось сохранить.');composer.destroy();composer=null;document.documentElement.className='receipt-mode';$('capture').hidden=true;$('settings').hidden=true;$('page-error').hidden=true;$('confirmation').hidden=false;receipt=DoompileReceipt.mount($('confirmation'),saved.id);}});}
 $('settings-toggle').addEventListener('click',()=>{settings(true);void refresh();});$('back').addEventListener('click',()=>settings(false));
 $('connection-form').addEventListener('submit',async event=>{
   event.preventDefault();
   try{
     const endpoint=selectedEndpoint(),origin=DoompileCore.permissionPattern(endpoint);
     if(!await api.permissions.request({origins:[origin]}))throw new Error('Разреши доступ к хранилищу.');
     await message({type:'doompile:configure',endpoint,token:$('token').value});
     $('token').value='';
     settings(false);
     await refresh();
   }catch(error){displayError(error);}
 });
 $('login').addEventListener('click',async()=>{
   try{
     const endpoint=selectedEndpoint(),origin=DoompileCore.permissionPattern(endpoint);
     if(!await api.permissions.request({origins:[origin]}))throw new Error('Разреши доступ к серверу.');
     const result=await message({type:'doompile:login',endpoint});
     await api.tabs.create({url:result.verificationUrl});
     $('status').textContent='Заверши вход в браузере и открой расширение снова.';
   }catch(error){displayError(error);}
 });
 $('logout').addEventListener('click',async()=>{try{await message({type:'doompile:logout'});location.reload();}catch(error){displayError(error);}});
 async function checkLogin(){try{const result=await message({type:'doompile:login-status'});if(result.authenticated)location.reload();else if(result.pending)$('status').textContent='Заверши вход в браузере.';}catch(error){displayError(error);}}
 $('check').addEventListener('click',async()=>{try{const result=await message({type:'doompile:check'});$('status').className='';$('status').textContent=`Соединение работает · заметок: ${result.count}`;}catch(error){displayError(error);}});
 $('native').addEventListener('click',async()=>{try{await message({type:'doompile:native-configure'});settings(false);await refresh();}catch{displayError(new Error('Не удалось взять подключение. Подключи приложение или укажи адрес и ключ здесь.'));}});
 $('grant').addEventListener('click',async()=>{try{if(!serverOrigin)return;if(!await api.permissions.request({origins:[serverOrigin]}))throw new Error('Доступ не предоставлен. Клипы остаются на устройстве.');await message({type:'doompile:retry'});await refresh();}catch(error){displayError(error);}});
 $('retry').addEventListener('click',async()=>{try{await message({type:'doompile:retry'});await refresh();}catch(error){displayError(error);}});
 // Render immediately; capture metadata arrives separately without remounting a user's input.
 mountComposer();composer.setReady(false);settings(false);void refresh();void checkLogin();
 try{capture=await message({type:'doompile:inspect'});}catch(error){$('page-error').hidden=false;$('page-error').textContent='Страница не прочитана. Сохранится обычная заметка. '+error.message;}
 // Snapshot/video controls need page metadata; keep the initial composer and update it safely.
 composer?.setContext(capture||{});composer?.setReady(true);
 polling=setInterval(()=>{if(!$('settings').hidden){void refresh();void checkLogin();}},3000);
 window.addEventListener('pagehide',()=>{clearInterval(polling);transport.destroy();composer?.destroy();receipt?.destroy();});
})();
