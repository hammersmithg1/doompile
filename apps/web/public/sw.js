const CACHE='doompile-shell-v4';
self.addEventListener('install',event=>{ event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/icon.svg'])).then(()=>self.skipWaiting())); });
self.addEventListener('activate',event=>{ event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin)return;
 if(url.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate'&&(url.pathname==='/'||/^\/notes\/[0-9a-f-]+$/i.test(url.pathname))){
   event.respondWith(fetch(event.request).then(response=>{if(response.ok&&url.pathname==='/'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('/',copy));}return response;}).catch(()=>caches.match('/'))); return;
 }
 if(url.pathname.startsWith('/_next/static/')||url.pathname==='/icon.svg')event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;})));
});
