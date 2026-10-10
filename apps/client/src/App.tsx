import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import {
  createAppointment,
  serviceImageUrl,
  cancelMyAppointment,
  getCurrentSession,
  getMyProfilePhone,
  saveMyProfilePhone,
  isSupabaseConfigured,
  listAvailableDays,
  listAvailableSlots,
  listMyAppointments,
  listPublicServices,
  listPublishedProviders,
  listMyClientProviders,
  listMyClientProviderBrandIcons,
  listMyClientProviderBusinessDetails,
  listPublicPortfolio,
  previewProviderInvite,
  acceptProviderInvite,
  removeClientProvider,
  onAuthStateChange,
  signOut,
  type AvailableDay,
  type PublicProvider,
  type PublicService,
  type RemoteAppointment,
  type ProviderInvitePreview,
  type PublicPortfolioItem,
} from "@lumi/api";

type Tab = "inicio" | "citas" | "perfil";
type Service = PublicService & { providerName: string; providerIcon: string; providerLogoPath: string | null; tone: string; tag: string };
const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
const localDateString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayParts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    weekday: date.toLocaleDateString("es-CU", { weekday: "short" }).replace(".", ""),
    number: d,
    month: date.toLocaleDateString("es-CU", { month: "short" }).replace(".", ""),
  };
};
const timeFormat = new Intl.DateTimeFormat("es-CU", { hour: "2-digit", minute: "2-digit", hour12: false });
const formatSlot = (iso: string) => timeFormat.format(new Date(iso));
const formatChosen = (iso: string) =>
  `${new Date(iso).toLocaleDateString("es-CU", { weekday: "long", day: "numeric", month: "long" })} · ${formatSlot(iso)}`;
