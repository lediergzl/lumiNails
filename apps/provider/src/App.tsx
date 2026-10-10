import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import ScheduleEditor from "./ScheduleEditor";
import ManualTurnsEditor from "./ManualTurnsEditor";
import { processImageLocally, type ProcessedImageSet } from "@lumi/image-processor";
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
  deleteProviderService,
  setServiceImage,
  clearServiceImage,
  serviceImageUrl,
  setProviderAppointmentStatus,
  signOut,
  type ProviderAppointment,
  type ProviderProfile,
  type ProviderService,
  type ProviderClient,
} from "@lumi/api";

type Tab = "agenda" | "servicios" | "clientes" | "perfil";
const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
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
  const [deleteTarget, setDeleteTarget] = useState<ProviderService | null>(null);
  const [reasonTarget, setReasonTarget] = useState<{ id: string; status: "rejected" | "cancelled" } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [photo, setPhoto] = useState<{ set: ProcessedImageSet; previewUrl: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoInfo, setPhotoInfo] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [savedPhotoPath, setSavedPhotoPath] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("800");
  const [serviceDuration, setServiceDuration] = useState("45");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));

  const refresh = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    if (!session) {
      setProfile(null); setServices([]); setAppointments([]); setClients([]); setInviteLink("");
      return;
    }
    const currentProfile = await getMyProviderProfile();
    setProfile(currentProfile);
    if (!currentProfile) {
      setServices([]); setAppointments([]); setClients([]);
      return;
    }
    const [serviceRows, appointmentRows, clientRows] = await Promise.all([
      listMyProviderServices(currentProfile.id),
      listProviderAppointments(currentProfile.id),
      listProviderClients(currentProfile.id),
    ]);
    setServices(serviceRows);
    setAppointments(appointmentRows);
    setClients(clientRows);
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

  const createService = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const price = Number(servicePrice.replace(",", "."));
      const duration = Number(serviceDuration);
      if (!Number.isFinite(price) || price < 0) throw new Error("Escribe un precio válido.");
      const serviceId = await saveProviderService({
        providerId: profile.id,
        id: editingServiceId ?? undefined,
        name: serviceName,
        description: serviceDescription,
        priceCents: Math.round(price * 100),
        currency: "CUP",
        durationMinutes: duration,
      });
      // El servicio ya está guardado; la foto va después para que una conexión lenta nunca pierda los datos.
      let photoProblem = "";
      try {
        if (photo) await setServiceImage(profile.id, serviceId, photo.set, p => setPhotoInfo(`Subiendo foto (${Math.min(p.done + 1, p.total)} de ${p.total})…`));
        else if (removePhoto) await clearServiceImage(profile.id, serviceId);
      } catch (e) { photoProblem = e instanceof Error ? e.message : "No se pudo subir la foto."; }
      setShowServiceForm(false); setEditingServiceId(null); setServiceName(""); setServiceDescription(""); resetPhoto();
      await refresh();
      if (photoProblem) setNotice(`Servicio guardado, pero la foto no se subió: ${photoProblem} Ábrelo con «Editar» para reintentar.`);
      else setNotice("Servicio guardado.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el servicio."); }
    finally { setBusy(false); }
  };

  const resetPhoto = () => {
    setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.previewUrl); return null; });
    setPhotoInfo(""); setPhotoError(""); setRemovePhoto(false);
  };

  const kb = (bytes: number) => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoError(""); setPhotoInfo("");
    try {
      const set = await processImageLocally(file);
      const card = set.variants.find(v => v.variant === "card") ?? set.variants[0];
      setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.previewUrl); return { set, previewUrl: URL.createObjectURL(card.file) }; });
      setRemovePhoto(false);
      setPhotoInfo(`Lista para subir: ${kb(set.totalBytes)} (la original pesa ${kb(set.originalBytes)}).`);
    } catch (e) { setPhotoError(e instanceof Error ? e.message : "No se pudo preparar la foto."); }
    finally { setPhotoBusy(false); }
  };

  const openNewService = () => {
    resetPhoto(); setSavedPhotoPath(null);
    setEditingServiceId(null); setServiceName(""); setServiceDescription("");
    setServicePrice("800"); setServiceDuration("45"); setShowServiceForm(true);
  };

  const openEditService = (s: ProviderService) => {
    resetPhoto(); setSavedPhotoPath(s.card_path);
    setEditingServiceId(s.id); setServiceName(s.name); setServiceDescription(s.description);
    setServicePrice(String(s.price_cents / 100)); setServiceDuration(String(s.duration_minutes));
    setShowServiceForm(true);
  };

  const removeService = async () => {
    if (!profile || !deleteTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await deleteProviderService(profile.id, deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
      setNotice("Servicio eliminado. Las citas ya reservadas no cambian.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar el servicio."); }
    finally { setBusy(false); }
  };

  const changeAppointment = async (appointmentId: string, status: "confirmed" | "rejected" | "completed" | "cancelled", reason = "") => {
    setBusy(true); setError(""); setNotice("");
    try {
      await setProviderAppointmentStatus(appointmentId, status, reason);
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
    <aside className="provider-sidebar"><div className="provider-brand"><div className="provider-mark">l<span>✦</span></div><div><b>luni</b><small>STUDIO</small></div></div><div className="studio-switch"><div className="studio-avatar">{profile?.business_name?.[0]?.toUpperCase() ?? "♡"}</div><div><b>{profile?.business_name ?? "Mi estudio"}</b><small>{sessionEmail || "Espacio de belleza"}</small></div><span>⌄</span></div><div className="side-label">ESPACIO DE TRABAJO</div><nav className="side-nav"><button className={tab==="agenda"?"selected":""} onClick={()=>setTab("agenda")}><span>▦</span> Agenda</button><button className={tab==="servicios"?"selected":""} onClick={()=>setTab("servicios")}><span>✧</span> Mis servicios</button><button className={tab==="clientes"?"selected":""} onClick={()=>setTab("clientes")}><span>♙</span> Clientas</button><button className={tab==="perfil"?"selected":""} onClick={()=>setTab("perfil")}><span>⚙</span> Mi negocio</button></nav><div className="sidebar-bottom"><div className="help-mark">♡</div><b>Un espacio para crecer</b><p>Organiza tu tiempo. Cuida cada detalle.</p>{profile && <span className="trial-pill">LICENCIA: {profile.license_status.toUpperCase()}</span>}<div className="user-mini"><div className="studio-avatar">{sessionEmail ? sessionEmail[0].toUpperCase() : "♡"}</div><div><b>{sessionEmail || "Sin sesión"}</b><small>Mi cuenta</small></div><span>···</span></div></div></aside>
    <section className="provider-main"><header className="provider-header"><div className="mobile-brand"><div className="provider-mark">l<span>✦</span></div><b>luni studio</b></div><div className="breadcrumb">Mi estudio <span>/</span> <b>{tab==="agenda"?"Agenda":tab==="servicios"?"Mis servicios":tab==="clientes"?"Clientas":"Mi negocio"}</b></div><div className="header-actions"><span className="connection-dot" style={{background:loading?"#c3a56c":error?"#c65c5c":"#79a77a"}}></span><span className="connection-label">{loading ? "Conectando…" : error ? "Revisar conexión" : sessionEmail ? "Conectado a Supabase" : "Inicia sesión"}</span><button className="header-avatar" onClick={()=>setTab("perfil")}>{sessionEmail ? sessionEmail[0].toUpperCase() : "A"}</button></div></header>
      {(error || notice) && <div role={error ? "alert" : "status"} className="provider-notice">{error || notice}<button onClick={()=>{setError("");setNotice("");}}>×</button></div>}
      {!sessionEmail ? <div className="workspace"><span className="eyebrow">BIENVENIDA A LUNI STUDIO</span><h1>Tu negocio, <em>en buenas manos.</em></h1><AuthPanel onError={setError} onNotice={setNotice} onSignedIn={() => refresh()} /></div>
      : !profile ? <div className="workspace"><span className="eyebrow">PRIMER PASO</span><h1>Registra tu <em>estudio.</em></h1><p className="setup-description">Completa los datos básicos para empezar a administrar tus servicios.</p><div className="settings-card provider-setup-card"><label>Nombre del estudio<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Ej. Studio Ana"/></label><label>Descripción breve<textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Qué servicios ofreces y qué te distingue"/></label><button className="provider-primary" disabled={busy||!businessName.trim()} onClick={()=>void createProfile()}>{busy?"Guardando…":"Registrar estudio"}</button></div></div>
      : <>
        {tab==="agenda" && <div className="workspace"><div className="welcome-row"><div><span className="eyebrow">TU AGENDA REAL</span><h1>Tu día, <em>a tu manera.</em></h1><p>Las citas se cargan desde tu cuenta de Luni.</p></div><label className="date-filter">Fecha<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label></div>
          <div className="metric-grid"><article className="metric-card"><span>CITAS DEL DÍA</span><div><b>{filteredAppointments.length}</b><i>▦</i></div><small>En la agenda</small></article><article className="metric-card"><span>INGRESOS PREVISTOS</span><div><b>{money(filteredAppointments.filter(a=>a.status==="confirmed"||a.status==="pending_confirmation").reduce((sum,a)=>sum+a.client_price_cents,0))}</b><i>♧</i></div><small>Confirmadas y pendientes</small></article><article className="metric-card"><span>POR CONFIRMAR</span><div><b>{filteredAppointments.filter(a=>a.status==="pending_confirmation").length}</b><i>◷</i></div><small>Requieren seguimiento</small></article></div>
          <section className="agenda-panel"><div className="agenda-heading"><div><h2>Agenda</h2><p>{profile.business_name}</p></div><button className="today-button" onClick={()=>setDay(new Date().toISOString().slice(0,10))}>Hoy ↗</button></div><div className="agenda-date"><b>{new Date(day+"T12:00:00").toLocaleDateString("es-CU",{weekday:"long",day:"numeric",month:"long"})}</b><span>{filteredAppointments.length} citas</span></div><div className="appointment-list">{filteredAppointments.map(a=><article className="provider-appointment" key={a.id}><div className="appointment-time"><b>{new Date(a.starts_at).toLocaleTimeString("es-CU",{hour:"2-digit",minute:"2-digit"})}</b><span>{Math.max(1,Math.round((Date.parse(a.ends_at)-Date.parse(a.starts_at))/60000))} min</span></div><div className={"appointment-color "+(a.status==="confirmed"?"pink":a.status==="pending_confirmation"?"sand":"lilac")}></div><div className="appointment-details"><b>{a.client_service_name}</b><small>{a.client_display_name || "Clienta"} · {a.client_phone ? <a href={"tel:" + a.client_phone}>{a.client_phone}</a> : "Sin teléfono registrado"}</small><span>{money(a.client_price_cents,a.client_currency)} · {statusText[a.status] ?? a.status}</span><small>{a.notes || "Sin notas"}</small></div><div className="appointment-actions">{a.status==="pending_confirmation"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"confirmed")}>Confirmar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"rejected"});}}>Rechazar</button></>}{a.status==="confirmed"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"completed")}>Completar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"cancelled"});}}>Cancelar</button></>}</div></article>)}{filteredAppointments.length===0&&<div className="provider-empty"><span>✧</span><b>Tu agenda está despejada</b><p>No hay citas registradas para esta fecha.</p></div>}</div></section>
        </div>}
        {tab==="servicios"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">LO QUE HACES MEJOR</span><h1>Mis <em>servicios.</em></h1><p>Los cambios se guardan en Supabase.</p></div><button className="provider-primary" onClick={openNewService}>＋ Añadir servicio</button></div><div className="provider-service-grid">{activeServices.map((s,i)=><article className="provider-service-card" key={s.id}><div className={"provider-service-art art-"+(i%3)}>{s.card_path?<img className="service-photo" src={serviceImageUrl(s.card_path)??""} alt="" loading="lazy" decoding="async" onLoad={e=>e.currentTarget.classList.add("loaded")}/>:["✿","✧","❀"][i%3]}<span>{String(i+1).padStart(2,"0")}</span></div><div className="provider-service-content"><h3>{s.name}</h3><p>{s.description}</p><div><span>◷ {s.duration_minutes} min</span><b>{money(s.price_cents,s.currency)}</b></div><div className="appointment-actions"><button className="provider-secondary" disabled={busy} onClick={()=>openEditService(s)}>Editar</button><button className="provider-secondary" disabled={busy} onClick={()=>setDeleteTarget(s)}>Eliminar</button></div></div></article>)}</div>{activeServices.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes servicios</b><p>Añade tu primer servicio para completar el catálogo del estudio.</p><button className="provider-primary" onClick={openNewService}>Añadir servicio</button></div>}</div>}
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
    {deleteTarget&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="delete-service-title"><button className="modal-close" onClick={()=>setDeleteTarget(null)} aria-label="Cerrar">×</button><span className="eyebrow">ELIMINAR SERVICIO</span><h2 id="delete-service-title">¿Eliminar <em>{deleteTarget.name}</em>?</h2><p>Dejará de mostrarse a tus clientas. Las citas ya reservadas conservan su nombre y precio.</p><button className="provider-primary full-provider-button" disabled={busy} onClick={()=>void removeService()}>{busy?"Eliminando…":"Sí, eliminar"}</button><button className="provider-secondary full-provider-button" disabled={busy} onClick={()=>setDeleteTarget(null)}>No, conservar</button></section></div>}
    {reasonTarget&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="reason-title"><button className="modal-close" onClick={()=>setReasonTarget(null)} aria-label="Cerrar">×</button><span className="eyebrow">{reasonTarget.status==="rejected"?"RECHAZAR CITA":"CANCELAR CITA"}</span><h2 id="reason-title">Avisa a la <em>clienta.</em></h2><label>Motivo (opcional)<input value={reasonText} maxLength={200} onChange={e=>setReasonText(e.target.value)} placeholder="Ej. Ese día no podré atender"/></label><button className="provider-primary full-provider-button" disabled={busy} onClick={async()=>{const t=reasonTarget;setReasonTarget(null);await changeAppointment(t.id,t.status,reasonText);}}>{reasonTarget.status==="rejected"?"Rechazar cita":"Cancelar cita"}</button></section></div>}
    {showServiceForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="new-service-title"><button className="modal-close" onClick={()=>setShowServiceForm(false)} aria-label="Cerrar">×</button><span className="eyebrow">{editingServiceId?"AJUSTA TU CATÁLOGO":"AMPLÍA TU CATÁLOGO"}</span><h2 id="new-service-title">{editingServiceId?<>Editar <em>servicio.</em></>:<>Nuevo <em>servicio.</em></>}</h2><label>Nombre del servicio<input value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="Ej. Manicura clásica"/></label><label>Descripción<input value={serviceDescription} onChange={e=>setServiceDescription(e.target.value)} placeholder="Describe brevemente el servicio"/></label><div className="photo-field"><span>Foto del servicio</span>{(photo||(savedPhotoPath&&!removePhoto))?<img className="photo-preview" src={photo?.previewUrl??serviceImageUrl(savedPhotoPath)??""} alt="Foto del servicio"/>:<div className="photo-empty">Sin foto</div>}<div className="photo-actions"><label className="provider-secondary photo-pick">{(photo||(savedPhotoPath&&!removePhoto))?"Cambiar foto":"Añadir foto"}<input type="file" accept="image/*" hidden disabled={busy||photoBusy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";void pickPhoto(f);}}/></label>{(photo||(savedPhotoPath&&!removePhoto))&&<button type="button" className="provider-secondary" disabled={busy||photoBusy} onClick={()=>{if(photo)resetPhoto();else setRemovePhoto(true);}}>{photo?"Descartar":"Quitar foto"}</button>}</div>{photoBusy&&<small>Preparando la foto en tu teléfono…</small>}{!photoBusy&&photoInfo&&<small>{photoInfo}</small>}{photoError&&<small className="photo-error" role="alert">{photoError}</small>}</div><label>Precio (CUP)<input inputMode="decimal" value={servicePrice} onChange={e=>setServicePrice(e.target.value)} /></label><label>Duración en minutos<input type="number" min="1" max="1440" value={serviceDuration} onChange={e=>setServiceDuration(e.target.value)} /></label><p>El precio se guarda en centavos en la base de datos. Ejemplo: 800 CUP se guarda como 80000.</p><button className="provider-primary full-provider-button" disabled={busy||photoBusy||!serviceName.trim()} onClick={()=>void createService()}>{busy?(photoInfo.startsWith("Subiendo")?photoInfo:"Guardando…"):"Guardar servicio"}</button></section></div>}
  </main>;
}
