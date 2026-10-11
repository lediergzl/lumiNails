import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import http from "http"; import fs from "fs"; import path from "path";
const APP = process.argv[2];
if (!["client","provider"].includes(APP)) { console.error("Uso: node run.mjs client|provider"); process.exit(2); }
// JPEG mínimo de 1x1 px para las fotos de servicios
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=","base64");
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const root = path.join(REPO, "apps", APP, "dist");
const srv = http.createServer((q,r)=>{ let f=path.join(root, q.url.split("?")[0]); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f=path.join(root,"index.html");
  const t={".js":"text/javascript",".css":"text/css",".html":"text/html",".svg":"image/svg+xml",".woff2":"font/woff2",".woff":"font/woff",".png":"image/png"}[path.extname(f)]||"application/octet-stream";
  r.writeHead(200,{"content-type":t}); fs.createReadStream(f).pipe(r); }).listen(4190);
const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const now=Math.floor(Date.now()/1000);
const jwt=`${b64({alg:"HS256",typ:"JWT"})}.${b64({sub:"u1",role:"authenticated",exp:now+36000})}.sig`;
const isProv = APP==="provider";
const user={id:"11111111-1111-1111-1111-111111111111",aud:"authenticated",role:"authenticated",email:isProv?"denisse@luni.app":"camila@correo.com",user_metadata:{display_name:isProv?"Denisse":"Camila Pérez"},app_metadata:{},created_at:new Date().toISOString()};
const session={access_token:jwt,refresh_token:"r",expires_at:process.env.EXPIRED?now-120:now+36000,expires_in:36000,token_type:"bearer",user};
const P="22222222-2222-2222-2222-222222222222";
const day=(n,h,m=0)=>{const d=new Date();d.setDate(d.getDate()+n);d.setHours(h,m,0,0);return d.toISOString()};
const svc=(i,n,d,p,min,img)=>({id:`s${i}`,provider_id:P,name:n,description:d,price_cents:p*100,currency:"CUP",duration_minutes:min,is_active:true,thumb_path:img!=null?`${P}/s${i}/h-thumb.jpg`:null,card_path:img!=null?`${P}/s${i}/h${img}-card.jpg`:null,detail_path:null,blurhash:null});
const services=[svc(1,"Uñas nuevas · largas","Set completo en acrílico con forma y pintura simple.",2500,150,0),svc(2,"Relleno de acrílico","Incluye pintura y decoración extremadamente sencilla.",1500,90,1),svc(3,"Pedicura · cover en todas","Cover acrílico en las diez uñas, incluye pintura.",1000,75,null),svc(4,"Efecto ojo de gato","Efecto magnético por pareja de uñas.",150,20,2)];
const appts=[
 {id:"a1",provider_id:P,client_id:"c1",service_id:"s1",starts_at:day(1,10),ends_at:day(1,12,30),status:"pending_confirmation",notes:"Quiero tonos nude",client_service_name:"Uñas nuevas · largas",client_price_cents:250000,client_currency:"CUP",cancellation_reason:"",client_display_name:"Camila Pérez",client_phone:"55501234"},
 {id:"a2",provider_id:P,client_id:"c2",service_id:"s2",starts_at:day(2,15),ends_at:day(2,16,30),status:"confirmed",notes:"",client_service_name:"Relleno de acrílico",client_price_cents:150000,client_currency:"CUP",cancellation_reason:"",client_display_name:"Marta León",client_phone:"55509876"},
 {id:"a3",provider_id:P,client_id:"c1",service_id:"s4",starts_at:day(-3,11),ends_at:day(-3,11,20),status:"completed",notes:"",client_service_name:"Efecto ojo de gato",client_price_cents:15000,client_currency:"CUP",cancellation_reason:"",client_display_name:"Camila Pérez",client_phone:"55501234"},
 {id:"a4",provider_id:P,client_id:"c1",service_id:"s2",starts_at:day(5,9),ends_at:day(5,10,30),status:"rejected",notes:"",client_service_name:"Relleno de acrílico",client_price_cents:150000,client_currency:"CUP",cancellation_reason:"Ese día no podré atender",client_display_name:"Camila Pérez",client_phone:"55501234"}];