const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `luni-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function App() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [appointmentSection, setAppointmentSection] = useState<"upcoming" | "history">("upcoming");
  const [homeSection, setHomeSection] = useState<"providers" | "services" | "inspiration">("providers");
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [publicWorks, setPublicWorks] = useState<PublicPortfolioItem[]>([]);
  const [servicesRaw, setServicesRaw] = useState<PublicService[]>([]);
  const [appointments, setAppointments] = useState<RemoteAppointment[]>([]);
  const [sessionEmail, setSessionEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Service | null>(null);
  const [day, setDay] = useState("");
  const [days, setDays] = useState<AvailableDay[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const [loadingDays, setLoadingDays] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityKey, setAvailabilityKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get("invite") ?? "");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [invitePreview, setInvitePreview] = useState<ProviderInvitePreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const refreshAppointments = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    if (session) {
      const [rows, phone] = await Promise.all([listMyAppointments(), getMyProfilePhone()]);
      setAppointments(rows);
      setClientPhone(phone);
    } else {
      setAppointments([]);
      setClientPhone("");
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError("Falta configurar la URL y la clave pública de Supabase en apps/client/.env.");
      setLoading(false);
      return;
    }
    try {
      setError("");
      if (inviteToken) {
        const preview = await previewProviderInvite(inviteToken);
        setInvitePreview(preview);
        if (!preview) setNotice("Este enlace de invitación no es válido o ha vencido.");
      } else {
        setInvitePreview(null);
      }
      await refreshAppointments();
      const gallery = await listPublicPortfolio();
      setPublicWorks(gallery);
      const session = await getCurrentSession();
      if (!session) {
        setProviders([]);
        setServicesRaw([]);
        return;
      }
      const [linked, publishedProviders, linkedBrandIcons, linkedBusinessDetails] = await Promise.all([
        listMyClientProviders(),
        listPublishedProviders(),
        listMyClientProviderBrandIcons(),
        listMyClientProviderBusinessDetails(),
      ]);
      const publishedById = new Map(publishedProviders.map(p => [p.id, p]));
      const brandIconById = new Map(linkedBrandIcons.map(p => [p.provider_id, p.brand_icon]));
      const brandLogoById = new Map(linkedBrandIcons.map(p => [p.provider_id, p.avatar_path]));
      const businessDetailsById = new Map(linkedBusinessDetails.map(p => [p.provider_id, p]));
      const providerRows: PublicProvider[] = linked.map(p => {
        const publicProfile = publishedById.get(p.provider_id);
        const details = businessDetailsById.get(p.provider_id);
        return {
          id: p.provider_id,
          slug: p.slug,
          business_name: p.business_name,
          bio: p.bio,
          business_phone: details?.business_phone ?? publicProfile?.business_phone ?? null,
          business_location: details?.business_location ?? publicProfile?.business_location ?? null,
          avatar_path: brandLogoById.get(p.provider_id) ?? publicProfile?.avatar_path ?? null,
          brand_icon: brandIconById.get(p.provider_id) || publicProfile?.brand_icon || "💅",
        };
      });
      const serviceGroups = await Promise.all(linked.map(p => listPublicServices(p.provider_id)));
      setProviders(providerRows);
      setServicesRaw(serviceGroups.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar con Luni.");
    } finally {
      setLoading(false);
    }
  }, [refreshAppointments, inviteToken]);

  useEffect(() => {
    void loadCatalog();
    if (!isSupabaseConfigured()) return;
    return onAuthStateChange(() => {
      void refreshAppointments().catch(e => setError(e instanceof Error ? e.message : "No se pudo actualizar la sesión."));
    });
  }, [loadCatalog, refreshAppointments]);

  const services: Service[] = useMemo(() => servicesRaw.map((s, i) => ({
    ...s,
    providerName: providers.find(p => p.id === s.provider_id)?.business_name ?? "Estudio de belleza",
    providerIcon: providers.find(p => p.id === s.provider_id)?.brand_icon || "💅",
    providerLogoPath: providers.find(p => p.id === s.provider_id)?.avatar_path ?? null,
    tone: ["rose", "peach", "lilac"][i % 3],
    tag: ["ESENCIAL", "FAVORITO", "TENDENCIA"][i % 3],
  })), [servicesRaw, providers]);
  const upcomingAppointments = useMemo(() => appointments.filter(a =>
    (a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) >= new Date()
  ), [appointments]);
  const historyAppointments = useMemo(() => appointments.filter(a =>
    !((a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) >= new Date())
  ), [appointments]);
  const visibleAppointments = appointmentSection === "upcoming" ? upcomingAppointments : historyAppointments;
  const visible = useMemo(() => services.filter(s =>
    `${s.name} ${s.description} ${s.providerName}`.toLowerCase().includes(search.toLowerCase())
  ), [services, search]);

  // Al abrir o cambiar de servicio se reinicia la selección.
  useEffect(() => {
    setDays([]); setSlots([]); setSlot(""); setDay("");
  }, [selected]);

  // Días con horas libres (calculadas por el servidor).
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoadingDays(true);
    listAvailableDays(selected.provider_id, selected.id, localDateString(new Date()), 21)
      .then(rows => {
        if (cancelled) return;
        setDays(rows);
        setDay(prev => rows.some(r => r.day === prev && r.slots > 0) ? prev : (rows.find(r => r.slots > 0)?.day ?? ""));
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo cargar la disponibilidad."); })
      .finally(() => { if (!cancelled) setLoadingDays(false); });
    return () => { cancelled = true; };
  }, [selected, availabilityKey]);

  // Horas libres del día elegido.
  useEffect(() => {
    if (!selected || !day) { setSlots([]); return; }
    let cancelled = false;
    setLoadingSlots(true);
    setSlot("");
    listAvailableSlots(selected.provider_id, selected.id, day)
      .then(rows => { if (!cancelled) setSlots(rows); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudieron cargar los horarios."); })
      .finally(() => { if (!cancelled) setLoadingSlots(false); });
    return () => { cancelled = true; };
  }, [selected, day, availabilityKey]);

  const submitBooking = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!sessionEmail) throw new Error("Inicia sesión antes de solicitar una cita.");
      if (!slot) throw new Error("Elige un horario disponible.");
      await saveMyProfilePhone(clientPhone);
      await createAppointment({
        id: makeId(),
        providerId: selected.provider_id,
        serviceId: selected.id,
        startsAt: slot,
        idempotencyKey: makeId(),
      });
      await refreshAppointments();
      setSelected(null);
      setTab("citas");
      setNotice("Solicitud enviada. La cita queda pendiente hasta que el estudio la confirme.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.");
      setAvailabilityKey(k => k + 1); // otra persona pudo ocupar la hora: refrescar
    } finally { setBusy(false); }
  };

  const checkInviteCode = () => {
    const rawToken = inviteCodeInput.trim();
    const token = rawToken.length > 9 ? rawToken : rawToken.toUpperCase();
    if (!token) {
      setError("Introduce el código que te compartió tu manicurista.");
      return;
    }
    setError("");
    setNotice("");
    setInviteToken(token);
  };

  return <main className="client-shell">
    <header className="client-top">
      <div className="brand-lockup"><div className="brand-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div>
      <button className="avatar-button" aria-label="Perfil" onClick={() => setTab("perfil")}>{sessionEmail ? sessionEmail[0].toUpperCase() : "A"}</button>
    </header>
    <nav className="client-tabs" aria-label="Navegación principal">
      {([["inicio", "Descubrir", "✧"], ["citas", "Mis citas", "▦"], ["perfil", "Mi perfil", "♡"]] as const).map(([id, label, icon]) =>
        <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span className="tab-icon" aria-hidden="true">{icon}</span><span>{label}</span></button>)}
    </nav>
    {error && <div role="alert" className="provider-notice">{error}<button onClick={() => setError("")}>×</button></div>}
    {notice && <div role="status" className="provider-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}

    {tab === "inicio" && <section className="simple-page">
      <span className="eyebrow">TU CÍRCULO DE CONFIANZA</span>
      <h1>Tu espacio <em>de belleza.</em></h1>
      <div className="section-tabs home-section-tabs" role="tablist" aria-label="Secciones de inicio">
        <button type="button" role="tab" aria-selected={homeSection === "providers"} className={homeSection === "providers" ? "section-tab active" : "section-tab"} onClick={() => setHomeSection("providers")}>Mis manicuristas <span>{providers.length}</span></button>
        <button type="button" role="tab" aria-selected={homeSection === "services"} className={homeSection === "services" ? "section-tab active" : "section-tab"} onClick={() => setHomeSection("services")}>Servicios <span>{services.length}</span></button>
        <button type="button" role="tab" aria-selected={homeSection === "inspiration"} className={homeSection === "inspiration" ? "section-tab active" : "section-tab"} onClick={() => setHomeSection("inspiration")}>Inspiración <span>{publicWorks.length}</span></button>
      </div>
      {homeSection === "providers" && <>
      <h2 className="home-section-title">Mis <em>manicuristas.</em></h2>
      <article className="invite-code-entry">
        <span className="eyebrow">¿TIENES UNA INVITACIÓN?</span>
        <p>Introduce el código que te dio tu manicurista para añadirla a tu cartera.</p>
        <div className="invite-code-entry-row">
          <input aria-label="Código de invitación" value={inviteCodeInput}
            onChange={e => setInviteCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 48))}
            onKeyDown={e => { if (e.key === "Enter") checkInviteCode(); }}
            placeholder="Ej. 482715" maxLength={48} autoCapitalize="characters"
            autoCorrect="off" spellCheck={false} />
          <button className="button-dark" disabled={busy || !inviteCodeInput.trim()} onClick={checkInviteCode}>Validar código</button>
        </div>
      </article>
      {homeSection === "providers" && invitePreview && <article className="invite-preview-card">
        <span className="eyebrow">INVITACIÓN PERSONAL</span>
        <h2>{invitePreview.business_name}</h2>
        <p>{invitePreview.bio || "Tu manicurista te invita a conocer sus servicios y reservar tus citas desde Luni."}</p>
        {sessionEmail
          ? <button className="button-dark" disabled={busy} onClick={async () => {
              setBusy(true); setError(""); setNotice("");
              try {
                await acceptProviderInvite(inviteToken);
                await loadCatalog();
                setNotice(`Ya estás conectada con ${invitePreview.business_name}. Sus servicios aparecen en tu espacio.`);
              } catch (e) { setError(e instanceof Error ? e.message : "No se pudo aceptar la invitación."); }
              finally { setBusy(false); }
            }}>{busy ? "Conectando…" : "Añadir a mis manicuristas"} <span>↗</span></button>
          : <div><p>Inicia sesión o crea tu cuenta para añadir esta manicurista a tu cartera.</p><button className="button-dark" onClick={() => setTab("perfil")}>Entrar o registrarme <span>↗</span></button></div>}
      </article>}
      </>}
      {homeSection === "inspiration" && <section className="public-work-gallery"><div className="section-heading"><div><span className="eyebrow">INSPIRACIÓN REAL</span><h2>Trabajos <em>terminados.</em></h2><p>Descubre diseños publicados por las manicuristas en Luni.</p></div><span className="service-count">{publicWorks.length} publicaciones</span></div>{publicWorks.length > 0 ? <div className="public-work-grid">{publicWorks.map(item=><article className="public-work-card" key={item.id}><div className="public-work-photos">{item.image_paths.slice(0,3).map(path=>{const url=serviceImageUrl(path);return url?<img key={path} src={url} alt={item.title||"Trabajo de uñas terminado"} loading="lazy" decoding="async"/>:null;})}</div><div className="public-work-info"><span className="portfolio-work-category">{item.category}</span><h3>{item.title||item.category}</h3>{item.description&&<p>{item.description}</p>}<b>{item.business_name}</b><small>{item.image_paths.length} {item.image_paths.length===1?"foto":"fotos"}</small><button className="button-outline" onClick={()=>{if(!sessionEmail){setNotice("Inicia sesión y solicita el código de invitación de esta manicurista para reservar.");setTab("perfil");}else if(!providers.some(p=>p.id===item.provider_id)){setNotice("Para reservar con "+item.business_name+", pídele su código de invitación y añádela a tu cartera.");}else{setSearch(item.business_name);}}}>Ver servicios / reservar ↗</button></div></article>)}</div>:<div className="public-work-empty"><span>✧</span><h3>Pronto habrá trabajos para descubrir</h3><p>Las publicaciones de las manicuristas aparecerán aquí.</p></div>}</section>}
      {homeSection === "services" && <>
      <label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar entre tus servicios..." /></label>
      </>}
      {(homeSection === "providers" || homeSection === "services") && (loading ? <p className="empty-state">Cargando tus manicuristas…</p> :
        !sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Tu cartera empieza con una invitación</h3><p>Para proteger la privacidad, Luni no tiene un directorio público. Introduce el código de invitación que te comparta tu manicurista.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div>
        : providers.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>Aún no tienes manicuristas conectadas</h3><p>Pide a cada profesional su código de invitación. Cada cartera y su historial se mantienen independientes.</p></div>
        : <>
          {homeSection === "providers" && <div className="provider-portfolio-grid">{providers.map(p => <article className="provider-portfolio-card" key={p.id}><div className="portfolio-avatar studio-client-icon" aria-label={"Identidad de " + p.business_name}>{p.avatar_path ? <img className="provider-brand-logo" src={serviceImageUrl(p.avatar_path) ?? ""} alt={"Logotipo de " + p.business_name} loading="lazy" /> : (p.brand_icon || "💅")}</div><div className="portfolio-provider-info"><h3>{p.business_name}</h3><p>{p.bio || "Tu espacio de belleza"}</p>{p.business_phone && <p><a href={"tel:" + p.business_phone}>☎ {p.business_phone}</a></p>}{p.business_location && <p>⌖ {p.business_location}</p>}<small><span className="studio-card-icon">{p.avatar_path ? <img className="provider-brand-logo small" src={serviceImageUrl(p.avatar_path) ?? ""} alt="" loading="lazy" /> : (p.brand_icon || "💅")}</span> Tu cartera independiente</small></div><button className="portfolio-remove" disabled={busy} onClick={async () => { if (!window.confirm("¿Quieres quitar a " + p.business_name + " de tu cartera? Tus citas anteriores seguirán en tu historial.")) return; setBusy(true); setError(""); try { await removeClientProvider(p.id); await loadCatalog(); setNotice("Manicurista quitada de tu cartera. El historial de citas se conserva."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo quitar la manicurista."); } finally { setBusy(false); } }}>Quitar</button></article>)}</div>}
          {homeSection === "services" && <><div className="section-heading"><div><span className="eyebrow">SERVICIOS DE TU CARTERA</span><h2>Reserva tu <em>próximo momento.</em></h2></div><span className="service-count">{services.length} servicios</span></div>
          <div className="service-grid">{visible.map(service => <article className="service-card" key={service.id}><div className={"service-art " + service.tone}>{service.card_path && <img className="service-photo" src={serviceImageUrl(service.card_path) ?? ""} alt="" loading="lazy" decoding="async" onLoad={e => e.currentTarget.classList.add("loaded")} />}<span className="service-tag">{service.tag}</span><div className="nail-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span className="art-number">{service.duration_minutes}′</span></div><div className="service-info"><h3>{service.name}</h3><p>{service.description || service.providerName}<br/><b><span className="studio-card-icon">{service.providerLogoPath ? <img className="provider-brand-logo small" src={serviceImageUrl(service.providerLogoPath) ?? ""} alt="" loading="lazy" /> : service.providerIcon}</span> {service.providerName}</b></p><div className="service-meta"><span>◷ {service.duration_minutes} min</span><b>{money(service.price_cents, service.currency)}</b></div><button className="button-outline" onClick={() => { setSelected(service); setError(""); }}>Reservar este servicio <span>↗</span></button><div aria-label={"Logotipo de " + service.providerName} title={service.providerName} style={{ marginTop: 10, marginLeft: "auto", width: 44, height: 44, borderRadius: "50%", overflow: "hidden", border: "2px solid #e8cbd3", background: "#fff8fa", display: "grid", placeItems: "center", boxShadow: "0 3px 10px rgba(80,40,55,.12)" }}>{service.providerLogoPath ? <img src={serviceImageUrl(service.providerLogoPath) ?? ""} alt={"Logotipo de " + service.providerName} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>{service.providerIcon || "💅"}</span>}</div></div></article>)}</div>
          {visible.length === 0 && <p className="empty-state">No encontramos servicios con ese nombre en tus carteras.</p>}</>}
        </>)}
    </section>}

    {tab === "citas" && <section className="simple-page"><span className="eyebrow">TU AGENDA PERSONAL</span><h1>Mis <em>citas.</em></h1>{sessionEmail && <div className="section-tabs" role="tablist" aria-label="Filtrar citas"><button type="button" role="tab" aria-selected={appointmentSection === "upcoming"} className={appointmentSection === "upcoming" ? "section-tab active" : "section-tab"} onClick={() => setAppointmentSection("upcoming")}>Próximas <span>{upcomingAppointments.length}</span></button><button type="button" role="tab" aria-selected={appointmentSection === "history"} className={appointmentSection === "history" ? "section-tab active" : "section-tab"} onClick={() => setAppointmentSection("history")}>Historial <span>{historyAppointments.length}</span></button></div>}{!sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Inicia sesión para ver tus citas</h3><p>Las reservas se guardan en tu cuenta de Luni.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div> : appointments.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>Tu próximo momento empieza aquí</h3><p>Aún no tienes citas. Explora los servicios disponibles.</p><button className="button-dark" onClick={() => setTab("inicio")}>Descubrir servicios <span>↗</span></button></div> : visibleAppointments.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>{appointmentSection === "upcoming" ? "No tienes citas próximas" : "Tu historial está vacío"}</h3><p>{appointmentSection === "upcoming" ? "Cuando reserves un servicio, aparecerá aquí." : "Las citas anteriores, canceladas o completadas aparecerán aquí."}</p>{appointmentSection === "upcoming" && <button className="button-dark" onClick={() => setTab("inicio")}>Ver mis manicuristas <span>↗</span></button>}</div> : visibleAppointments.map(a => <article className="appointment-card" key={a.id}><span className="pending-pill">{a.status === "pending_confirmation" ? "Pendiente de confirmar" : a.status === "confirmed" ? "Confirmada" : a.status === "cancelled" ? "Cancelada" : a.status}</span><h3>{a.client_service_name}</h3><p>{new Date(a.starts_at).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" })}</p><b>{money(a.client_price_cents, a.client_currency)}</b>{(a.status === "cancelled" || a.status === "rejected") && a.cancellation_reason && <p className="muted">Motivo del estudio: {a.cancellation_reason}</p>}{(a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) > new Date() && (cancelConfirmId === a.id ? <div><p className="muted">¿Seguro que quieres cancelar esta cita?</p><button className="button-dark" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await cancelMyAppointment(a.id); setCancelConfirmId(null); await refreshAppointments(); setNotice("Cita cancelada."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cancelar la cita."); } finally { setBusy(false); } }}>Sí, cancelar</button> <button className="button-outline" disabled={busy} onClick={() => setCancelConfirmId(null)}>No, mantener</button></div> : <button className="button-outline" onClick={() => setCancelConfirmId(a.id)}>Cancelar cita</button>)}</article>)}</section>}

    {tab === "perfil" && <section className="simple-page"><span className="eyebrow">TU ESPACIO LUNI</span><h1>Hola, <em>bonita.</em></h1>{sessionEmail ? <div className="profile-panel"><div className="profile-avatar">{sessionEmail[0].toUpperCase()}</div><div><h3>{sessionEmail}</h3><p>Tu cuenta está conectada a Supabase.</p></div><button className="button-outline" onClick={async () => { setBusy(true); try { await signOut(); setAppointments([]); setSessionEmail(""); setNotice("Sesión cerrada."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cerrar sesión."); } finally { setBusy(false); } }} disabled={busy}>Cerrar sesión</button></div> : <AuthPanel onError={setError} onNotice={setNotice} onSignedIn={async kind => { await refreshAppointments(); if (kind === "signup") setTab("inicio"); }} />}<p className="muted offline-note">El catálogo público requiere conexión para actualizarse. La sincronización y las reservas sin conexión se integrarán en la siguiente etapa.</p></section>}

    <footer className="client-footer"><div className="brand-lockup"><div className="brand-mark small-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div><span>Hecho con cariño ♡</span></footer>

    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="modal-close" aria-label="Cerrar" onClick={() => setSelected(null)}>×</button><span className="eyebrow">TU PRÓXIMO MOMENTO</span><h2 id="booking-title">Reserva tu <em>espacio.</em></h2><div className="selected-service"><div className={"mini-service-art " + selected.tone}>{selected.thumb_path ? <img className="service-photo loaded" src={serviceImageUrl(selected.thumb_path) ?? ""} alt="" /> : "✿"}</div><div><b>{selected.name}</b><small><span className="studio-card-icon">{selected.providerLogoPath ? <img className="provider-brand-logo small" src={serviceImageUrl(selected.providerLogoPath) ?? ""} alt="" /> : selected.providerIcon}</span> {selected.providerName} · {selected.duration_minutes} min</small><small>{money(selected.price_cents, selected.currency)}</small></div></div><div className="field-label" role="group" aria-labelledby="day-label"><span id="day-label">Elige un día</span>
          {loadingDays && days.length === 0 ? <p className="muted availability-note">Buscando horarios disponibles…</p>
          : days.every(d => d.slots === 0) ? <p className="muted availability-note">Este estudio aún no tiene horarios disponibles en los próximos días. Vuelve a intentarlo pronto.</p>
          : <div className="day-strip">{days.map(d => { const p = dayParts(d.day); return <button type="button" key={d.day} className={d.day === day ? "day-chip chosen" : "day-chip"} disabled={d.slots === 0} aria-pressed={d.day === day} aria-label={`${p.weekday} ${p.number} de ${p.month}${d.slots === 0 ? ", sin horarios" : ""}`} onClick={() => setDay(d.day)}><small>{p.weekday}</small><b>{p.number}</b><small>{p.month}</small></button>; })}</div>}
        </div>
        {day && <div className="field-label" role="group" aria-labelledby="time-label"><span id="time-label">Horarios disponibles</span>
          {loadingSlots ? <p className="muted availability-note">Buscando horarios…</p>
          : slots.length === 0 ? <p className="muted availability-note">No quedan horarios libres este día. Prueba con otro.</p>
          : <div className="time-options">{slots.map(iso => <button type="button" key={iso} className={slot === iso ? "time-chip chosen" : "time-chip"} aria-pressed={slot === iso} onClick={() => setSlot(iso)}>{formatSlot(iso)}</button>)}</div>}
        </div>}
        {slot && <p className="chosen-summary" role="status">Tu cita: <b>{formatChosen(slot)}</b></p>}
        <label className="field-label">Teléfono de contacto <input type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Ej. +53 5XXXXXXX" autoComplete="tel" required /></label><p className="muted">La manicurista utilizará este número para contactarte sobre tu cita.</p><p className="booking-disclaimer">Solo ves horarios que están libres ahora mismo. Tu solicitud queda pendiente hasta que el estudio la confirme.</p><button className="button-dark full-button" disabled={busy || !slot || clientPhone.trim().replace(/[^0-9]/g, "").length < 7} onClick={() => void submitBooking()}>{busy ? "Enviando…" : "Enviar solicitud"} <span>↗</span></button>{!sessionEmail && <p className="muted">Debes iniciar sesión. Puedes hacerlo desde “Mi perfil” sin perder el servicio seleccionado.</p>}</section></div>}
  </main>;
}
