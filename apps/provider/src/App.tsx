import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import ScheduleEditor from "./ScheduleEditor";
import ManualTurnsEditor from "./ManualTurnsEditor";
import {
  createMyProviderProfile,
  createProviderInvite,
  listProviderClients,
  getCurrentSession,
  getMyProviderProfile,
  isSupabaseConfigured,
  listMyProviderServices,
  listProviderAppointments,
  onAuthStateChange,
  saveProviderService,
  setProviderServiceActive,
  setProviderServicePhoto,
  getSupabaseClient,
  setProviderAppointmentStatus,
  signOut,
  type ProviderAppointment,
  type ProviderProfile,
  type ProviderService,
  type ProviderClient,
  type PortfolioItem,
  listMyPortfolio,
  savePortfolioItem,
  deletePortfolioItem,
} from "@lumi/api";

type Tab = "agenda" | "servicios" | "trabajos" | "clientes" | "perfil";
const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
async function compressPortfolioImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen válida.");
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo procesar la foto.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.size <= 500 * 1024) return blob;
  }
  throw new Error("La foto sigue siendo demasiado grande. Prueba con otra imagen.");
}

const statusText: Record<string, string> = {
  pending_confirmation: "Por confirmar", confirmed: "Confirmada", cancelled: "Cancelada",
  rejected: "Rechazada", completed: "Completada"
};

