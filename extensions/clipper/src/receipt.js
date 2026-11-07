(function(){
 'use strict';
 const api=globalThis.browser||globalThis.chrome;
 function mount(root,id,onDone=()=>window.close()){
  root.hidden=false;root.replaceChildren();const row=document.createElement('div');row.className='receipt';row.setAttribute('role','status');row.setAttribute('aria-live','polite');const mark=document.createElement('span');mark.className='receipt-mark';mark.setAttribute('aria-hidden','true');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':String(DoompileDesign.strokeWidth),'stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(key,value);for(const [tag,attrs] of DoompileDesign.icons.check){const node=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);svg.append(node);}mark.append(svg);const text=document.createElement('span');text.className='receipt-text';text.textContent='Сохранено';const link=document.createElement('a');link.className='receipt-link';link.textContent='Открыть ↗';link.setAttribute('aria-label','Открыть заметку');link.target='_blank';link.rel='noopener noreferrer';link.hidden=true;row.append(mark,text,link);root.append(row);
  let disposed=false,polling;
  async function refresh(){try{const result=await api.runtime.sendMessage({type:'doompile:receipt-status',id});if(disposed)return;text.textContent=result?.state==='uploaded'?'Отправлено':result?.state==='queued'?'Сохранено · в очереди':'Сохранено';if(result?.warning){text.textContent='Заметка сохранена · список чтения недоступен';text.style.whiteSpace='normal';text.title=result.warning;}if(result?.noteURL&&/^https?:\/\//.test(result.noteURL)){link.href=result.noteURL;link.hidden=false;}}catch{/* The initial label confirms the already acknowledged local save. */}}
  void refresh();polling=setInterval(()=>void refresh(),250);
  const timer=setTimeout(()=>{root.hidden=true;destroy();onDone();},2200);
  function destroy(){disposed=true;clearInterval(polling);clearTimeout(timer);}
  window.addEventListener('pagehide',destroy,{once:true});return {destroy};
 }
 globalThis.DoompileReceipt={mount};
 const root=document.getElementById('receipt');if(root)mount(root,new URL(location.href).searchParams.get('id'));
})();
