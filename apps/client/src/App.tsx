import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import {
  createAppointment,
  getCurrentSession,
  getMyProfilePhone,
  saveMyProfilePhone,
  isSupabaseConfigured,
  listAvailableDays,
  listAvailableSlots,
  listMyAppointments,
  listPublicServices,
  listPublishedProviders,
  getSupabaseClient,
  listMyClientProviders,
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
} from "@lumi/api";

type Tab = "inicio" | "citas" | "perfil";
type Service = PublicService & { providerName: string; tone: string; tag: string };
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
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [linkedProviders, setLinkedProviders] = useState<PublicProvider[]>([]);
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
      // Catálogo público: no requiere sesión para consultar manicuristas publicadas.
      const published = await listPublishedProviders();
      const serviceGroups = await Promise.all(published.map(p => listPublicServices(p.id)));
      setProviders(published);
      setServicesRaw(serviceGroups.flat());
      const session = await getCurrentSession();
      if (session) {
        const linked = await listMyClientProviders();
        setLinkedProviders(linked.map(p => ({
          id: p.provider_id, slug: p.slug, business_name: p.business_name, bio: p.bio, avatar_path: null,
        })));
      } else {
        setLinkedProviders([]);
      }
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
    tone: ["rose", "peach", "lilac"][i % 3],
    tag: ["ESENCIAL", "FAVORITO", "TENDENCIA"][i % 3],
  })), [servicesRaw, providers]);
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
    const token = inviteCodeInput.trim();
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
      <h1>Mis <em>manicuristas.</em></h1>
      <article className="invite-code-entry">
        <span className="eyebrow">¿TIENES UNA INVITACIÓN?</span>
        <p>Introduce el código que te dio tu manicurista para añadirla a tu cartera.</p>
        <div className="invite-code-entry-row">
          <input aria-label="Código de invitación" value={inviteCodeInput}
            onChange={e => setInviteCodeInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") checkInviteCode(); }}
            placeholder="Pega aquí el código de invitación" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} />
          <button className="button-dark" disabled={busy || !inviteCodeInput.trim()} onClick={checkInviteCode}>Validar código</button>
        </div>
      </article>
      {invitePreview && <article className="invite-preview-card">
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
      <label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar entre tus servicios..." /></label>
      {loading ? <p className="empty-state">Cargando tus manicuristas…</p> :
        !sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Tu cartera empieza con una invitación</h3><p>Para proteger la privacidad, Luni no tiene un directorio público. Introduce el código de invitación que te comparta tu manicurista.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div>
        : linkedProviders.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>Aún no tienes manicuristas conectadas</h3><p>Pide a cada profesional su código de invitación. Cada cartera y su historial se mantienen independientes.</p></div>
        : <>
          <div className="provider-portfolio-grid">{linkedProviders.map(p => <article className="provider-portfolio-card" key={p.id}><div className="portfolio-avatar">{p.business_name[0]?.toUpperCase() || "♡"}</div><div className="portfolio-provider-info"><h3>{p.business_name}</h3><p>{p.bio || "Tu espacio de belleza"}</p><small>Tu cartera independiente</small></div><button className="portfolio-remove" disabled={busy} onClick={async () => { if (!window.confirm("¿Quieres quitar a " + p.business_name + " de tu cartera? Tus citas anteriores seguirán en tu historial.")) return; setBusy(true); setError(""); try { await removeClientProvider(p.id); await loadCatalog(); setNotice("Manicurista quitada de tu cartera. El historial de citas se conserva."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo quitar la manicurista."); } finally { setBusy(false); } }}>Quitar</button></article>)}</div>
          <div className="section-heading"><div><span className="eyebrow">SERVICIOS DE TU CARTERA</span><h2>Reserva tu <em>próximo momento.</em></h2></div><span className="service-count">{services.length} servicios</span></div>
          <div className="service-grid">{visible.map(service => <article className="service-card" key={service.id}>{service.thumb_path ? <div className={"service-art " + service.tone}><img className="service-photo" src={getSupabaseClient().storage.from("service-photos").getPublicUrl(service.thumb_path).data.publicUrl} alt={"Trabajo de " + service.name} loading="lazy"/><span className="art-number">{service.duration_minutes}′</span></div> : <div className={"service-art " + service.tone}><span className="service-tag">{service.tag}</span><div className="nail-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span className="art-number">{service.duration_minutes}′</span></div>}<div className="service-info"><h3>{service.name}</h3><p>{service.description || service.providerName}<br/><b>{service.providerName}</b></p><div className="service-meta"><span>◷ {service.duration_minutes} min</span><b>{money(service.price_cents, service.currency)}</b></div><button className="button-outline" onClick={() => { setSelected(service); setError(""); }}>Reservar este servicio <span>↗</span></button></div></article>)}</div>
          {visible.length === 0 && <p className="empty-state">No hay servicios publicados que coincidan con la búsqueda.</p>}
        </>}
    </section>}

    {tab === "citas" && <section className="simple-page"><span className="eyebrow">TU AGENDA PERSONAL</span><h1>Mis <em>citas.</em></h1>{!sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Inicia sesión para ver tus citas</h3><p>Las reservas se guardan en tu cuenta de Luni.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div> : appointments.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>Tu próximo momento empieza aquí</h3><p>Aún no tienes citas. Explora los servicios disponibles.</p><button className="button-dark" onClick={() => setTab("inicio")}>Descubrir servicios <span>↗</span></button></div> : appointments.map(a => <article className="appointment-card" key={a.id}><span className="pending-pill">{a.status === "pending_confirmation" ? "Pendiente de confirmar" : a.status === "confirmed" ? "Confirmada" : a.status === "cancelled" ? "Cancelada" : a.status}</span><h3>{a.client_service_name}</h3><p>{new Date(a.starts_at).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" })}</p><b>{money(a.client_price_cents, a.client_currency)}</b>{(a.status === "cancelled" || a.status === "rejected") && a.cancellation_reason && <p className="muted">Motivo del estudio: {a.cancellation_reason}</p>}</article>)}</section>}

    {tab === "perfil" && <section className="simple-page"><span className="eyebrow">TU ESPACIO LUNI</span><h1>Hola, <em>bonita.</em></h1>{sessionEmail ? <div className="profile-panel"><div className="profile-avatar">{sessionEmail[0].toUpperCase()}</div><div><h3>{sessionEmail}</h3><p>Tu cuenta está conectada a Supabase.</p></div><button className="button-outline" onClick={async () => { setBusy(true); try { await signOut(); setAppointments([]); setSessionEmail(""); setNotice("Sesión cerrada."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cerrar sesión."); } finally { setBusy(false); } }} disabled={busy}>Cerrar sesión</button></div> : <AuthPanel onError={setError} onNotice={setNotice} onSignedIn={async kind => { await refreshAppointments(); if (kind === "signup") setTab("inicio"); }} />}<p className="muted offline-note">El catálogo público requiere conexión para actualizarse. La sincronización y las reservas sin conexión se integrarán en la siguiente etapa.</p></section>}

    <footer className="client-footer"><div className="brand-lockup"><div className="brand-mark small-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div><span>Hecho con cariño ♡</span></footer>

    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="modal-close" aria-label="Cerrar" onClick={() => setSelected(null)}>×</button><span className="eyebrow">TU PRÓXIMO MOMENTO</span><h2 id="booking-title">Reserva tu <em>espacio.</em></h2><div className="selected-service"><div className={"mini-service-art " + selected.tone}>✿</div><div><b>{selected.name}</b><small>{selected.providerName} · {selected.duration_minutes} min</small><small>{money(selected.price_cents, selected.currency)}</small></div></div><div className="field-label" role="group" aria-labelledby="day-label"><span id="day-label">Elige un día</span>
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
