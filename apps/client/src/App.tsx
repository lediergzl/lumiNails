import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAppointment,
  getCurrentSession,
  isSupabaseConfigured,
  listMyAppointments,
  listPublicServices,
  listPublishedProviders,
  onAuthStateChange,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  type PublicProvider,
  type PublicService,
  type RemoteAppointment,
} from "@lumi/api";

type Tab = "inicio" | "citas" | "perfil";
type Service = PublicService & { providerName: string; tone: string; tag: string };
const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
const todayLocal = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `luni-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function App() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [servicesRaw, setServicesRaw] = useState<PublicService[]>([]);
  const [appointments, setAppointments] = useState<RemoteAppointment[]>([]);
  const [sessionEmail, setSessionEmail] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Service | null>(null);
  const [day, setDay] = useState(todayLocal());
  const [time, setTime] = useState("10:00");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const refreshAppointments = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    if (session) setAppointments(await listMyAppointments());
    else setAppointments([]);
  }, []);

  const loadCatalog = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setError("Falta configurar la URL y la clave pública de Supabase en apps/client/.env.");
      setLoading(false);
      return;
    }
    try {
      setError("");
      const [providerRows, serviceRows] = await Promise.all([listPublishedProviders(), listPublicServices()]);
      setProviders(providerRows);
      const visibleProviderIds = new Set(providerRows.map(p => p.id));
      setServicesRaw(serviceRows.filter(s => visibleProviderIds.has(s.provider_id)));
      await refreshAppointments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar con Supabase.");
    } finally {
      setLoading(false);
    }
  }, [refreshAppointments]);

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
    tone: ["rose", "peach", "lilac"][i % 3],
    tag: ["ESENCIAL", "FAVORITO", "TENDENCIA"][i % 3],
  })), [servicesRaw, providers]);
  const visible = useMemo(() => services.filter(s =>
    `${s.name} ${s.description} ${s.providerName}`.toLowerCase().includes(search.toLowerCase())
  ), [services, search]);

  const submitAuth = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      if (authMode === "signup") {
        await signUpWithEmail(email, password, displayName);
        setNotice("Cuenta creada. Si Supabase solicita confirmar el correo, revisa tu bandeja antes de iniciar sesión.");
        setAuthMode("login");
      } else {
        await signInWithEmail(email, password);
        await refreshAppointments();
        setNotice("Sesión iniciada correctamente.");
      }
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la autenticación.");
    } finally { setBusy(false); }
  };

  const submitBooking = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!sessionEmail) throw new Error("Inicia sesión antes de solicitar una cita.");
      const start = new Date(`${day}T${time}:00`);
      if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) throw new Error("Selecciona una fecha y hora futuras.");
      await createAppointment({
        id: makeId(),
        providerId: selected.provider_id,
        serviceId: selected.id,
        startsAt: start.toISOString(),
        idempotencyKey: makeId(),
      });
      await refreshAppointments();
      setSelected(null);
      setTab("citas");
      setNotice("Solicitud enviada. La cita queda pendiente hasta que el estudio la confirme.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.");
    } finally { setBusy(false); }
  };

  return <main className="client-shell">
    <header className="client-top">
      <div className="brand-lockup"><div className="brand-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div>
      <button className="avatar-button" aria-label="Perfil" onClick={() => setTab("perfil")}>{sessionEmail ? sessionEmail[0].toUpperCase() : "A"}</button>
    </header>
    <nav className="client-tabs" aria-label="Navegación principal">
      <button className={tab === "inicio" ? "active" : ""} onClick={() => setTab("inicio")}>Descubrir</button>
      <button className={tab === "citas" ? "active" : ""} onClick={() => setTab("citas")}>Mis citas</button>
      <button className={tab === "perfil" ? "active" : ""} onClick={() => setTab("perfil")}>Mi perfil</button>
    </nav>
    {error && <div role="alert" className="provider-notice">{error}<button onClick={() => setError("")}>×</button></div>}
    {notice && <div role="status" className="provider-notice">{notice}<button onClick={() => setNotice("")}>×</button></div>}

    {tab === "inicio" && <>
      <section className="client-hero">
        <div className="hero-copy"><span className="eyebrow">BELLEZA QUE SE SIENTE</span><h1>Un momento<br/>solo <em>para ti.</em></h1><p>Encuentra tu próximo estilo favorito y reserva tu espacio.</p><button className="button-dark" onClick={() => document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" })}>Explorar servicios <span>↗</span></button></div>
        <div className="hero-art" aria-label="Ilustración decorativa de manicura"><div className="sun-disc"></div><div className="flower flower-one">✿</div><div className="flower flower-two">✿</div><div className="nail-bottle"><div className="bottle-cap"></div><div className="bottle-neck"></div><div className="bottle-body"><span>l</span></div></div><div className="art-caption">BEAUTY, IN YOUR OWN WAY</div></div>
      </section>
      <section className="trust-row"><div><span className="trust-icon">♡</span><span><b>A tu ritmo</b><small>Reserva cuando quieras</small></span></div><div><span className="trust-icon">✧</span><span><b>Tu estilo</b><small>Servicios para ti</small></span></div><div><span className="trust-icon">⌁</span><span><b>Sin sorpresas</b><small>Precios transparentes</small></span></div></section>
      <section id="catalogo" className="catalog-section"><div className="section-heading"><div><span className="eyebrow">ELIGE TU FAVORITO</span><h2>Pequeños detalles,<br/><em>gran diferencia.</em></h2></div><span className="service-count">{services.length} servicios</span></div>
        <label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar servicio o estudio..." /></label>
        {loading ? <p className="empty-state">Cargando catálogo desde Luni…</p> : <div className="service-grid">{visible.map(service => <article className="service-card" key={service.id}><div className={"service-art " + service.tone}><span className="service-tag">{service.tag}</span><div className="nail-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span className="art-number">{service.duration_minutes}′</span></div><div className="service-info"><h3>{service.name}</h3><p>{service.description || service.providerName}<br/><b>{service.providerName}</b></p><div className="service-meta"><span>◷ {service.duration_minutes} min</span><b>{money(service.price_cents, service.currency)}</b></div><button className="button-outline" onClick={() => { setSelected(service); setDay(todayLocal()); setError(""); }}>Reservar este servicio <span>↗</span></button></div></article>)}</div>}
        {!loading && visible.length === 0 && <p className="empty-state">{services.length === 0 ? "Todavía no hay estudios publicados con servicios activos." : "No encontramos servicios con ese nombre."}</p>}
      </section>
      <section className="salon-note"><span className="note-star">✳</span><div><span className="eyebrow">UN ESPACIO PARA TI</span><h2>La belleza está<br/>en los detalles.</h2><p>Guarda un ratito para ti. Te lo mereces.</p></div><span className="note-flower">✿</span></section>
    </>}

    {tab === "citas" && <section className="simple-page"><span className="eyebrow">TU AGENDA PERSONAL</span><h1>Mis <em>citas.</em></h1>{!sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Inicia sesión para ver tus citas</h3><p>Las reservas se guardan en tu cuenta de Luni.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div> : appointments.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>Tu próximo momento empieza aquí</h3><p>Aún no tienes citas. Explora los servicios disponibles.</p><button className="button-dark" onClick={() => setTab("inicio")}>Descubrir servicios <span>↗</span></button></div> : appointments.map(a => <article className="appointment-card" key={a.id}><span className="pending-pill">{a.status === "pending_confirmation" ? "Pendiente de confirmar" : a.status === "confirmed" ? "Confirmada" : a.status === "cancelled" ? "Cancelada" : a.status}</span><h3>{a.client_service_name}</h3><p>{new Date(a.starts_at).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" })}</p><b>{money(a.client_price_cents, a.client_currency)}</b></article>)}</section>}

    {tab === "perfil" && <section className="simple-page"><span className="eyebrow">TU ESPACIO LUNI</span><h1>Hola, <em>bonita.</em></h1>{sessionEmail ? <div className="profile-panel"><div className="profile-avatar">{sessionEmail[0].toUpperCase()}</div><div><h3>{sessionEmail}</h3><p>Tu cuenta está conectada a Supabase.</p></div><button className="button-outline" onClick={async () => { setBusy(true); try { await signOut(); setAppointments([]); setSessionEmail(""); setNotice("Sesión cerrada."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cerrar sesión."); } finally { setBusy(false); } }} disabled={busy}>Cerrar sesión</button></div> : <div className="profile-panel auth-panel"><div className="profile-avatar">♡</div><div><h3>{authMode === "login" ? "Inicia sesión" : "Crea tu cuenta"}</h3><p>Accede a tus citas y preferencias desde cualquier dispositivo.</p></div><div className="auth-fields">{authMode === "signup" && <label className="field-label">Nombre<input value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="name" /></label>}<label className="field-label">Correo electrónico<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label><label className="field-label">Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label><button className="button-dark full-button" disabled={busy || !email.trim() || password.length < 6 || (authMode === "signup" && !displayName.trim())} onClick={() => void submitAuth()}>{busy ? "Procesando…" : authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}</button><button className="button-outline auth-toggle" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setError(""); }}>{authMode === "login" ? "No tengo cuenta · Registrarme" : "Ya tengo cuenta · Iniciar sesión"}</button></div></div>}<p className="muted offline-note">El catálogo público requiere conexión para actualizarse. La sincronización y las reservas sin conexión se integrarán en la siguiente etapa.</p></section>}

    <footer className="client-footer"><div className="brand-lockup"><div className="brand-mark small-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div><span>Hecho con cariño ♡</span></footer>

    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="modal-close" aria-label="Cerrar" onClick={() => setSelected(null)}>×</button><span className="eyebrow">TU PRÓXIMO MOMENTO</span><h2 id="booking-title">Reserva tu <em>espacio.</em></h2><div className="selected-service"><div className={"mini-service-art " + selected.tone}>✿</div><div><b>{selected.name}</b><small>{selected.providerName} · {selected.duration_minutes} min</small><small>{money(selected.price_cents, selected.currency)}</small></div></div><label className="field-label">Día preferido<input type="date" min={todayLocal()} value={day} onChange={e => setDay(e.target.value)} /></label><label className="field-label">Hora preferida<div className="time-options">{["09:00","10:00","11:30","14:00","16:00"].map(t => <button type="button" key={t} className={time === t ? "time-chip chosen" : "time-chip"} onClick={() => setTime(t)}>{t}</button>)}</div></label><p className="booking-disclaimer">La hora se validará contra el horario real del estudio. La solicitud solo queda aceptada si el servidor confirma el registro.</p><button className="button-dark full-button" disabled={busy} onClick={() => void submitBooking()}>{busy ? "Enviando…" : "Enviar solicitud"} <span>↗</span></button>{!sessionEmail && <p className="muted">Debes iniciar sesión. Puedes hacerlo desde “Mi perfil” sin perder el servicio seleccionado.</p>}</section></div>}
  </main>;
}