const providerRow={id:P,user_id:user.id,slug:"denisse-nails",business_name:"Denisse Nails",bio:"Spa de uñas en La Habana Vieja",avatar_path:null,trial_started_at:new Date().toISOString(),license_expires_at:day(20,0),license_status:"trial",is_published:true,timezone:"America/Havana"};
const days=[...Array(14)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return {day:d.toISOString().slice(0,10),slots:[0,0,3,4,2,0,5,6,1,3,0,4,2,5][i]}});
const slots=[9,10,11,13,15,16].map(h=>({starts_at:day(2,h)}));
const tables={profiles:[{phone:"55501234"}],provider_profiles:[providerRow],services,appointments:appts,weekly_schedule:[{weekday:1,start_time:"09:00",end_time:"17:00"},{weekday:2,start_time:"09:00",end_time:"17:00"},{weekday:4,start_time:"10:00",end_time:"18:00"}],availability:[],provider_turns:[]};
const rpcs={luni_my_client_providers:[{provider_id:P,business_name:"Denise Nails",slug:"denisse-nails",bio:"Spa de uñas en La Habana Vieja",relationship_id:"r1",linked_at:new Date().toISOString()}],luni_available_days:days,luni_available_slots:slots,luni_provider_appointments_with_contacts:appts,luni_provider_clients:[{client_id:"c1",display_name:"Camila Pérez",phone:"55501234",linked_at:day(-30,0),appointment_count:4,last_appointment_at:day(-3,11)},{client_id:"c2",display_name:"Marta León",phone:"55509876",linked_at:day(-10,0),appointment_count:1,last_appointment_at:null}],luni_create_provider_invite:[{token:"LUNI-7K2P-9QXD"}]};

