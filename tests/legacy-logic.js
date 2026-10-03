// Eingefrorene Rechenlogik von Kontoblick 1.1.0 (src/kontoblick.html, Zeilen 238–382).
// Dient nur als Referenz: Der neue Rechenkern in core/ muss exakt dieselben Zahlen liefern.
// Nicht ändern.
module.exports=function legacy(docs,{now:now0,cfgPatch={},y,m}={}){
const eur=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const fmt=v=>eur.format(Math.round((v||0)*100)/100);
const MON=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const WD=['So','Mo','Di','Mi','Do','Fr','Sa'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const mk=(y,m)=>`${y}-${pad(m)}`;
const ymd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd=s=>{const[a,b,c]=s.split('-').map(Number);return new Date(a,b-1,c)};
const dim=(y,m)=>new Date(y,m,0).getDate();
const today0=()=>{const d=new Date();d.setHours(0,0,0,0);return d};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const dayDiff=(a,b)=>Math.round((b-a)/864e5);
const dm=d=>`${pad(d.getDate())}.${pad(d.getMonth()+1)}.`;
const sum=a=>a.reduce((s,v)=>s+(+v||0),0);
const num=s=>{s=String(s??'').trim().replace(/[\s€]/g,'');if(!s)return NaN;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)};
const nid=()=>Math.random().toString(36).slice(2,10);
const relDay=n=>n===0?'heute':n===1?'morgen':`in ${n} Tagen`;

const IV={monthly:{label:'monatlich',n:1},quarterly:{label:'vierteljährlich',n:3},halfyearly:{label:'halbjährlich',n:6},yearly:{label:'jährlich',n:12}};

const now=new Date(now0);
const S={tab:'home',y:now.getFullYear(),m:now.getMonth()+1,items:null,cfg:null,entries:[],docs:{},incomeActual:{},navigated:false,history:{},db:null,dbState:'loading',draft:{kind:'expense',amount:'',cat:null,note:'',date:''},confirm:null};
const DEFCFG={flexCats:[{id:'essen',name:'Essen',budget:0},{id:'sonstiges',name:'Sonstiges',budget:0}],buffer:100,remindDays:2,restLabel:'Trade Republic',balance:null,balanceDate:null,includeFlex:true};
const cfg=()=>Object.assign({},DEFCFG,S.cfg||{});
/* ---------- Versionen: Änderungen gelten ab einem Monat ---------- */
const VKEY=()=>mk(S.y,S.m);
const NOWKEY=()=>mk(now.getFullYear(),now.getMonth()+1);
function legacyFields(doc){const {id,versions,...f}=doc;return f}
// vfrom = ab welchem Monat eine Version gilt (nicht verwechseln mit dem Feld from = „Gilt ab“ des Postens)
const vf=v=>v.vfrom||'0000-00';
function resolve(doc,key){
  if(!doc.versions)return doc;
  let v=null;for(const x of doc.versions)if(vf(x)<=key)v=x;
  if(!v||v.removed)return null;
  const {vfrom,removed,...f}=v;return{id:doc.id,...f,_since:vf(v)};
}
const itemsAt=key=>(S.raw||[]).map(d=>resolve(d,key)).filter(Boolean);
function refreshItems(){if(S.raw)S.items=itemsAt(VKEY())}
function saveItemFrom(out,key){
  const doc=(S.raw||[]).find(d=>d.id===out.id);
  const {id,_since,...f}=out;
  const base=doc?(doc.versions||[{...legacyFields(doc),vfrom:'0000-00'}]):[];
  const body={versions:[...base.filter(v=>vf(v)<key),{...f,vfrom:key}]};
  const i=S.raw.findIndex(d=>d.id===id);if(i>=0)S.raw[i]={id,...body};else S.raw.push({id,...body});refreshItems();
  if(S.db)queue('it'+id,()=>S.db.collection('items').doc(id).set(body));
}
function removeItemFrom(id,key){
  const doc=(S.raw||[]).find(d=>d.id===id);if(!doc)return;
  const earlier=(doc.versions||[{...legacyFields(doc),vfrom:'0000-00'}]).filter(v=>vf(v)<key);
  if(!earlier.length){S.raw=S.raw.filter(d=>d.id!==id);refreshItems();if(S.db)queue('it'+id,()=>S.db.collection('items').doc(id).delete());return}
  const body={versions:[...earlier,{vfrom:key,removed:true}]};
  S.raw=S.raw.map(d=>d.id===id?{id,...body}:d);refreshItems();
  if(S.db)queue('it'+id,()=>S.db.collection('items').doc(id).set(body));
}
function catVersions(){const c=cfg();return c.catVersions&&c.catVersions.length?c.catVersions:[{from:'0000-00',cats:c.flexCats}]}
function catsAt(key){const vs=catVersions();let v=vs[0];for(const x of vs)if(x.from<=key)v=x;return v.cats||[]}
function saveCatsFrom(cats,key){saveCfg({catVersions:[...catVersions().filter(v=>v.from<key),{from:key,cats}],flexCats:cats})}
const sinceNote=()=>`Gilt ab ${MON[S.m-1]} ${S.y} und für alle folgenden Monate. Frühere Monate bleiben unverändert, damit du zurückblicken kannst.`;


function payDay(){
  const c=+cfg().cycleDay;if(c>=1&&c<=31)return c;
  const inc=itemsAt(NOWKEY()).filter(i=>i.kind==='income'&&!i.paused&&i.day&&(i.interval||'monthly')==='monthly').sort((a,b)=>b.amount-a.amount)[0];
  return inc?inc.day:1;
}
function cycleOf(y,m){
  const pd=payDay(),start=new Date(y,m-1,Math.min(pd,dim(y,m)));
  const ny=m===12?y+1:y,nm=m===12?1:m+1,end=addDays(new Date(ny,nm-1,Math.min(pd,dim(ny,nm))),-1);
  return{start,end,keys:pd===1?[mk(y,m)]:[mk(y,m),mk(ny,nm)]};
}
function cycleForDate(d){
  const y=d.getFullYear(),m=d.getMonth()+1;
  if(d>=cycleOf(y,m).start)return{y,m};
  return m===1?{y:y-1,m:12}:{y,m:m-1};
}
const curCycle=()=>cycleForDate(today0());
const isCurrent=()=>{const c=curCycle();return S.y===c.y&&S.m===c.m};
const cyc=()=>cycleOf(S.y,S.m);
const cycText=c=>c.start.getDate()===1&&c.start.getMonth()===c.end.getMonth()?'ganzer Monat':`${dm(c.start)}–${dm(c.end)}`;
function refreshEntries(){
  const c=cyc(),a=ymd(c.start),b=ymd(c.end),out=[];
  for(const k of c.keys)for(const e of((S.docs[k]||{}).entries||[]))if(e.date>=a&&e.date<=b)out.push(e);
  S.entries=out;S.incomeActual=(S.docs[mk(S.y,S.m)]||{}).incomeActual||{};
}

/* ---------- Rechenlogik ---------- */
const perMonth=it=>(+it.amount||0)/IV[it.interval||'monthly'].n;
function active(it,y,m){if(it.paused)return false;const k=mk(y,m);if(it.from&&k<it.from)return false;if(it.until&&k>it.until)return false;return true}
function hits(it,m){const n=IV[it.interval||'monthly'].n;if(n===1)return true;return(((m-(it.month||1))%n)+n)%n===0}
function occ(it,y,m){if(!active(it,y,m)||!hits(it,m))return null;return{it,y,m,date:it.day?new Date(y,m-1,Math.min(it.day,dim(y,m))):null}}
const monthOcc=(y,m)=>itemsAt(mk(y,m)).map(it=>occ(it,y,m)).filter(Boolean);
function occBetween(a,b){
  const out=[];let y=a.getFullYear(),m=a.getMonth()+1;const end=mk(b.getFullYear(),b.getMonth()+1);
  while(mk(y,m)<=end){for(const o of monthOcc(y,m))if(o.date&&o.date>=a&&o.date<=b)out.push(o);if(++m>12){m=1;y++}}
  return out.sort((p,q)=>p.date-q.date||(p.it.kind==='income')-(q.it.kind==='income'));
}
const isInc=e=>e.kind==='income';
function incomeOf(it,actual){const a=actual&&actual[it.id];return typeof a==='number'?a:perMonth(it)}
function plan(y,m,allEntries,actual){
  const its=itemsAt(mk(y,m)).filter(it=>active(it,y,m)),c=cfg();
  const entries=allEntries.filter(e=>!isInc(e));
  const oneOff=sum(allEntries.filter(isInc).map(e=>e.amount));
  const regular=sum(its.filter(i=>i.kind==='income').map(i=>incomeOf(i,actual)));
  const income=regular+oneOff;
  const fixed=sum(its.filter(i=>i.kind==='expense'&&(i.interval||'monthly')==='monthly').map(perMonth));
  const reserve=sum(its.filter(i=>i.kind==='expense'&&(i.interval||'monthly')!=='monthly').map(perMonth));
  const savings=sum(its.filter(i=>i.kind==='saving').map(perMonth));
  const fc=catsAt(mk(y,m)),ids=new Set(fc.map(x=>x.id));
  const cats=fc.map(x=>{const spent=sum(entries.filter(e=>e.cat===x.id).map(e=>e.amount));return{...x,spent,planned:Math.max(+x.budget||0,spent)}});
  const orphan=sum(entries.filter(e=>!ids.has(e.cat)).map(e=>e.amount));
  const flex=sum(cats.map(x=>x.planned))+orphan;
  const flexLeft=sum(cats.map(x=>Math.max(0,(+x.budget||0)-x.spent)));
  return{income,regular,oneOff,fixed,reserve,savings,flex,flexLeft,cats,orphan,rest:income-fixed-reserve-flex-savings};
}
function nextCancel(it,from){
  if(!it.cancelDay||!it.cancelMonth)return null;
  let d=new Date(from.getFullYear(),it.cancelMonth-1,it.cancelDay);if(d<from)d=new Date(from.getFullYear()+1,it.cancelMonth-1,it.cancelDay);return d;
}
function projection(){
  const c=cfg();if(c.balance==null||isNaN(c.balance))return null;
  const start=c.balanceDate?parseYmd(c.balanceDate):today0();
  const sc=cycleForDate(start),end=addDays(cycleOf(sc.y,sc.m).end,1),inc=true;
  const ev=occBetween(addDays(start,1),end).filter(o=>o.it.kind!=='income');
  let bal=c.balance,min=bal,minAt=start;const rows=[];
  // Flexible Ausgaben pro Kategorie: nach dem Kontostand gebuchte Beträge + was vom Ziel noch offen ist
  const p=plan(S.y,S.m,S.entries,S.incomeActual),cats=[];
  const after=e=>!isInc(e)&&(c.balanceTs&&e.ts?e.ts>c.balanceTs:e.date>ymd(start));
  for(const x of p.cats){
    const g=+x.budget||0,sa=sum(S.entries.filter(e=>e.cat===x.id&&after(e)).map(e=>e.amount));
    const open=c.includeFlex&&g?Math.max(0,g-x.spent):0;
    cats.push({name:x.name,goal:g,spent:x.spent,after:sa,open});
    if(sa+open<=0)continue;
    const sub=[];
    if(g)sub.push(`Ziel ${fmt(g)} − gebucht ${fmt(x.spent)} = offen ${fmt(open)}`);
    if(sa>0)sub.push(`${fmt(sa)} nach dem Kontostand gebucht`);
    bal-=sa+open;rows.push({label:x.name,sub:sub.join(' · '),date:null,amount:-(sa+open),bal});if(bal<min){min=bal;minAt=start}
  }
  const steps=ev.map(o=>({date:o.date,label:o.it.name,amount:-o.it.amount}));
  for(const e of S.entries)if(isInc(e)){const d=parseYmd(e.date);if(d>start&&d<=end)steps.push({date:d,label:e.note||'Einmalige Einnahme',amount:+e.amount})}
  steps.sort((a,b)=>a.date-b.date||a.amount-b.amount);
  for(const s of steps){bal+=s.amount;rows.push({...s,bal});if(bal<min){min=bal;minAt=s.date}}
  const status=min<0?'bad':min<(+c.buffer||0)?'warn':'good';
  return{start,end,inc,rows,min,minAt,status,total:sum(ev.map(o=>+o.it.amount))};
}
S.raw=Object.entries(docs).filter(([k])=>k.startsWith('items/')).map(([k,v])=>({id:k.slice(6),...v}));
S.cfg=Object.assign({},docs['config/main']||{},cfgPatch);
S.docs=Object.fromEntries(Object.entries(docs).filter(([k])=>k.startsWith('months/')).map(([k,v])=>[k.slice(7),v]));
S.y=y;S.m=m;refreshItems();refreshEntries();
return {S,plan,projection,payDay,cycleOf,cycleForDate,occBetween,itemsAt,catsAt,perMonth,incomeOf,ymd,addDays};
};