export default function App() {
  const [tab, setTab] = useState<Tab>("agenda");
  const [sessionEmail, setSessionEmail] = useState("");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [appointments, setAppointments] = useState<ProviderAppointment[]>([]);
  const [clients, setClients] = useState<ProviderClient[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [servicePhoto, setServicePhoto] = useState<File | null>(null);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [workTitle, setWorkTitle] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [workCategory, setWorkCategory] = useState("Diseños");
  const [workPhotos, setWorkPhotos] = useState<File[]>([]);
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null);
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("800");
  const [serviceDuration, setServiceDuration] = useState("45");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));

  const refresh = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    if (!session) {
      setProfile(null); setServices([]); setAppointments([]); setClients([]); setPortfolioItems([]); setInviteLink("");
      return;
    }
    const currentProfile = await getMyProviderProfile();
    setProfile(currentProfile);
    if (!currentProfile) {
      setServices([]); setAppointments([]); setClients([]); setPortfolioItems([]);
      return;
    }
    const [serviceRows, appointmentRows, clientRows] = await Promise.all([
      listMyProviderServices(currentProfile.id),
      listProviderAppointments(currentProfile.id),
      listProviderClients(currentProfile.id),
      listMyPortfolio(currentProfile.id),
    ]);
    setServices(serviceRows);
    setAppointments(appointmentRows);
    setClients(clientRows);
    setPortfolioItems(portfolioRows);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setError("Falta configurar la URL y la clave pública de Supabase en apps/provider/.env.");
      setLoading(false);
      return;
    }
    void refresh().catch(e => setError(e instanceof Error ? e.message : "No se pudo conectar con Supabase."))
      .finally(() => setLoading(false));
    return onAuthStateChange(() => {
      void refresh().catch(e => setError(e instanceof Error ? e.message : "No se pudo actualizar la cuenta."));
    });
  }, [refresh]);

  const filteredAppointments = useMemo(() => appointments.filter(a => a.starts_at.slice(0, 10) === day), [appointments, day]);
  const activeServices = services.filter(s => s.is_active);
  const pendingCount = appointments.filter(a => a.status === "pending_confirmation").length;

  const createProfile = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await createMyProviderProfile(businessName, bio);
      setProfile(created);
      setNotice("Estudio registrado. Añade servicios para completar tu catálogo.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar el estudio."); }
    finally { setBusy(false); }
  };

  const createPortfolioPost = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    let itemId = editingWorkId;
    try {
      const old = editingWorkId ? portfolioItems.find(item => item.id === editingWorkId) : undefined;
      if (workPhotos.length + (old?.image_paths.length ?? 0) > 6) throw new Error("Cada publicación admite un máximo de 6 fotos en total.");
      if (!old && workPhotos.length === 0) throw new Error("Añade al menos una foto del trabajo terminado.");
      if (!itemId) itemId = await savePortfolioItem({ providerId: profile.id, title: workTitle, description: workDescription, category: workCategory, imagePaths: [], isPublished: true });
      const paths = [...(old?.image_paths ?? [])];
      for (const file of workPhotos) {
        const blob = await compressPortfolioImage(file);
        const hash = crypto.randomUUID().replace(/-/g, "");
        const path = profile.id + "/" + itemId + "/" + hash + "-work.webp";
        const { error: uploadError } = await getSupabaseClient().storage.from("service-images").upload(path, blob, { upsert: false, contentType: "image/webp" });
        if (uploadError) throw new Error("No se pudo subir una foto: " + uploadError.message);
        paths.push(path);
      }
      await savePortfolioItem({ providerId: profile.id, id: itemId, title: workTitle, description: workDescription, category: workCategory, imagePaths: paths, isPublished: true });
      setShowWorkForm(false); setEditingWorkId(null); setWorkTitle(""); setWorkDescription(""); setWorkCategory("Diseños"); setWorkPhotos([]);
      await refresh();
      setNotice("Trabajo publicado en tu portafolio.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo publicar el trabajo."); }
    finally { setBusy(false); }
  };

  const createService = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const price = Number(servicePrice.replace(",", "."));
      const duration = Number(serviceDuration);
      if (!Number.isFinite(price) || price < 0) throw new Error("Escribe un precio válido.");
      if (servicePhoto && !/^image\/(jpeg|png|webp)$/.test(servicePhoto.type)) throw new Error("La foto debe ser JPG, PNG o WebP.");
      if (servicePhoto && servicePhoto.size > 8 * 1024 * 1024) throw new Error("La foto no puede superar 8 MB.");
      const serviceId = await saveProviderService({
        providerId: profile.id,
        ...(editingServiceId ? { id: editingServiceId } : {}),
        name: serviceName,
        description: serviceDescription,
        priceCents: Math.round(price * 100),
        currency: "CUP",
        durationMinutes: duration,
      });
      setEditingServiceId(serviceId);
      if (servicePhoto) {
        const compressed = await compressPortfolioImage(servicePhoto);
        const path = profile.id + "/" + serviceId + "/" + crypto.randomUUID().replace(/-/g, "") + "-service.webp";
        const { error: uploadError } = await getSupabaseClient().storage.from("service-images")
          .upload(path, compressed, { upsert: false, contentType: "image/webp" });
        if (uploadError) throw new Error("No se pudo subir la foto: " + uploadError.message);
        await setProviderServicePhoto(profile.id, serviceId, path);
      }
      setShowServiceForm(false); setEditingServiceId(null); setServiceName(""); setServiceDescription(""); setServicePhoto(null);
      await refresh();
      setNotice("Servicio guardado o actualizado.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el servicio."); }
    finally { setBusy(false); }
  };

  const changeAppointment = async (appointmentId: string, status: "confirmed" | "rejected" | "completed") => {
    setBusy(true); setError(""); setNotice("");
    try {
      await setProviderAppointmentStatus(appointmentId, status);
      await refresh();
      setNotice("Estado de la cita actualizado.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar la cita."); }
    finally { setBusy(false); }
  };

  const publishProfile = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { getSupabaseClient } = await import("@lumi/api");
      const { error: updateError } = await getSupabaseClient()
        .from("provider_profiles")
        .update({ is_published: !profile.is_published, business_name: profile.business_name, bio: profile.bio })
        .eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);
      await refresh();
      setNotice(profile.is_published ? "Reservas pausadas. Tu enlace personal sigue disponible." : "Reservas activadas para las clientas que estén vinculadas por invitación.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cambiar la publicación."); }
    finally { setBusy(false); }
  };

  const createInvite = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const invite = await createProviderInvite(profile.id);
      // Las apps se distribuyen como APK: no dependemos de una web pública.
      setInviteLink(invite.token);
      setInviteExpiresAt(invite.expires_at);
      setNotice("Código de invitación creado. Compártelo por WhatsApp o muéstralo a la clienta.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la invitación."); }
    finally { setBusy(false); }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(inviteLink);
      else window.prompt("Copia este código de invitación:", inviteLink);
      setNotice("Código listo para compartir.");
    } catch { window.prompt("Copia este código de invitación:", inviteLink); }
  };

  const shareInviteLink = async () => {
    if (!inviteLink) return;
    try {
      if (navigator.share) await navigator.share({
        title: "Invitación a " + (profile?.business_name || "Luni"),
        text: "Añádeme a tus manicuristas en Luni. Abre Luni Cliente, entra en «Mis manicuristas» e introduce este código: " + inviteLink
      });
      else await copyInviteLink();
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError("No se pudo abrir el menú para compartir. Copia el enlace.");
    }
  };

  const showMobileNav = Boolean(sessionEmail && profile);

  return <main className={"provider-shell" + (showMobileNav ? " has-mobile-nav" : "")}>
    <aside className="provider-sidebar"><div className="provider-brand"><div className="provider-mark">l<span>✦</span></div><div><b>luni</b><small>STUDIO</small></div></div><div className="studio-switch"><div className="studio-avatar">{profile?.business_name?.[0]?.toUpperCase() ?? "♡"}</div><div><b>{profile?.business_name ?? "Mi estudio"}</b><small>{sessionEmail || "Espacio de belleza"}</small></div><span>⌄</span></div><div className="side-label">ESPACIO DE TRABAJO</div><nav className="side-nav"><button className={tab==="agenda"?"selected":""} onClick={()=>setTab("agenda")}><span>▦</span> Agenda</button><button className={tab==="servicios"?"selected":""} onClick={()=>setTab("servicios")}><span>✧</span> Mis servicios</button><button className={tab==="trabajos"?"selected":""} onClick={()=>setTab("trabajos")}><span>▧</span> Trabajos terminados</button><button className={tab==="clientes"?"selected":""} onClick={()=>setTab("clientes")}><span>♙</span> Clientas</button><button className={tab==="perfil"?"selected":""} onClick={()=>setTab("perfil")}><span>⚙</span> Mi negocio</button></nav><div className="sidebar-bottom"><div className="help-mark">♡</div><b>Un espacio para crecer</b><p>Organiza tu tiempo. Cuida cada detalle.</p>{profile && <span className="trial-pill">LICENCIA: {profile.license_status.toUpperCase()}</span>}<div className="user-mini"><div className="studio-avatar">{sessionEmail ? sessionEmail[0].toUpperCase() : "♡"}</div><div><b>{sessionEmail || "Sin sesión"}</b><small>Mi cuenta</small></div><span>···</span></div></div></aside>
    <section className="provider-main"><header className="provider-header"><div className="mobile-brand"><div className="provider-mark">l<span>✦</span></div><b>luni studio</b></div><div className="breadcrumb">Mi estudio <span>/</span> <b>{tab==="agenda"?"Agenda":tab==="servicios"?"Mis servicios":tab==="clientes"?"Clientas":"Mi negocio"}</b></div><div className="header-actions"><span className="connection-dot" style={{background:loading?"#c3a56c":error?"#c65c5c":"#79a77a"}}></span><span className="connection-label">{loading ? "Conectando…" : error ? "Revisar conexión" : sessionEmail ? "Conectado a Supabase" : "Inicia sesión"}</span><button className="header-avatar" onClick={()=>setTab("perfil")}>{sessionEmail ? sessionEmail[0].toUpperCase() : "A"}</button></div></header>
      {(error || notice) && <div role={error ? "alert" : "status"} className="provider-notice">{error || notice}<button onClick={()=>{setError("");setNotice("");}}>×</button></div>}
      {!sessionEmail ? <div className="workspace"><span className="eyebrow">BIENVENIDA A LUNI STUDIO</span><h1>Tu negocio, <em>en buenas manos.</em></h1><AuthPanel onError={setError} onNotice={setNotice} onSignedIn={() => refresh()} /></div>
      : !profile ? <div className="workspace"><span className="eyebrow">PRIMER PASO</span><h1>Registra tu <em>estudio.</em></h1><p className="setup-description">Completa los datos básicos para empezar a administrar tus servicios.</p><div className="settings-card provider-setup-card"><label>Nombre del estudio<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Ej. Studio Ana"/></label><label>Descripción breve<textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Qué servicios ofreces y qué te distingue"/></label><button className="provider-primary" disabled={busy||!businessName.trim()} onClick={()=>void createProfile()}>{busy?"Guardando…":"Registrar estudio"}</button></div></div>
      : <>
        {tab==="agenda" && <div className="workspace"><div className="welcome-row"><div><span className="eyebrow">TU AGENDA REAL</span><h1>Tu día, <em>a tu manera.</em></h1><p>Las citas se cargan desde tu cuenta de Luni.</p></div><label className="date-filter">Fecha<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label></div>
          <div className="metric-grid"><article className="metric-card"><span>CITAS DEL DÍA</span><div><b>{filteredAppointments.length}</b><i>▦</i></div><small>En la agenda</small></article><article className="metric-card"><span>INGRESOS PREVISTOS</span><div><b>{money(filteredAppointments.filter(a=>a.status==="confirmed"||a.status==="pending_confirmation").reduce((sum,a)=>sum+a.client_price_cents,0))}</b><i>♧</i></div><small>Confirmadas y pendientes</small></article><article className="metric-card"><span>POR CONFIRMAR</span><div><b>{filteredAppointments.filter(a=>a.status==="pending_confirmation").length}</b><i>◷</i></div><small>Requieren seguimiento</small></article></div>
          <section className="agenda-panel"><div className="agenda-heading"><div><h2>Agenda</h2><p>{profile.business_name}</p></div><button className="today-button" onClick={()=>setDay(new Date().toISOString().slice(0,10))}>Hoy ↗</button></div><div className="agenda-date"><b>{new Date(day+"T12:00:00").toLocaleDateString("es-CU",{weekday:"long",day:"numeric",month:"long"})}</b><span>{filteredAppointments.length} citas</span></div><div className="appointment-list">{filteredAppointments.map(a=><article className="provider-appointment" key={a.id}><div className="appointment-time"><b>{new Date(a.starts_at).toLocaleTimeString("es-CU",{hour:"2-digit",minute:"2-digit"})}</b><span>{Math.max(1,Math.round((Date.parse(a.ends_at)-Date.parse(a.starts_at))/60000))} min</span></div><div className={"appointment-color "+(a.status==="confirmed"?"pink":a.status==="pending_confirmation"?"sand":"lilac")}></div><div className="appointment-details"><b>{a.client_service_name}</b><small>{a.client_display_name || "Clienta"} · {a.client_phone ? <a href={"tel:" + a.client_phone}>{a.client_phone}</a> : "Sin teléfono registrado"}</small><span>{money(a.client_price_cents,a.client_currency)} · {statusText[a.status] ?? a.status}</span><small>{a.notes || "Sin notas"}</small></div><div className="appointment-actions">{a.status==="pending_confirmation"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"confirmed")}>Confirmar</button><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"rejected")}>Rechazar</button></>}{a.status==="confirmed"&&<button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"completed")}>Completar</button>}</div></article>)}{filteredAppointments.length===0&&<div className="provider-empty"><span>✧</span><b>Tu agenda está despejada</b><p>No hay citas registradas para esta fecha.</p></div>}</div></section>
        </div>}
        {tab==="servicios"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">LO QUE HACES MEJOR</span><h1>Mis <em>servicios.</em></h1><p>Los cambios se guardan en Supabase.</p></div><button className="provider-primary" onClick={()=>setShowServiceForm(true)}>＋ Añadir servicio</button></div><div className="provider-service-grid">{services.map((s,i)=><article className={"provider-service-card "+(!s.is_active?"service-inactive":"")} key={s.id}>{s.thumb_path ? <img className="provider-service-photo" src={getSupabaseClient().storage.from("service-images").getPublicUrl(s.thumb_path).data.publicUrl} alt={"Foto de "+s.name} loading="lazy"/> : <div className={"provider-service-art art-"+(i%3)}>{["✿","✧","❀"][i%3]}<span>{String(i+1).padStart(2,"0")}</span></div>}<div className="provider-service-content"><h3>{s.name}</h3><p>{s.description}</p><div><span>◷ {s.duration_minutes} min</span><b>{money(s.price_cents,s.currency)}</b></div><span className="service-saved-label">{s.is_active?"Visible en el catálogo":"Servicio pausado"}</span><div className="service-actions"><button className="provider-secondary" onClick={()=>{setEditingServiceId(s.id);setServiceName(s.name);setServiceDescription(s.description);setServicePrice(String(s.price_cents/100));setServiceDuration(String(s.duration_minutes));setServicePhoto(null);setShowServiceForm(true);}}>Editar</button><button className="provider-secondary" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await setProviderServiceActive(profile.id,s.id,!s.is_active);await refresh();setNotice(s.is_active?"Servicio pausado; se conserva en el historial.":"Servicio publicado en el catálogo.");}catch(e){setError(e instanceof Error?e.message:"No se pudo cambiar el estado.");}finally{setBusy(false);}}}>{s.is_active?"Pausar":"Activar"}</button></div></div></article>)}</div>{services.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes servicios</b><p>Añade tu primer servicio para completar el catálogo del estudio.</p><button className="provider-primary" onClick={()=>setShowServiceForm(true)}>Añadir servicio</button></div>}</div>}
        {tab==="trabajos"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">TU GALERÍA PÚBLICA</span><h1>Mis trabajos <em>terminados.</em></h1><p>Publica fotos reales de tus uñas para que futuras clientas conozcan tu estilo. Las imágenes se comprimen y se guardan en Supabase Storage.</p></div><button className="provider-primary" onClick={()=>{setEditingWorkId(null);setWorkTitle("");setWorkDescription("");setWorkCategory("Diseños");setWorkPhotos([]);setShowWorkForm(true);}}>＋ Publicar trabajo</button></div><div className="portfolio-work-grid">{portfolioItems.map(item=><article className="portfolio-work-card" key={item.id}><div className="portfolio-work-images">{item.image_paths.slice(0,3).map(path=><img key={path} src={getSupabaseClient().storage.from("service-images").getPublicUrl(path).data.publicUrl} alt={item.title||"Trabajo de uñas"} loading="lazy"/>)}</div><div className="portfolio-work-body"><span className="portfolio-work-category">{item.category}</span><h3>{item.title||item.category}</h3><p>{item.description||"Trabajo terminado publicado en tu galería."}</p><small>{item.image_paths.length} {item.image_paths.length===1?"foto":"fotos"} · {item.is_published?"Visible públicamente":"Oculto"}</small><div className="service-actions"><button className="provider-secondary" onClick={()=>{setEditingWorkId(item.id);setWorkTitle(item.title);setWorkDescription(item.description);setWorkCategory(item.category);setWorkPhotos([]);setShowWorkForm(true);}}>Editar</button><button className="provider-secondary" disabled={busy} onClick={async()=>{if(!window.confirm("¿Eliminar esta publicación de tu portafolio?"))return;setBusy(true);setError("");try{await deletePortfolioItem(profile.id,item.id);await refresh();setNotice("Publicación eliminada de la galería.");}catch(e){setError(e instanceof Error?e.message:"No se pudo eliminar el trabajo.");}finally{setBusy(false);}}}>Eliminar</button></div></div></article>)}</div>{portfolioItems.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Tu galería empieza aquí</b><p>Publica tu primer trabajo terminado con hasta 6 fotos.</p><button className="provider-primary" onClick={()=>setShowWorkForm(true)}>Publicar primer trabajo</button></div>}</div>}
        {tab==="clientes"&&<div className="workspace">
          <div className="welcome-row"><div><span className="eyebrow">CARTERA PRIVADA</span><h1>Tus <em>clientas.</em></h1><p>Cada clienta entra por tu invitación personal. Tu cartera es independiente de la de otras manicuristas.</p></div><button className="provider-primary" disabled={busy||!profile} onClick={()=>void createInvite()}>＋ Crear invitación</button></div>
          {inviteLink&&<section className="invite-share-card"><span className="eyebrow">CÓDIGO PERSONAL · VÁLIDO HASTA {new Date(inviteExpiresAt).toLocaleDateString("es-CU")}</span><h2>Invita a una nueva clienta</h2><p>Comparte este código por WhatsApp o muéstralo en persona. La clienta lo introduce dentro de Luni Cliente; no hace falta publicar la aplicación en Internet.</p><div className="invite-link-row"><input aria-label="Código de invitación" readOnly value={inviteLink}/><button className="provider-secondary" onClick={()=>void copyInviteLink()}>Copiar código</button></div><div className="invite-share-actions"><button className="provider-primary" onClick={()=>void shareInviteLink()}>Compartir invitación ↗</button><button className="provider-secondary" onClick={()=>setInviteLink("")}>Ocultar código</button></div></section>}
          <div className="client-portfolio-summary"><b>{clients.length}</b><span>{clients.length===1?"clienta conectada":"clientas conectadas"}</span><small>La información de cada clienta solo es visible para tu estudio.</small></div>
          {clients.length===0?<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes clientas vinculadas</b><p>Crea un código y compártelo por WhatsApp o muéstralo a la clienta para que lo introduzca en Luni Cliente. No existe un directorio público de clientas ni de estudios.</p><button className="provider-primary" disabled={busy||!profile} onClick={()=>void createInvite()}>Crear mi primer código</button></div>
          :<div className="client-portfolio-list">{clients.map(client=><article className="client-portfolio-card" key={client.client_id}><div className="client-portfolio-avatar">{(client.display_name||"C").trim()[0]?.toUpperCase()}</div><div className="client-portfolio-main"><h3>{client.display_name||"Clienta de Luni"}</h3><p>{client.phone?<a href={"tel:"+client.phone}>{client.phone}</a>:"Sin teléfono registrado"}</p><small>Conectada desde {new Date(client.linked_at).toLocaleDateString("es-CU")}</small></div><div className="client-portfolio-stats"><b>{client.appointment_count}</b><span>{client.appointment_count===1?"cita":"citas"}</span><small>{client.last_appointment_at?"Última: "+new Date(client.last_appointment_at).toLocaleDateString("es-CU"):"Sin citas todavía"}</small></div></article>)}</div>}
        </div>}
        {tab==="perfil"&&<div className="workspace"><span className="eyebrow">TU MARCA, TUS REGLAS</span><h1>Mi <em>negocio.</em></h1><div className="settings-card"><div className="settings-avatar">{profile.business_name[0]?.toUpperCase()}</div><div><h3>{profile.business_name}</h3><p>{profile.bio || "Sin descripción todavía."}</p><p>Prueba iniciada: {new Date(profile.trial_started_at).toLocaleDateString("es-CU")} · Estado: {profile.license_status}</p></div><span className="trial-pill">{profile.is_published?"RESERVAS ACTIVAS":"RESERVAS PAUSADAS"}</span></div><div className="settings-card"><div className="settings-icon">↗</div><div><h3>Reservas por invitación</h3><p>{profile.is_published?"Tu estudio puede aceptar reservas de clientas vinculadas por invitación.":"Activa las reservas cuando tengas servicios y horarios listos. Tu estudio no aparecerá en un directorio público."}</p></div><button className="provider-secondary" disabled={busy||activeServices.length===0&&!profile.is_published} onClick={()=>void publishProfile()}>{profile.is_published?"Pausar reservas":"Activar reservas"}</button></div><ManualTurnsEditor providerId={profile.id} appointments={appointments} timezone={profile.timezone || "America/Havana"} /><ScheduleEditor providerId={profile.id} appointments={appointments} timezone={profile.timezone || "America/Havana"} legacyScheduleHidden /><div className="settings-card"><div className="settings-icon">⌁</div><div><h3>Cuenta</h3><p>{sessionEmail}</p></div><button className="provider-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await signOut();setProfile(null);setServices([]);setAppointments([]);setSessionEmail("");setNotice("Sesión cerrada.");}catch(e){setError(e instanceof Error?e.message:"No se pudo cerrar sesión.");}finally{setBusy(false);}}}>Cerrar sesión</button></div></div>}
      </>}
      <footer className="provider-footer"><span>luni studio</span><span>Hecho con cuidado, para quienes cuidan. ♡</span></footer>
    </section>
    {showMobileNav && <nav className="mobile-nav" aria-label="Navegación principal">
      {([["agenda", "Agenda", "▦"], ["servicios", "Servicios", "✧"], ["clientes", "Clientas", "♙"], ["perfil", "Negocio", "⚙"]] as const).map(([id, label, icon]) =>
        <button key={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
    </nav>}
    {showWorkForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-work-title"><button className="modal-close" onClick={()=>{setShowWorkForm(false);setEditingWorkId(null);setWorkPhotos([]);}} aria-label="Cerrar">×</button><span className="eyebrow">PORTAFOLIO DE TRABAJOS</span><h2 id="portfolio-work-title">{editingWorkId?"Editar":"Publicar"} <em>trabajo terminado.</em></h2><label>Título (opcional)<input maxLength={120} value={workTitle} onChange={e=>setWorkTitle(e.target.value)} placeholder="Ej. Francesa con detalles dorados"/></label><label>Categoría<select value={workCategory} onChange={e=>setWorkCategory(e.target.value)}><option>Diseños</option><option>Acrílicas</option><option>Semipermanente</option><option>Manicura</option><option>Pedicura</option><option>Gel</option><option>Novias y eventos</option><option>Otros</option></select></label><label>Descripción<textarea maxLength={1000} value={workDescription} onChange={e=>setWorkDescription(e.target.value)} placeholder="Cuenta qué técnica o diseño realizaste"/></label><label>Fotos (hasta 6 en total; JPG, PNG o WebP)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setWorkPhotos(Array.from(e.target.files??[]).slice(0,6))}/></label><p>{workPhotos.length} foto(s) nuevas seleccionadas. Se convierten a WebP y se comprimen para respetar el límite de 512 KB por archivo.</p><button className="provider-primary full-provider-button" disabled={busy||(!editingWorkId&&workPhotos.length===0)} onClick={()=>void createPortfolioPost()}>{busy?"Publicando…":editingWorkId?"Guardar cambios":"Publicar trabajo"}</button></section></div>}
    {showServiceForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="new-service-title"><button className="modal-close" onClick={()=>{setShowServiceForm(false);setEditingServiceId(null);setServicePhoto(null);}} aria-label="Cerrar">×</button><span className="eyebrow">AMPLÍA TU CATÁLOGO</span><h2 id="new-service-title">{editingServiceId?"Editar":"Nuevo"} <em>servicio.</em></h2><label>Nombre del servicio<input value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="Ej. Manicura clásica" required/></label><label>Descripción<textarea value={serviceDescription} onChange={e=>setServiceDescription(e.target.value)} placeholder="Describe brevemente el servicio"/></label><label>Precio (CUP)<input inputMode="decimal" value={servicePrice} onChange={e=>setServicePrice(e.target.value)} /></label><label>Duración en minutos<input type="number" min="1" max="1440" value={serviceDuration} onChange={e=>setServiceDuration(e.target.value)} /></label><label>Fotografía del trabajo (JPG, PNG o WebP, máximo 8 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setServicePhoto(e.target.files?.[0]??null)}/></label><p>La foto es opcional. El precio se guarda en centavos; 800 CUP se almacena como 80000.</p><button className="provider-primary full-provider-button" disabled={busy||!serviceName.trim()} onClick={()=>void createService()}>{busy?"Guardando…":editingServiceId?"Guardar cambios":"Guardar servicio"}</button></section></div>}
  </main>;
}
