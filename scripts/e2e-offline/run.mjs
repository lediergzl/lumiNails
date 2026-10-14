import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import http from "http"; import fs from "fs"; import path from "path";
const APP = process.argv[2];
if (!["client","provider"].includes(APP)) { console.error("Uso: node run.mjs client|provider"); process.exit(2); }
// JPEG mínimo de 1x1 px para las fotos de servicios
// PNG válido de 1x1 px para las fotos de servicios
const JPEG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64");
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
const ctl={offline:false,delay:0,expired:false,noActive:false,rejectWrites:false,writes:[],uploads:[]};
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
    if(r.method()!=="GET"&&u.pathname.startsWith("/rest/v1/")&&!u.pathname.includes("/rpc/")){
      const t=u.pathname.split("/").pop(); let body={}; try{ body=JSON.parse(r.postData()||"{}"); }catch{}
      ctl.writes.push({method:r.method(),table:t,query:u.search,body});
      if(ctl.rejectWrites) return json(r,{message:"APPOINTMENT_STATUS_CHANGE_FORBIDDEN",code:"42501"},400);
      const id=(u.searchParams.get("id")||"").replace("eq.","");
      const rows=tables[t]||[];
      if(r.method()==="PATCH"){ const row=rows.find(x=>x.id===id); if(row){ Object.assign(row,body); return json(r,[{id}]); } return json(r,[]); }
      if(r.method()==="POST"){ rows.push({is_active:true,...body}); return json(r,[{id:body.id}],201); }
      return json(r,[]);
    }
    if(u.pathname.startsWith("/storage/")){
      if(r.method()==="GET") return r.respond({status:200,contentType:"image/png",headers:{"access-control-allow-origin":"*"},body:JPEG});
      if(r.method()==="POST") ctl.uploads.push(u.pathname);
      return json(r,{Key:u.pathname.replace("/storage/v1/object/","")});
    }
    if(u.pathname.startsWith("/auth/v1/user")) return json(r,user);
    if(u.pathname.startsWith("/auth/v1/")) return json(r,{...session,expires_at:Math.floor(Date.now()/1000)+36000});
    if(u.pathname.startsWith("/rest/v1/rpc/")){ const n=u.pathname.split("/").pop(); return json(r,rpcs[n]??[]); }
    if(u.pathname.startsWith("/rest/v1/")){ const t=u.pathname.split("/").pop(); let rows=tables[t]??[]; if(ctl.noActive&&t==="appointments") rows=rows.filter(a=>["completed","rejected"].includes(a.status)); if((u.searchParams.get("id")||"").startsWith("eq.")) rows=rows.filter(x=>x.id===u.searchParams.get("id").slice(3)); const single=(r.headers().accept||"").includes("pgrst.object"); return json(r, single?(rows[0]??null):rows); }
    json(r,{});
  });
  if(process.env.DEBUG){ p.on("console",m=>{ if(["error","warning"].includes(m.type())) console.log("[console."+m.type()+"]",m.text().slice(0,200)); }); p.on("pageerror",e=>console.log("[pageerror]",e.message.slice(0,200))); }
  return p;
}
const open=async p=>{ await p.goto("http://127.0.0.1:4190/",{waitUntil:"networkidle0",timeout:30000}).catch(()=>{}); await new Promise(r=>setTimeout(r,1200)); };
const text=p=>p.evaluate(()=>document.body.innerText);
const click=(p,label)=>p.evaluate(l=>{ const el=[...document.querySelectorAll("button,a,[role=tab]")].find(e=>e.innerText&&e.innerText.trim().toLowerCase().includes(l.toLowerCase())); if(el){el.click();return true} return false },label);
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const RESPONSIVE_WIDTHS = [320, 360, 375, 390, 414, 430, 540, 650, 768, 820, 1024, 1280];
async function auditResponsive(p, screenName) {
  const problems = [];
  for (const width of RESPONSIVE_WIDTHS) {
    await p.setViewport({ width, height: 844, deviceScaleFactor: 1, isMobile: true });
    await wait(90);
    const size = await p.evaluate(() => ({
      viewport: document.documentElement.clientWidth || window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    if (size.document > size.viewport + 1 || size.body > size.viewport + 1) {
      problems.push({ width, ...size });
    }
  }
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await wait(120);
  if (problems.length) console.log("[RESPONSIVE OVERFLOW]", screenName, JSON.stringify(problems));
  check("responsive " + screenName + ": sin desbordamiento horizontal entre 320 y 1280 px", problems.length === 0);
}
async function auditApplicationScreens(p) {
  await auditResponsive(p, APP === "client" ? "Descubrir" : "Agenda");
  const labels = APP === "client"
    ? ["Mis citas", "Mi perfil", "Descubrir"]
    : ["Servicios", "Trabajos", "Clientas", "Colores", "Negocio", "Agenda"];
  for (const label of labels) {
    const moved = await click(p, label);
    if (!moved) {
      check("responsive pantalla " + label + ": navegación disponible", false);
      continue;
    }
    await wait(260);
    await auditResponsive(p, label);
  }
  // Deja el E2E funcional en la pantalla inicial; sus pruebas posteriores
  // continúan usando sus propios pasos y estado esperado.
  await click(p, APP === "client" ? "Descubrir" : "Agenda");
  await wait(260);
}
const expire=p=>p.evaluate(()=>{ const k="sb-127-auth-token"; const s=JSON.parse(localStorage.getItem(k)); s.expires_at=Math.floor(Date.now()/1000)-300; localStorage.setItem(k,JSON.stringify(s)); });
const DATA = APP==="client" ? ["Denise Nails"] : ["Denisse Nails"];
const has=t=>DATA.every(x=>t.includes(x)) && (APP==="client" ? /Servicios\s+4/.test(t) : true);

// 1) con red: se llena la copia
const p = await boot(); await open(p);
await auditApplicationScreens(p);
let t=await text(p); if(process.env.DEBUG) console.log("[ONLINE]",t.replace(/\n+/g," | ").slice(0,500));
check("con red: carga los datos y no muestra aviso",has(t)&&!/Sin conexión|datos guardados/.test(t));
await click(p, APP==="client"?"Mis citas":"Servicios"); await wait(500);
// 2) sin red (lie-fi: navigator.onLine sigue en true, las peticiones fallan)
if(process.env.DEBUG) console.log("[IDB keys]",JSON.stringify(await p.evaluate(()=>new Promise(res=>{const r=indexedDB.open("luni-offline"); r.onsuccess=()=>{const q=r.result.transaction("snapshots").objectStore("snapshots").getAllKeys(); q.onsuccess=()=>res(q.result)}}))));
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
ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online")));
const tR=Date.now(); let cleared=false;
for(let i=0;i<20&&!cleared;i++){ await wait(500); t=await text(p); cleared=!/datos guardados|Sin conexión/.test(t)&&has(t); }
const secsR=((Date.now()-tR)/1000).toFixed(1);
check(`al volver la red: desaparece el aviso y siguen los datos (en ${secsR}s, límite 6 s)`,cleared&&Date.now()-tR<6000);
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


// 6b) escribir sin conexión: se guarda en el teléfono, sobrevive a recargar y se envía al volver la red
{
ctl.delay=0; ctl.noActive=false; ctl.offline=false;
const iso=n=>{ const d=new Date(Date.now()+n*86400000); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const setDate=(p,v)=>p.evaluate(v=>{ const i=document.querySelector("input[type=date]"); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(i,v); i.dispatchEvent(new Event("input",{bubbles:true})); i.dispatchEvent(new Event("change",{bubbles:true})); },v);
const setField=(p,sel,v)=>p.evaluate((sel,v)=>{ const i=document.querySelector(sel); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(i,v); i.dispatchEvent(new Event("input",{bubbles:true})); },sel,v);
const clickX=(p,label)=>p.evaluate(l=>{ const el=[...document.querySelectorAll("button")].find(e=>e.innerText&&e.innerText.trim().toLowerCase()===l.toLowerCase()); if(el){el.click();return true} return false },label);
const wrote=(table,re)=>ctl.writes.some(w=>w.table===table&&re.test(JSON.stringify(w.body)));
const p = await boot(); await open(p);
ctl.writes.length=0;
if(APP==="client"){
  await click(p,"Mis citas"); await wait(500);
  ctl.offline=true;
  await clickX(p,"Cancelar cita"); await wait(300); await clickX(p,"Sí, cancelar"); await wait(1500);
  t=await text(p); const notedOk=/Cancelación guardada en este teléfono/.test(t)&&/1 cambio sin enviar/.test(t);
  await click(p,"Historial"); await wait(500); t=await text(p);
  check("cliente sin red: cancelar queda guardado en el teléfono y la cita aparece 'Cancelada' en el historial",notedOk&&/Cancelada/.test(t));
  await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(2000); await click(p,"Mis citas"); await wait(600); await click(p,"Historial"); await wait(500);
  t=await text(p);
  check("cliente: tras recargar sin red la cancelación sigue visible y pendiente",/1 cambio sin enviar/.test(t)&&/Cancelada/.test(t));
  ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online"))); await wait(3000);
  t=await text(p);
  check("cliente: al volver la red se envía la cancelación al servidor",wrote("appointments",/cancelled/)&&!/sin enviar/.test(t));
  // el servidor rechaza un cambio: la persona debe enterarse
  ctl.rejectWrites=true; ctl.offline=true; await click(p,"Mis citas"); await wait(300); await click(p,"Próximas"); await wait(400);
  await clickX(p,"Cancelar cita"); await wait(300); await clickX(p,"Sí, cancelar"); await wait(1200);
  ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online"))); await wait(3000);
  t=await text(p);
  check("cliente: si el servidor rechaza el cambio, se avisa con el motivo y no queda pendiente",/no se pudo aplicar/.test(t)&&/Entendido/.test(t)&&!/sin enviar/.test(t));
  await clickX(p,"Entendido"); await wait(500); t=await text(p);
  check("cliente: 'Entendido' descarta el aviso",!/no se pudo aplicar/.test(t));
  ctl.rejectWrites=false;
} else {
  await setDate(p,iso(1)); await wait(900);
  ctl.offline=true;
  await clickX(p,"Confirmar"); await wait(1500);
  t=await text(p);
  check("manicurista sin red: confirmar queda guardado en el teléfono y la cita sale 'Confirmada'",/Guardado en este teléfono/.test(t)&&/1 cambio sin enviar/.test(t)&&/Confirmada/.test(t));
  await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(2000); await setDate(p,iso(1)); await wait(900);
  t=await text(p);
  check("manicurista: tras recargar sin red la cita sigue 'Confirmada' y el cambio pendiente",/1 cambio sin enviar/.test(t)&&/Confirmada/.test(t));
  // editar un servicio sin red
  await click(p,"Servicios"); await wait(500); await clickX(p,"Editar"); await wait(500);
  await setField(p,".provider-modal input","Uñas nuevas · XL"); await wait(200);
  await clickX(p,"Guardar servicio"); await wait(1500);
  t=await text(p);
  check("manicurista sin red: editar un servicio queda en cola y se ve el nombre nuevo",/Uñas nuevas · XL/.test(t)&&/2 cambios sin enviar/.test(t));
  ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online"))); await wait(3500);
  t=await text(p);
  check("manicurista: al volver la red se envían los cambios en orden y desaparece el aviso",wrote("appointments",/confirmed/)&&wrote("services",/Uñas nuevas · XL/)&&!/sin enviar/.test(t));
  // el servidor rechaza un cambio
  await click(p,"Agenda"); await wait(400); await setDate(p,iso(2)); await wait(900);
  ctl.rejectWrites=true; ctl.offline=true;
  await clickX(p,"Completar"); await wait(1200);
  ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online"))); await wait(3000);
  t=await text(p);
  check("manicurista: si el servidor rechaza el cambio, se avisa con el motivo y no queda pendiente",/no se pudo aplicar/.test(t)&&/Entendido/.test(t)&&!/sin enviar/.test(t));
  ctl.rejectWrites=false;
}
await p.close();
}


// 6c) fotos: las ya vistas se ven sin conexión; añadir una foto sin conexión queda en cola
{
  ctl.delay=0; ctl.offline=false; ctl.rejectWrites=false;
  const clickX=(p,label)=>p.evaluate(l=>{ const el=[...document.querySelectorAll("button")].find(e=>e.innerText&&e.innerText.trim().toLowerCase()===l.toLowerCase()); if(el){el.click();return true} return false },label);
  const scrollAll=p=>p.evaluate(async()=>{ for(let y=0;y<document.body.scrollHeight+400;y+=350){ window.scrollTo(0,y); await new Promise(r=>setTimeout(r,160)); } window.scrollTo(0,0); });
  const wrote=(table,re)=>ctl.writes.some(w=>w.table===table&&re.test(JSON.stringify(w.body)));
  const photos=p=>p.evaluate(()=>[...document.querySelectorAll("img.service-photo")].map(i=>({blob:i.src.startsWith("blob:"),ok:i.complete&&i.naturalWidth>0})));
  const p = await boot(); await open(p);
  await click(p,"Servicios"); await wait(800); await scrollAll(p); await wait(1200);
  const before=(await photos(p)).length;
  ctl.offline=true; await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(2500);
  await click(p,"Servicios"); await wait(800); await scrollAll(p); await wait(1000);
  const after=await photos(p);
  check(`sin red: las fotos de servicios ya vistas se siguen mostrando desde el teléfono (${after.length} de ${before})`,before>0&&after.length===before&&after.every(x=>x.blob&&x.ok));
  if(APP==="provider"){
    // añadir una foto sin conexión
    const jpeg=await p.evaluate(()=>{ const c=document.createElement("canvas"); c.width=1200; c.height=800; const x=c.getContext("2d"); x.fillStyle="#d88"; x.fillRect(0,0,1200,800); x.fillStyle="#fff"; x.fillRect(150,120,400,300); return c.toDataURL("image/jpeg",0.92); });
    const file=path.join(REPO,"scripts/e2e-offline","foto-prueba.jpg"); fs.writeFileSync(file,Buffer.from(jpeg.split(",")[1],"base64"));
    ctl.writes.length=0; ctl.uploads.length=0;
    await click(p,"Servicios"); await wait(500); await clickX(p,"Editar"); await wait(600);
    const input=await p.$(".provider-modal input[type=file]"); await input.uploadFile(file);
    let ready=false; for(let i=0;i<20&&!ready;i++){ await wait(400); ready=/Lista para subir/.test(await text(p)); }
    await clickX(p,"Guardar servicio"); await wait(2000);
    t=await text(p);
    const local=(await photos(p)).filter(x=>x.blob&&x.ok).length;
    check("manicurista sin red: la foto nueva queda en cola, se ve ya en pantalla y avisa 'sin enviar'",ready&&/Guardado en este teléfono, con su foto/.test(t)&&/cambios? sin enviar/.test(t)&&local>=1);
    await p.reload({waitUntil:"networkidle0"}).catch(()=>{}); await wait(2500); await click(p,"Servicios"); await wait(1000);
    t=await text(p);
    check("manicurista: tras recargar sin red la foto pendiente sigue visible",/cambios? sin enviar/.test(t)&&(await photos(p)).some(x=>x.blob&&x.ok));
    ctl.offline=false; await p.evaluate(()=>window.dispatchEvent(new Event("online")));
    let sent=false; for(let i=0;i<20&&!sent;i++){ await wait(500); t=await text(p); sent=ctl.uploads.length>=2&&wrote("services",/card_path/)&&!/sin enviar/.test(t); }
    if(process.env.DEBUG){ console.log("[SEND] uploads:",JSON.stringify(ctl.uploads),"| writes:",JSON.stringify(ctl.writes.map(w=>w.method+" "+w.table+" "+JSON.stringify(w.body).slice(0,90)))); console.log("[SEND] texto:",t.replace(/\n+/g," | ").slice(0,300)); }
    check(`manicurista: al volver la red se suben miniatura y foto y se enlazan al servicio (${ctl.uploads.length} archivos)`,sent);
    try{ fs.unlinkSync(file); }catch{}
  }
  await p.close();
}

// 7) cerrar sesión borra la copia
const p2=await boot(); await open(p2); ctl.delay=0;
await click(p2, APP==="client"?"Mi perfil":"Negocio"); await wait(600);
const before=await p2.evaluate(()=>new Promise(res=>{const r=indexedDB.open("luni-offline"); r.onsuccess=()=>{const q=r.result.transaction("snapshots").objectStore("snapshots").count(); q.onsuccess=()=>res(q.result)}; r.onerror=()=>res(-1)}));
if(APP==="provider"){ await click(p2,"Cuenta"); await wait(500); }
const clicked=await click(p2,"Cerrar sesión"); await wait(1500); if(process.env.DEBUG) console.log("[LOGOUT] click:",clicked,"| texto:",(await text(p2)).replace(/\n+/g," | ").slice(0,260));
const after=await p2.evaluate(()=>new Promise(res=>{const r=indexedDB.open("luni-offline"); r.onsuccess=()=>{const q=r.result.transaction("snapshots").objectStore("snapshots").count(); q.onsuccess=()=>res(q.result)}; r.onerror=()=>res(-1)}));
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