let results=[]; const check=(name,ok)=>{ results.push(ok); console.log((ok?"PASS ":"FAIL ")+name); };
const ctl={offline:false,delay:0,expired:false,noActive:false};
const bro = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: "shell" });
async function boot(expired=false){
  const p = await bro.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await p.evaluateOnNewDocument((s,seed)=>{ if(seed && !localStorage.getItem("sb-127-auth-token")) localStorage.setItem("sb-127-auth-token", JSON.stringify(s)); }, session, true);
  await p.setRequestInterception(true);
  const json=(r,o,status=200)=>r.respond({status,contentType:"application/json",headers:{"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"},body:JSON.stringify(o)});
  p.on("request", async r=>{ const u=new URL(r.url());
    if(u.hostname!=="127.0.0.1"||u.port!=="54321") return r.continue();
    if(process.env.DEBUG&&ctl.offline) console.log("[REQ-ABORT]",r.method(),u.pathname+u.search.slice(0,40));
    if(ctl.offline) return r.abort("internetdisconnected");
    if(r.method()==="OPTIONS") return r.respond({status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*"}});
    if(ctl.delay) await new Promise(x=>setTimeout(x,ctl.delay));
    if(u.pathname.startsWith("/storage/")) return r.respond({status:200,contentType:"image/jpeg",headers:{"access-control-allow-origin":"*"},body:JPEG});
    if(u.pathname.startsWith("/auth/v1/user")) return json(r,user);
    if(u.pathname.startsWith("/auth/v1/")) return json(r,{...session,expires_at:Math.floor(Date.now()/1000)+36000});
    if(u.pathname.startsWith("/rest/v1/rpc/")){ const n=u.pathname.split("/").pop(); return json(r,rpcs[n]??[]); }
    if(u.pathname.startsWith("/rest/v1/")){ const t=u.pathname.split("/").pop(); let rows=tables[t]??[]; if(ctl.noActive&&t==="appointments") rows=rows.filter(a=>["completed","rejected"].includes(a.status)); const single=(r.headers().accept||"").includes("pgrst.object"); return json(r, single?(rows[0]??null):rows); }
    json(r,{});
  });
  if(process.env.DEBUG){ p.on("console",m=>{ if(["error","warning"].includes(m.type())) console.log("[console."+m.type()+"]",m.text().slice(0,200)); }); p.on("pageerror",e=>console.log("[pageerror]",e.message.slice(0,200))); }
  return p;
}
const open=async p=>{ await p.goto("http://127.0.0.1:4190/",{waitUntil:"networkidle0",timeout:30000}).catch(()=>{}); await new Promise(r=>setTimeout(r,1200)); };
const text=p=>p.evaluate(()=>document.body.innerText);
const click=(p,label)=>p.evaluate(l=>{ const el=[...document.querySelectorAll("button,a,[role=tab]")].find(e=>e.innerText&&e.innerText.trim().toLowerCase().includes(l.toLowerCase())); if(el){el.click();return true} return false },label);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const expire=p=>p.evaluate(()=>{ const k="sb-127-auth-token"; const s=JSON.parse(localStorage.getItem(k)); s.expires_at=Math.floor(Date.now()/1000)-300; localStorage.setItem(k,JSON.stringify(s)); });
const DATA = APP==="client" ? ["Denise Nails"] : ["Denisse Nails"];
const has=t=>DATA.every(x=>t.includes(x)) && (APP==="client" ? /Servicios\s+4/.test(t) : true);

// 1) con red: se llena la copia
const p = await boot(); await open(p);
let t=await text(p); if(process.env.DEBUG) console.log("[ONLINE]",t.replace(/\n+/g," | ").slice(0,500));
check("con red: carga los datos y no muestra aviso",has(t)&&!/Sin conexión|datos guardados/.test(t));
await click(p, APP==="client"?"Mis citas":"Servicios"); await wait(500);
// 2) sin red (lie-fi: navigator.onLine sigue en true, las peticiones fallan)
if(process.env.DEBUG) console.log("[IDB keys]",JSON.stringify(await p.evaluate(()=>new Promise(res=>{const r=indexedDB.open("luni-offline",1); r.onsuccess=()=>{const q=r.result.transaction("snapshots").objectStore("snapshots").getAllKeys(); q.onsuccess=()=>res(q.result)}}))));
ctl.offline=true; await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(+(process.env.WAIT||1500));
t=await text(p); if(process.env.DEBUG) console.log("[OFFLINE]",t.replace(/\n+/g," | ").slice(0,500));
check("sin red: muestra los datos guardados",has(t));
await click(p, APP==="client"?"Mis citas":"Clientas"); await wait(600);
{ const tt=await text(p); check(APP==="client"?"sin red: 'Mis citas' muestra las citas guardadas":"sin red: 'Clientas' muestra las clientas guardadas", APP==="client"? /Uñas nuevas · largas/.test(tt)&&/Pendiente de confirmar/.test(tt) : /Camila Pérez/.test(tt)); }
await click(p, APP==="client"?"Descubrir":"Agenda"); await wait(400);
if(process.env.SHOT) await p.screenshot({path:path.join(REPO,"scripts/e2e-offline",`offline-${APP}.png`)});
check("sin red: aviso 'datos guardados hace…'",/Sin conexión con el servidor · datos guardados hace/.test(t));
check("sin red: ningún 'Failed to fetch' en pantalla",!/failed to fetch/i.test(t));
if(APP==="provider") check("sin red: NO ofrece 'Registra tu estudio'",!/Registra tu\s+estudio/i.test(t));
// 3) sesión caducada + sin red
await expire(p); await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(1500);
t=await text(p);
check("token caducado y sin red: la sesión se conserva y se ven los datos",has(t)&&!/Iniciar sesión\s*\n/.test(t.split("Hecho")[0]) );
// 4) reconexión
ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online"))); await wait(2500);
t=await text(p);
check("al volver la red: desaparece el aviso y siguen los datos",!/datos guardados/.test(t)&&has(t));
// 5) sin red real (evento offline): reservar exige conexión
if(APP==="client"){
  ctl.noActive=true; await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(1200);
  const cdp=await p.createCDPSession(); await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await wait(600); await click(p,"Descubrir"); await wait(500);
  await click(p,"Servicios"); await wait(500);
  const opened=await click(p,"Reservar este servicio"); await wait(800);
  t=await text(p); if(process.env.DEBUG) console.log("[BOOK]",opened,JSON.stringify(t.split("\n").filter(l=>/conexi|Enviar|Elige|Reserva|tel/i.test(l))));
  check("sin red: 'Sin conexión' en el aviso y en el botón de reservar",opened&&/Sin conexión\s*(\n|$)/.test(t)&&t.split("\n").some(l=>/^Sin conexión\s*↗?$/.test(l.trim())));
  await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
}
// 6) red lenta: con copia guardada no se espera eternamente
ctl.delay=12000; const t0=Date.now(); await p.reload({waitUntil:"domcontentloaded"}).catch(()=>{}); 
let ok=false; for(let i=0;i<14&&!ok;i++){ await wait(1000); const x=await text(p); ok=has(x)&&/Conexión lenta/.test(x); }
const secs=((Date.now()-t0)/1000).toFixed(1);
check(`red lenta (12 s): muestra lo guardado en ~${secs}s con aviso 'Conexión lenta' (límite 11 s)`, ok && Date.now()-t0<11500);
ctl.delay=0; await p.close();

// 7) cerrar sesión borra la copia
const p2=await boot(); await open(p2); ctl.delay=0;
await click(p2, APP==="client"?"Mi perfil":"Negocio"); await wait(600);
const before=await p2.evaluate(()=>new Promise(res=>{const r=indexedDB.open("luni-offline",1); r.onsuccess=()=>{const q=r.result.transaction("snapshots").objectStore("snapshots").count(); q.onsuccess=()=>res(q.result)}; r.onerror=()=>res(-1)}));
if(APP==="provider"){ await click(p2,"Cuenta"); await wait(500); }
const clicked=await click(p2,"Cerrar sesión"); await wait(1500); if(process.env.DEBUG) console.log("[LOGOUT] click:",clicked,"| texto:",(await text(p2)).replace(/\n+/g," | ").slice(0,260));
const after=await p2.evaluate(()=>new Promise(res=>{const r=indexedDB.open("luni-offline",1); r.onsuccess=()=>{const q=r.result.transaction("snapshots").objectStore("snapshots").count(); q.onsuccess=()=>res(q.result)}; r.onerror=()=>res(-1)}));
check(`cerrar sesión borra la copia local (${before} -> ${after})`, before>0 && after===0);
await p2.close();

// 8) sin copia previa y sin red
await bro.close();
const bro2 = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: "shell" });
const p3 = await (async()=>{ const q=await bro2.newPage(); await q.setViewport({width:390,height:844,isMobile:true}); await q.evaluateOnNewDocument((s)=>{ if(!localStorage.getItem("sb-127-auth-token")) localStorage.setItem("sb-127-auth-token", JSON.stringify(s)); }, session); await q.setRequestInterception(true); q.on("request",r=>{ const u=new URL(r.url()); if(u.port==="54321") return r.abort("internetdisconnected"); r.continue(); }); return q; })();
await p3.goto("http://127.0.0.1:4190/",{waitUntil:"networkidle0"}).catch(()=>{}); await wait(1500);
t=await text(p3);
if(APP==="provider") check("sin copia y sin red: avisa que faltan datos guardados (no 'Registra tu estudio')",/Aún no hay\s+datos guardados/i.test(t)&&!/Registra tu\s+estudio/i.test(t));
else check("sin copia y sin red: mensaje en español, sin 'Failed to fetch'",/Sin conexión/.test(t)&&!/failed to fetch/i.test(t));
await bro2.close(); srv.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} OK`);
process.exit(results.every(Boolean) ? 0 : 1);
