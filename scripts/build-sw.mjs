import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const files = (await readdir('dist', { recursive: true })).filter(
  (p) => /\.[a-z0-9]+$/i.test(p) && p !== 'sw.js',
)
const hash = createHash('sha256')
for (const file of files) hash.update(await readFile(`dist/${file}`))
const version = hash.digest('hex').slice(0, 12)
await writeFile(
  'dist/sw.js',
  `const CACHE='loopmark-${version}';
const ASSETS=${JSON.stringify(files.map((f) => '/' + f))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('loopmark-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data?.type==='CHECK_OFFLINE_READY')event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(ASSETS.map(url=>cache.match(url,{ignoreVary:true})))).then(hits=>event.ports[0]?.postMessage({ready:hits.every(Boolean)})).catch(()=>event.ports[0]?.postMessage({ready:false})));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
 if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html')));return;}
 event.respondWith(caches.match(event.request,{ignoreVary:true}).then(hit=>hit||fetch(event.request)));
});`,
)
console.log(`Offline precache: ${files.length} assets, loopmark-${version}`)
