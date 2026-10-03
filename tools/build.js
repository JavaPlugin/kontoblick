const fs=require('fs'),path=require('path'),zlib=require('zlib');
// Aufruf: node tools/build.js <version>   z. B. node tools/build.js 1.0.1
// Baut aus src/kontoblick.html die Home-Assistant-App nach custom_components/kontoblick/www.
const ROOT=path.join(__dirname,'..'),SP=path.join(ROOT,'src'),WS=SP;
const COMP=path.join(ROOT,'custom_components','kontoblick'),WWW=path.join(COMP,'www');
const manifestPath=path.join(COMP,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const VERSION=process.argv[2]||manifest.version;
if(!/^\d+\.\d+\.\d+$/.test(VERSION))throw new Error('Version bitte als 1.2.3 angeben');
manifest.version=VERSION;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
fs.mkdirSync(WWW,{recursive:true});
const frag={};fs.readFileSync(path.join(SP,'ha-shell.txt'),'utf8').split(/^=====/m).filter(Boolean).forEach(b=>{const i=b.indexOf('\n');frag[b.slice(0,i).trim()]=b.slice(i+1)});
let src=fs.readFileSync(path.join(WS,'kontoblick.html'),'utf8');
const rep=(a,b)=>{if(!src.includes(a))throw new Error('missing: '+a.slice(0,80));src=src.replace(a,()=>b)};

// App-Anpassungen
rep('Der Speicher ist in dieser Ansicht nicht verfügbar. Öffne Kontoblick direkt auf claude.ai, damit Änderungen gespeichert werden.','Nicht mit Home Assistant verbunden. Änderungen werden erst nach dem Verbinden gespeichert.');
const a=src.indexOf('  h+=`<section class="sec"><h2>Erinnerungen aufs iPhone</h2>');
const endTok='Kalender exportieren</button></div></section>`;';const b=src.indexOf(endTok);
if(a<0||b<0)throw new Error('cal section');
src=src.slice(0,a)+frag.CALSECTION.trimEnd()+src.slice(b+endTok.length);
rep('data-set="restLabel"></div></div></section>`;','data-set="restLabel"></div></div></section>`;\n'+frag.PLANEXTRA.trimEnd());
rep("    if(act==='ics')return exportIcs();","    if(act==='ics')return exportIcs();\n    if(act==='syncnow'){KB.syncNow();toast('Wird synchronisiert');return}\n    if(act==='logout'){if(S.confirm!=='logout'){S.confirm='logout';render();return}KB.logout();return}");
rep('<div class="brand">Konto<span>blick</span></div>','<div style="display:flex;align-items:center"><div class="brand">Konto<span>blick</span></div><em id="syncPill" class="sync" hidden></em></div>');
rep('<style>','<style>\n'+frag.BASECSS+'.sync{font-style:normal}\n');

// Zusammensetzen: Head, Body, Speicher-Adapter vor dem App-Skript, Setup danach
const si=src.indexOf('</style>')+'</style>'.length;
const head=src.slice(0,si),rest=src.slice(si);
const scriptAt=rest.indexOf('<script>');
const body=rest.slice(0,scriptAt),main=rest.slice(scriptAt);
const html=frag.HEAD+head+'\n</head>\n<body>'+body+'<script>\n'+fs.readFileSync(path.join(SP,'ha-adapter.js'),'utf8')+'</script>\n'+main+'\n'+frag.SETUP+'</body>\n</html>\n';
fs.writeFileSync(path.join(WWW,'index.html'),html);
for(const s of html.match(/<script>([\s\S]*?)<\/script>/g))new Function(s.replace(/^<script>|<\/script>$/g,''));

// Web-App-Manifest & Service Worker
fs.writeFileSync(path.join(WWW,'manifest.json'),JSON.stringify({name:'Kontoblick',short_name:'Kontoblick',lang:'de',start_url:'/kontoblick/index.html',scope:'/kontoblick/',display:'standalone',background_color:'#EDF0EE',theme_color:'#0E5A4A',icons:[{src:'icon-180.png',sizes:'180x180',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}]},null,2));
fs.writeFileSync(path.join(WWW,'sw.js'),`const C='kontoblick-${VERSION}';
const ASSETS=['index.html','manifest.json','icon-180.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
// Netzwerk zuerst, damit Updates sofort ankommen; ohne Netz aus dem Cache. Die Daten-API wird nie gecacht.
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||!u.pathname.startsWith('/kontoblick/'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r})
    .catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html'))));
});
`);

// App-Icon (PNG, selbst gezeichnet): dunkelgrüner Grund, drei aufsteigende Balken
function png(size){
  const px=Buffer.alloc(size*size*4);
  const set=(x,y,[r,g,b])=>{const i=(y*size+x)*4;px[i]=r;px[i+1]=g;px[i+2]=b;px[i+3]=255};
  const bg=[14,90,74],w=[255,255,255],mint=[88,195,163];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)set(x,y,bg);
  const bars=[[0.24,0.34,w],[0.43,0.50,w],[0.62,0.66,mint]],bw=0.14,base=0.76,rad=0.035*size;
  for(const [x0,h,c] of bars){const X0=Math.round(x0*size),X1=Math.round((x0+bw)*size),Y1=Math.round(base*size),Y0=Math.round((base-h)*size);
    for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){
      const cx=x<X0+rad?X0+rad:x>X1-rad?X1-rad:x,cy=y<Y0+rad?Y0+rad:y;
      if((x-cx)**2+(y-cy)**2<=rad*rad+0.5)set(x,y,c)}}
  const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++){raw[y*(size*4+1)]=0;px.copy(raw,y*(size*4+1)+1,y*size*4,(y+1)*size*4)}
  const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c});
  const crc=b=>{let c=-1;for(const v of b)c=crcT[(c^v)&255]^(c>>>8);return(c^-1)>>>0};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(size,0);ih.writeUInt32BE(size,4);ih[8]=8;ih[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(WWW,'icon-180.png'),png(180));
fs.writeFileSync(path.join(WWW,'icon-512.png'),png(512));

console.log('Kontoblick',VERSION,'gebaut; index.html',Math.round(html.length/1024),'KB');
