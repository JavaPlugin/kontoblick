/* ---------- Speicher: Home Assistant (/api/kontoblick/data) mit Offline-Puffer ---------- */
(function(){
const LS={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const API='/api/kontoblick/data';
let token=LS.get('kb_token'),docs={},rev=-1,pending=[];
try{const c=JSON.parse(LS.get('kb_cache')||'null');if(c){docs=c.docs||{};rev=c.rev??-1;pending=c.pending||[]}}catch(e){}
const subs=new Set();
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const saveCache=()=>LS.set('kb_cache',JSON.stringify({docs,rev,pending}));
const emit=()=>subs.forEach(f=>{try{f()}catch(e){console.error(e)}});
const apply=ops=>{for(const o of ops){if(o.op==='delete')delete docs[o.path];else docs[o.path]=clone(o.data)}};
const KB=window.KB={status:'',needToken:!token,onStatus:null,onAuth:null};
const setStatus=s=>{KB.status=s;KB.onStatus&&KB.onStatus(s)};
async function req(method,body,tok){
  const r=await fetch(API,{method,cache:'no-store',headers:{'Authorization':'Bearer '+(tok||token),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status===401||r.status===403){const e=new Error('auth');e.auth=true;throw e}
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.json();
}
async function pull(){
  if(!token)return;
  try{const j=await req('GET');if(j.rev!==rev){docs=j.docs||{};rev=j.rev;apply(pending);saveCache();emit()}setStatus(pending.length?'sync':'ok')}
  catch(e){if(e.auth){KB.needToken=true;KB.onAuth&&KB.onAuth()}else setStatus('offline')}
}
let flushing=false,timer=null;
async function flush(){
  if(flushing||!pending.length||!token)return;flushing=true;
  const batch=pending.slice(),was=rev;
  try{
    const j=await req('POST',{ops:batch});pending=pending.slice(batch.length);
    if(j.prev!==was){rev=-1;saveCache();flushing=false;return pull()}
    rev=j.rev;saveCache();setStatus(pending.length?'sync':'ok');
  }catch(e){if(e.auth){KB.needToken=true;KB.onAuth&&KB.onAuth()}else setStatus('offline')}
  flushing=false;if(pending.length&&KB.status!=='offline')flush();
}
function write(op){apply([op]);pending.push(op);saveCache();emit();setStatus('sync');clearTimeout(timer);timer=setTimeout(flush,250)}
const snap=p=>({id:p.split('/').pop(),exists:p in docs,data:()=>clone(docs[p]),metadata:{fromCache:false,hasPendingWrites:false}});
const depth=p=>p.split('/').length;
const inCol=(c,k)=>k.startsWith(c+'/')&&depth(k)===depth(c)+1;
const nid=()=>Math.random().toString(36).slice(2,10);
function docRef(p){return{id:p.split('/').pop(),path:p,
  get:async()=>snap(p),
  set:async d=>write({op:'set',path:p,data:d}),
  update:async d=>{if(!(p in docs))throw{code:'invalid_argument',message:'Dokument fehlt'};write({op:'set',path:p,data:Object.assign(clone(docs[p]),d)})},
  delete:async()=>write({op:'delete',path:p}),
  onSnapshot(fn){let last;const f=()=>{const s=JSON.stringify(docs[p]??null);if(s!==last){last=s;fn(snap(p))}};subs.add(f);setTimeout(f,0);return()=>subs.delete(f)},
  collection:c=>colRef(p+'/'+c)}}
function colRef(c){
  const keys=()=>Object.keys(docs).filter(k=>inCol(c,k)).sort();
  const qs=()=>{const d=keys().map(snap);return{docs:d,size:d.length,empty:!d.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}};
  return{path:c,get:async()=>qs(),
    onSnapshot(fn){let last;const f=()=>{const s=JSON.stringify(keys().map(k=>[k,docs[k]]));if(s!==last){last=s;fn(qs())}};subs.add(f);setTimeout(f,0);return()=>subs.delete(f)},
    doc:id=>docRef(c+'/'+(id||nid())),add:async d=>{const r=docRef(c+'/'+nid());await r.set(d);return r}}}
const db={doc:docRef,collection:colRef};
window.claude={use:async n=>n==='db'&&token?db:null};
KB.tryToken=async t=>{t=t.trim();if(!t)return 'Bitte den Token einfügen.';
  try{await req('GET',null,t)}catch(e){return e.auth?'Home Assistant hat den Token abgelehnt. Prüfe, ob er vollständig kopiert wurde.':'Home Assistant ist gerade nicht erreichbar. Prüfe die Verbindung und versuche es erneut.'}
  LS.set('kb_token',t);LS.del('kb_cache');location.reload();return null};
KB.logout=()=>{LS.del('kb_token');LS.del('kb_cache');location.reload()};
KB.syncNow=()=>{flush();pull()};
if(token){pull().then(flush);setInterval(()=>{flush();pull()},30000)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)KB.syncNow()});
window.addEventListener('online',()=>KB.syncNow());
})();
