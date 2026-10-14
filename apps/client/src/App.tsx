import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AuthPanel from "./AuthPanel";
import { CachedImage } from "@lumi/ui/CachedImage";
import {
  friendlyError,
  getOfflineStatus,
  onReconnect,
  subscribeOfflineStatus,
  dismissConflicts,
  offlineBannerText,
  createAppointment,
  rescheduleMyAppointment,
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
  listMyClientProviderCodes,
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
  SERVICE_CATEGORIES,
  inferServiceCategory,
} from "@lumi/api";

type Tab = "inicio" | "citas" | "perfil";
type Service = PublicService & { providerName: string; providerIcon: string; providerLogoPath: string | null; tone: string };
const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Pendiente de confirmar",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
  rejected: "Rechazada",
  completed: "Completada",
};

const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
const SERVICE_PAGE_SIZE = 8;
const categoryOfService = (service: { category?: string; name: string; description: string }) =>
  service.category?.trim() || inferServiceCategory(service.name, service.description);
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
const PROVIDER_TIME_ZONE = "America/Havana";
const timeFormat = new Intl.DateTimeFormat("es-CU", { timeZone: PROVIDER_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
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
  const [providerCodes, setProviderCodes] = useState<Record<string, string>>({});
  const [publicWorks, setPublicWorks] = useState<PublicPortfolioItem[]>([]);
  const [selectedDesign, setSelectedDesign] = useState<PublicPortfolioItem | null>(null);
  const [workSearch, setWorkSearch] = useState("");
  const [workCategory, setWorkCategory] = useState("Todas");
  const [lightboxWork, setLightboxWork] = useState<PublicPortfolioItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [servicesRaw, setServicesRaw] = useState<PublicService[]>([]);
  const [appointments, setAppointments] = useState<RemoteAppointment[]>([]);
  const [sessionEmail, setSessionEmail] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [search, setSearch] = useState("");
  const [serviceCategoryFilter, setServiceCategoryFilter] = useState<string>("Todas");
  const [servicePage, setServicePage] = useState(1);
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
  const [reschedulingAppointmentId, setReschedulingAppointmentId] = useState<string | null>(null);
  const [error, setErrorRaw] = useState("");
  const setError = useCallback((message: string) => setErrorRaw(friendlyError(message)), []);
  const net = useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus);
  const bannerText = offlineBannerText(net);
  // Cerrar sesión borra lo guardado en el teléfono, incluidos los cambios que aún no se enviaron.
  const confirmSignOut = () => net.pending === 0 || window.confirm("Tienes " + net.pending + (net.pending === 1 ? " cambio" : " cambios") + " sin enviar. Si cierras sesión se perderán. ¿Cerrar sesión de todos modos?");
  const [notice, setNotice] = useState("");
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get("invite") ?? "");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [invitePreview, setInvitePreview] = useState<ProviderInvitePreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const refreshAppointments = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    setSessionName(String(session?.user.user_metadata?.display_name ?? "").trim());
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
        setProviderCodes({});
        setServicesRaw([]);
        return;
      }
      const [linked, publishedProviders, linkedBrandIcons, linkedBusinessDetails, linkedCodes] = await Promise.all([
        listMyClientProviders(),
        listPublishedProviders(),
        listMyClientProviderBrandIcons(),
        listMyClientProviderBusinessDetails(),
        listMyClientProviderCodes(),
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
      setProviderCodes(Object.fromEntries(linkedCodes.map(row => [row.provider_id, row.business_code])));
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
      // Al iniciar/cerrar sesión también hay que refrescar cartera y catálogo, no solo las citas.
      void loadCatalog().catch(e => setError(e instanceof Error ? e.message : "No se pudo actualizar la sesión."));
    });
  }, [loadCatalog, refreshAppointments]);

  // Al recuperar la red se vuelve a pedir todo, sin que haya que reabrir la app.
  useEffect(() => onReconnect(() => { setAvailabilityKey(v => v + 1); void loadCatalog(); }), [loadCatalog]);

  const renderAppointment = (a: (typeof appointments)[number]) => {
    const when = new Date(a.starts_at);
    const providerName = providers.find(p => p.id === a.provider_id)?.business_name;
    const weekday = when.toLocaleDateString("es-CU", { weekday: "long" });
    return <article className={"appointment-card status-" + a.status} key={a.id}>
      <div className="appt-date" aria-hidden="true"><b>{when.getDate()}</b><span>{when.toLocaleDateString("es-CU", { month: "short" }).replace(".", "")}</span></div>
      <div className="appt-body">
        <span className="pending-pill">{STATUS_LABEL[a.status] ?? a.status}</span>
        <h3>{a.client_service_name}</h3>
        <p className="appt-when">{weekday.charAt(0).toUpperCase() + weekday.slice(1)} · {when.toLocaleTimeString("es-CU", { hour: "numeric", minute: "2-digit" })}{providerName ? " · " + providerName : ""}</p>
        <b className="appt-price">{money(a.client_price_cents, a.client_currency)}</b>
        {a.status === "cancelled" && <div className="appointment-cancellation-notice" role="status"><strong>Tu cita ha sido cancelada por el estudio.</strong><p>El estudio ha cancelado tu cita de {a.client_service_name}, prevista para el {when.toLocaleDateString("es-CU", { day: "numeric", month: "long" })} a las {when.toLocaleTimeString("es-CU", { hour: "2-digit", minute: "2-digit" })}.</p>{a.cancellation_reason?.trim() ? <p><b>Motivo:</b> {a.cancellation_reason}</p> : null}<p>Puedes entrar en Luni para elegir otro horario.</p><button type="button" className="button-outline" onClick={() => { setTab("inicio"); setHomeSection("services"); setAppointmentSection("upcoming"); }}>Buscar otro horario</button></div>}{a.status === "rejected" && a.cancellation_reason && <p className="muted">Motivo del estudio: {a.cancellation_reason}</p>}{(a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) > new Date() && (cancelConfirmId === a.id ? <div><p className="muted">¿Seguro que quieres cancelar esta cita?</p><button className="button-dark" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const outcome = await cancelMyAppointment(a.id, "", "Cancelar «" + a.client_service_name + "»"); setCancelConfirmId(null); setAvailabilityKey(v => v + 1); await refreshAppointments(); setNotice(outcome.queued ? "Cancelación guardada en este teléfono. El turno se liberará en el servidor cuando se sincronice." : "Cita cancelada. Se actualizará la disponibilidad de ese horario."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cancelar la cita."); } finally { setBusy(false); } }}>Sí, cancelar</button> <button className="button-outline" disabled={busy} onClick={() => setCancelConfirmId(null)}>No, mantener</button></div> : <button className="button-outline" onClick={() => setCancelConfirmId(a.id)}>Cancelar cita</button>)}{(a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) > new Date() && <button className="button-outline" disabled={busy} onClick={() => { const service = services.find(s => s.id === a.service_id); if (!service) { setError("No se encontró el servicio de esta cita en el catálogo actual. Contacta con la manicurista para cambiarla."); return; } setReschedulingAppointmentId(a.id); setSelected(service); setError(""); setNotice("Elige una nueva fecha y hora. Modificaremos esta cita, sin crear otra."); }}>{reschedulingAppointmentId === a.id ? "Modificando esta cita…" : "Modificar fecha y hora"}</button>}
      </div>
    </article>;
  };

  const services: Service[] = useMemo(() => servicesRaw.map((s, i) => ({
    ...s,
    providerName: providers.find(p => p.id === s.provider_id)?.business_name ?? "Estudio de belleza",
    providerIcon: providers.find(p => p.id === s.provider_id)?.brand_icon || "💅",
    providerLogoPath: providers.find(p => p.id === s.provider_id)?.avatar_path ?? null,
    tone: ["rose", "peach", "lilac"][i % 3],
  })), [servicesRaw, providers]);
  const upcomingAppointments = useMemo(() => appointments.filter(a =>
    (a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) >= new Date()
  ), [appointments]);
  const historyAppointments = useMemo(() => appointments.filter(a =>
    !((a.status === "pending_confirmation" || a.status === "confirmed") && new Date(a.starts_at) >= new Date())
  ), [appointments]);
  const visibleAppointments = appointmentSection === "upcoming" ? upcomingAppointments : historyAppointments;
  const activeAppointment = useMemo(() => appointments.find(a => a.status === "pending_confirmation" || a.status === "confirmed") ?? null, [appointments]);
  const visible = useMemo(() => services.filter(s => {
    const matchesSelectedStudio = !(selectedDesign && homeSection === "services") || s.provider_id === selectedDesign.provider_id;
    const matchesSearch = `${s.name} ${s.description} ${s.providerName}`.toLocaleLowerCase("es-CU").includes(search.toLocaleLowerCase("es-CU"));
    return matchesSelectedStudio && matchesSearch;
  }), [services, search, selectedDesign, homeSection]);

  const availableServiceCategories = useMemo(() => {
    const present = new Set(visible.map(categoryOfService));
    return [
      ...SERVICE_CATEGORIES.filter(category => present.has(category)),
      ...Array.from(present).filter(category => !(SERVICE_CATEGORIES as readonly string[]).includes(category)).sort((a, b) => a.localeCompare(b, "es")),
    ];
  }, [visible]);

  const filteredServices = useMemo(() => {
    const matches = serviceCategoryFilter === "Todas"
      ? visible
      : visible.filter(service => categoryOfService(service) === serviceCategoryFilter);
    const categoryOrder = new Map<string, number>(SERVICE_CATEGORIES.map((category, index) => [category, index] as const));
    return [...matches].sort((a, b) => {
      const categoryA = categoryOfService(a);
      const categoryB = categoryOfService(b);
      return (categoryOrder.get(categoryA) ?? 999) - (categoryOrder.get(categoryB) ?? 999)
        || categoryA.localeCompare(categoryB, "es")
        || a.name.localeCompare(b.name, "es");
    });
  }, [visible, serviceCategoryFilter]);

  const totalServicePages = Math.max(1, Math.ceil(filteredServices.length / SERVICE_PAGE_SIZE));
  const currentServicePage = Math.min(servicePage, totalServicePages);
  const pageServices = useMemo(() => {
    const start = (currentServicePage - 1) * SERVICE_PAGE_SIZE;
    return filteredServices.slice(start, start + SERVICE_PAGE_SIZE);
  }, [filteredServices, currentServicePage]);

  const groupedServices = useMemo(() => {
    const present = new Set(pageServices.map(categoryOfService));
    const categories = [
      ...SERVICE_CATEGORIES.filter(category => present.has(category)),
      ...Array.from(present).filter(category => !(SERVICE_CATEGORIES as readonly string[]).includes(category)).sort((a, b) => a.localeCompare(b, "es")),
    ];
    return categories.map(category => ({
      category,
      items: pageServices.filter(service => categoryOfService(service) === category),
    })).filter(group => group.items.length > 0);
  }, [pageServices]);

  useEffect(() => {
    setServicePage(1);
    if (serviceCategoryFilter !== "Todas" && !availableServiceCategories.includes(serviceCategoryFilter)) {
      setServiceCategoryFilter("Todas");
    }
  }, [search, selectedDesign, homeSection, availableServiceCategories, serviceCategoryFilter]);

  const workCategories = useMemo(() => [
    "Todas",
    ...Array.from(new Set(publicWorks.map(item => item.category.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "es")),
  ], [publicWorks]);
  const visiblePublicWorks = useMemo(() => {
    const query = workSearch.trim().toLocaleLowerCase("es-CU");
    return publicWorks.filter(item => {
      const matchesCategory = workCategory === "Todas" || item.category === workCategory;
      const searchable = `${item.title} ${item.description} ${item.category} ${item.business_name}`.toLocaleLowerCase("es-CU");
      return matchesCategory && (!query || searchable.includes(query));
    });
  }, [publicWorks, workCategory, workSearch]);

  useEffect(() => {
    if (!lightboxWork) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxWork(null);
      if (event.key === "ArrowRight" && lightboxWork.image_paths.length > 1) {
        setLightboxIndex(index => (index + 1) % lightboxWork.image_paths.length);
      }
      if (event.key === "ArrowLeft" && lightboxWork.image_paths.length > 1) {
        setLightboxIndex(index => (index - 1 + lightboxWork.image_paths.length) % lightboxWork.image_paths.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxWork]);

  useEffect(() => {
    if (tab !== "inicio" || homeSection !== "services" || !selectedDesign) return;
    document.querySelector(".selected-design-flow")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tab, homeSection, selectedDesign]);

  const chooseDesignForBooking = (item: PublicPortfolioItem) => {
    setSelectedDesign(item);
    setSearch("");
    setServiceCategoryFilter("Todas");
    setServicePage(1);
    setTab("inicio");
    setHomeSection("services");
    if (!sessionEmail) {
      setNotice("Tu diseño quedó guardado. Inicia sesión para continuar; Luni conservará el trabajo elegido y te llevará al siguiente paso.");
      setTab("perfil");
      return;
    }
    if (!providers.some(provider => provider.id === item.provider_id)) {
      setNotice("El diseño está seleccionado. Para continuar, primero añade a " + item.business_name + " a tu cartera con su código de invitación. El trabajo quedará guardado en este paso.");
      return;
    }
    setNotice("Diseño seleccionado. Ya mostramos los servicios de " + item.business_name + "; elige uno para pasar directamente a los horarios.");
  };

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
      if (reschedulingAppointmentId) {
        const reschedule = await rescheduleMyAppointment(reschedulingAppointmentId, slot);
        await refreshAppointments();
        setSelected(null);
        setReschedulingAppointmentId(null);
        setTab("citas");
        setNotice(reschedule.queued
          ? "Cambio guardado en este teléfono y pendiente de sincronización. El nuevo horario todavía no está confirmado por el servidor."
          : "Cita modificada correctamente. Se conservó la misma cita y su estado.");
      } else {
        if (activeAppointment) throw new Error("Ya tienes una cita pendiente o confirmada. Modifica esa cita o cancélala antes de reservar otra.");
        const designNotes = selectedDesign && selectedDesign.provider_id === selected.provider_id
          ? `DISEÑO ELEGIDO POR LA CLIENTA\nTrabajo: ${selectedDesign.title || selectedDesign.category}\nCategoría: ${selectedDesign.category}\nPublicación Luni: ${selectedDesign.id}\nFoto: ${selectedDesign.image_paths[0] ?? "sin foto"}`
          : "";
        const booking = await createAppointment({
          id: makeId(),
          providerId: selected.provider_id,
          serviceId: selected.id,
          startsAt: slot,
          idempotencyKey: makeId(),
          notes: designNotes,
          serviceName: selected.name,
          priceCents: selected.price_cents,
          currency: selected.currency,
          durationMinutes: selected.duration_minutes,
        });
        await refreshAppointments();
        setSelected(null);
        setSelectedDesign(null);
        setTab("citas");
        setNotice(booking.queued
          ? "Solicitud guardada en este teléfono y pendiente de sincronización. El horario no está confirmado y podría dejar de estar disponible. Cuando vuelva la conexión, Luni verificará la disponibilidad."
          : booking.appointment?.status === "confirmed"
            ? "Cita confirmada automáticamente por el estudio." + (designNotes ? " Se adjuntó el diseño elegido." : "")
            : "Solicitud enviada" + (designNotes ? " con el diseño elegido adjunto a la cita" : " con diseño libre") + ". La cita queda pendiente hasta que el estudio la confirme.");
      }
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
      <button className="avatar-button" aria-label="Perfil" onClick={() => setTab("perfil")}>{(sessionName || sessionEmail) ? (sessionName || sessionEmail)[0].toUpperCase() : "A"}</button>
    </header>
    {(bannerText || net.conflicts.length > 0) && <div>{bannerText && <div className="offline-banner" role="status">{bannerText}</div>}{net.conflicts.length > 0 && <div className="offline-conflicts" role="alert">{net.conflicts.map((m, i) => <p key={i}>{m}</p>)}<button onClick={() => void dismissConflicts()}>Entendido</button></div>}</div>}
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
                if (selectedDesign?.provider_id === invitePreview.provider_id) {
                  setSearch("");
                  setHomeSection("services");
                  setNotice(`Ya estás conectada con ${invitePreview.business_name}. Conservamos el diseño elegido; selecciona un servicio para continuar con la reserva.`);
                } else {
                  setNotice(`Ya estás conectada con ${invitePreview.business_name}. Sus servicios aparecen en tu espacio.`);
                }
              } catch (e) { setError(e instanceof Error ? e.message : "No se pudo aceptar la invitación."); }
              finally { setBusy(false); }
            }}>{busy ? "Conectando…" : "Añadir a mis manicuristas"} <span>↗</span></button>
          : <div><p>Inicia sesión o crea tu cuenta para añadir esta manicurista a tu cartera.</p><button className="button-dark" onClick={() => setTab("perfil")}>Entrar o registrarme <span>↗</span></button></div>}
      </article>}
      </>}
      {homeSection === "inspiration" && <section className="public-work-gallery"><div className="section-heading"><div><span className="eyebrow">INSPIRACIÓN REAL</span><h2>Diseños que <em>inspiran.</em></h2><p>Explora trabajos reales y elige el estilo que quieres llevar en tus uñas.</p></div><span className="service-count">{publicWorks.length} {publicWorks.length === 1 ? "publicación" : "publicaciones"}</span></div>{publicWorks.length > 0 ? <><label className="work-search"><span aria-hidden="true">⌕</span><input value={workSearch} onChange={e => setWorkSearch(e.target.value)} placeholder="Buscar diseño o manicurista…" aria-label="Buscar diseños por nombre o manicurista" /></label><div className="work-category-filters" role="group" aria-label="Filtrar diseños por categoría">{workCategories.map(category => <button type="button" key={category} className={workCategory === category ? "work-category-chip active" : "work-category-chip"} aria-pressed={workCategory === category} onClick={() => setWorkCategory(category)}>{category}</button>)}</div>{visiblePublicWorks.length > 0 ? <div className="public-work-grid">{visiblePublicWorks.map(item => { const cleanTitle = item.title.trim(); const sameAsCategory = !cleanTitle || cleanTitle.toLocaleLowerCase("es-CU") === item.category.trim().toLocaleLowerCase("es-CU"); return <article className="public-work-card" key={item.id}><div className="public-work-photos">{item.image_paths.slice(0,3).map((path,index) => <button type="button" className="public-work-photo-button" key={`${item.id}-${path}-${index}`} aria-label={`Ver foto ${index + 1} de ${cleanTitle || item.category}`} onClick={() => { setLightboxWork(item); setLightboxIndex(index); }}><CachedImage path={path} alt={cleanTitle || item.category || "Trabajo de uñas terminado"} loading="lazy" decoding="async" /><span aria-hidden="true">⌕</span></button>)}{item.image_paths.length > 3 && <button type="button" className="public-work-more-photos" onClick={() => { setLightboxWork(item); setLightboxIndex(3); }} aria-label={`Ver las ${item.image_paths.length} fotos`}>+{item.image_paths.length - 3}</button>}{item.image_paths.length === 0 && <div className="public-work-no-photo" aria-label="Sin foto disponible">✧</div>}</div><div className="public-work-info"><span className="portfolio-work-category">{item.category}</span>{!sameAsCategory && <h3>{cleanTitle}</h3>}{item.description && <p>{item.description}</p>}<b className="public-work-business">{item.business_name}</b><small>{item.image_paths.length} {item.image_paths.length === 1 ? "foto" : "fotos"} · Trabajo publicado en Luni</small><button className="button-dark public-work-choose" type="button" onClick={() => chooseDesignForBooking(item)}>Elegir este diseño <span>↗</span></button></div></article>; })}</div> : <div className="public-work-empty work-no-results"><span>⌕</span><h3>No encontramos ese diseño</h3><p>Prueba con otra búsqueda o selecciona «Todas» las categorías.</p><button className="button-outline" type="button" onClick={() => { setWorkSearch(""); setWorkCategory("Todas"); }}>Limpiar filtros</button></div>}</> : <div className="public-work-empty"><span>✧</span><h3>Pronto habrá trabajos para descubrir</h3><p>Las publicaciones de las manicuristas aparecerán aquí.</p></div>}</section>}
      {homeSection === "services" && !selectedDesign && <>
      
      </>}
      {(homeSection === "providers" || homeSection === "services") && (loading ? <p className="empty-state">Cargando tus manicuristas…</p> :
        !sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Tu cartera empieza con una invitación</h3><p>Para proteger la privacidad, Luni no tiene un directorio público. Introduce el código de invitación que te comparta tu manicurista.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div>
        : providers.length === 0 && !(homeSection === "services" && selectedDesign) ? <div className="empty-appointments"><span>♡</span><h3>Aún no tienes manicuristas conectadas</h3><p>Pide a cada profesional su código de invitación. Cada cartera y su historial se mantienen independientes.</p></div>
        : <>
          {homeSection === "providers" && <div className="provider-portfolio-grid">{providers.map(p => <article className="provider-portfolio-card" key={p.id}>
            <div className="portfolio-card-main">
              <div className="portfolio-avatar studio-client-icon" aria-label={"Identidad de " + p.business_name}>{p.avatar_path ? <CachedImage className="provider-brand-logo" path={p.avatar_path} alt={"Logotipo de " + p.business_name} loading="lazy" /> : (p.brand_icon || "💅")}</div>
              <div className="portfolio-provider-info">
                <span className="portfolio-status">EN TU CARTERA</span>
                <h3>{p.business_name}</h3>
                <p className="portfolio-bio">{p.bio || "Tu espacio de belleza"}</p>
              </div>
              <button className="portfolio-remove" aria-label={"Quitar a " + p.business_name + " de tu cartera"} disabled={busy} onClick={async () => { if (!window.confirm("¿Quieres quitar a " + p.business_name + " de tu cartera? Tus citas anteriores seguirán en tu historial.")) return; setBusy(true); setError(""); try { await removeClientProvider(p.id); await loadCatalog(); setNotice("Manicurista quitada de tu cartera. El historial de citas se conserva."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo quitar la manicurista."); } finally { setBusy(false); } }}>Quitar</button>
            </div>
            {(p.business_phone || p.business_location) && <div className="portfolio-details">
              {p.business_phone && <a className="portfolio-detail" href={"tel:" + p.business_phone}><span>Teléfono</span><b>{p.business_phone}</b></a>}
              {p.business_location && <div className="portfolio-detail"><span>Ubicación</span><b>{p.business_location}</b></div>}
            </div>}
            {providerCodes[p.id] && <div className="provider-link-code">
              <div className="portfolio-share-code"><span>CÓDIGO PARA COMPARTIR</span><strong>{providerCodes[p.id]}</strong></div>
              <button type="button" onClick={async () => { const code = providerCodes[p.id]; const message = "Añade a " + p.business_name + " a tu cartera en Luni Cliente con el código de vinculación: " + code; try { if (navigator.share) await navigator.share({ title: "Código de " + p.business_name, text: message }); else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(message); setNotice("Código de " + p.business_name + " copiado para compartir."); } else window.prompt("Copia este mensaje para compartirlo:", message); } catch (e) { if (e instanceof Error && e.name !== "AbortError") window.prompt("Copia este mensaje para compartirlo:", message); } }}>Compartir código <span aria-hidden="true">↗</span></button>
            </div>}
          </article>)}</div>}
          {homeSection === "services" && <><div className="section-heading"><div><span className="eyebrow">{selectedDesign ? "TU DISEÑO SELECCIONADO" : "SERVICIOS DE TU CARTERA"}</span><h2>{selectedDesign ? <>Completa tu <em>reserva.</em></> : <>Reserva tu <em>próximo momento.</em></>}</h2></div><span className="service-count">{filteredServices.length} {filteredServices.length === 1 ? "servicio" : "servicios"}</span></div>{!selectedDesign && <label className="search-box service-search-box"><span>⌕</span><input value={search} onChange={e => { setSearch(e.target.value); setServicePage(1); setServiceCategoryFilter("Todas"); }} placeholder="Buscar entre tus servicios..." aria-label="Buscar servicios" /></label>}{selectedDesign && <article className="selected-design-flow"><div className="selected-design-flow-photo">{selectedDesign.image_paths[0] ? <CachedImage path={selectedDesign.image_paths[0]} alt={selectedDesign.title || selectedDesign.category} loading="lazy" decoding="async" /> : <span aria-hidden="true">✧</span>}</div><div className="selected-design-flow-body"><span className="eyebrow">DISEÑO GUARDADO PARA TU CITA</span><h3>{selectedDesign.title.trim() && selectedDesign.title.trim().toLocaleLowerCase("es-CU") !== selectedDesign.category.trim().toLocaleLowerCase("es-CU") ? selectedDesign.title : selectedDesign.category}</h3><p className="selected-design-studio">{selectedDesign.business_name}</p>{selectedDesign.description && <p>{selectedDesign.description}</p>}<p className="selected-design-next-step">{providers.some(provider => provider.id === selectedDesign.provider_id) ? "Paso siguiente: elige uno de los servicios de esta manicurista. El diseño seguirá adjunto a la solicitud." : "Para reservar con esta manicurista, primero debes añadirla a tu cartera. Tu diseño ya está guardado."}</p>{!providers.some(provider => provider.id === selectedDesign.provider_id) && <button className="button-dark" type="button" onClick={() => { setHomeSection("providers"); setSearch(""); }}>Ir a Mis manicuristas y vincularla <span>↗</span></button>}<button className="selected-design-change" type="button" onClick={() => { setSelectedDesign(null); setHomeSection("inspiration"); setSearch(""); setNotice("Puedes elegir otro diseño desde Inspiración."); }}>Elegir otro diseño</button></div></article>}{activeAppointment && <div className="provider-notice" role="status">Ya tienes una cita {activeAppointment.status === "confirmed" ? "confirmada" : "pendiente de confirmar"} para {formatChosen(activeAppointment.starts_at)}. No puedes reservar otra mientras siga activa. Puedes modificar la fecha y hora desde «Mis citas» o cancelar esta cita.</div>}
          <div className="service-category-filters" role="group" aria-label="Filtrar servicios por tipo">
            <button type="button" className={serviceCategoryFilter === "Todas" ? "service-category-chip active" : "service-category-chip"} aria-pressed={serviceCategoryFilter === "Todas"} onClick={() => { setServiceCategoryFilter("Todas"); setServicePage(1); }}>Todos los tipos <span>{visible.length}</span></button>
            {availableServiceCategories.map(category => {
              const count = visible.filter(service => categoryOfService(service) === category).length;
              return <button type="button" key={category} className={serviceCategoryFilter === category ? "service-category-chip active" : "service-category-chip"} aria-pressed={serviceCategoryFilter === category} onClick={() => { setServiceCategoryFilter(category); setServicePage(1); }}>{category} <span>{count}</span></button>;
            })}
          </div>
          {groupedServices.map(group => <section className="service-category-section" key={group.category}>
            <header className="service-category-heading">
              <div><span className="eyebrow">CATÁLOGO POR TIPO</span><h3>{group.category}</h3></div>
              <span>{group.items.length} {group.items.length === 1 ? "servicio" : "servicios"} en esta página</span>
            </header>
            <div className="service-grid">{group.items.map(service => <article className="service-card" key={service.id}>
              <div className={"service-art " + service.tone}>
                {service.card_path && <CachedImage className="service-photo" path={service.card_path} alt="" loading="lazy" decoding="async" onLoad={e => e.currentTarget.classList.add("loaded")} />}
                <div className="nail-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
              </div>
              <div className="service-info">
                <span className="service-category-label">{group.category}</span>
                <h3>{service.name}</h3>
                <p>{service.description || service.providerName}<br/><b><span className="studio-card-icon">{service.providerLogoPath ? <CachedImage className="provider-brand-logo small" path={service.providerLogoPath} alt="" loading="lazy" /> : service.providerIcon}</span> {service.providerName}</b></p>
                <div className="service-meta"><span>◷ {service.duration_minutes} min</span><b>{money(service.price_cents, service.currency)}</b></div>
                <button className="button-outline" disabled={!!activeAppointment} title={activeAppointment ? "Ya tienes una cita activa; modifica o cancela esa cita primero." : "Reservar este servicio"} onClick={() => { if (activeAppointment) return; setReschedulingAppointmentId(null); setSelectedDesign(prev => prev && prev.provider_id === service.provider_id ? prev : null); setSelected(service); setError(""); }}>
                  {activeAppointment ? "Ya tienes una cita activa" : selectedDesign && selectedDesign.provider_id === service.provider_id ? "Reservar con este diseño" : "Reservar este servicio"} <span>↗</span>
                </button>
              </div>
            </article>)}</div>
          </section>)}
          {totalServicePages > 1 && <nav className="service-pagination" aria-label="Páginas de servicios">
            <span>Página {currentServicePage} de {totalServicePages}</span>
            <button type="button" disabled={currentServicePage <= 1} onClick={() => setServicePage(page => Math.max(1, page - 1))}>Anterior</button>
            {Array.from({ length: totalServicePages }, (_, index) => index + 1).map(page => <button type="button" key={page} className={page === currentServicePage ? "active" : ""} aria-current={page === currentServicePage ? "page" : undefined} aria-label={"Página " + page} onClick={() => setServicePage(page)}>{page}</button>)}
            <button type="button" disabled={currentServicePage >= totalServicePages} onClick={() => setServicePage(page => Math.min(totalServicePages, page + 1))}>Siguiente</button>
          </nav>}
          {visible.length === 0 && <div className="empty-state selected-design-no-services">{selectedDesign ? providers.some(provider => provider.id === selectedDesign.provider_id) ? <>Esta manicurista todavía no tiene servicios publicados en tu cartera o no hay servicios disponibles. El diseño sigue guardado. <button type="button" className="button-outline" onClick={() => { setSelectedDesign(null); setHomeSection("inspiration"); }}>Volver a Inspiración</button></> : <>El diseño se conserva aquí, pero primero debes vincular a {selectedDesign.business_name}. <button type="button" className="button-outline" onClick={() => setHomeSection("providers")}>Ir a Mis manicuristas</button></> : "No encontramos servicios con ese nombre en tus carteras."}</div>}</>}
        </>)}
    </section>}

    {tab === "citas" && <section className="simple-page"><span className="eyebrow">TU AGENDA PERSONAL</span><h1>Mis <em>citas.</em></h1>{sessionEmail && <div className="section-tabs" role="tablist" aria-label="Filtrar citas"><button type="button" role="tab" aria-selected={appointmentSection === "upcoming"} className={appointmentSection === "upcoming" ? "section-tab active" : "section-tab"} onClick={() => setAppointmentSection("upcoming")}>Próximas <span>{upcomingAppointments.length}</span></button><button type="button" role="tab" aria-selected={appointmentSection === "history"} className={appointmentSection === "history" ? "section-tab active" : "section-tab"} onClick={() => setAppointmentSection("history")}>Historial <span>{historyAppointments.length}</span></button></div>}{!sessionEmail ? <div className="empty-appointments"><span>♡</span><h3>Inicia sesión para ver tus citas</h3><p>Las reservas se guardan en tu cuenta de Luni.</p><button className="button-dark" onClick={() => setTab("perfil")}>Iniciar sesión <span>↗</span></button></div> : appointments.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>Tu próximo momento empieza aquí</h3><p>Aún no tienes citas. Explora los servicios disponibles.</p><button className="button-dark" onClick={() => setTab("inicio")}>Descubrir servicios <span>↗</span></button></div> : visibleAppointments.length === 0 ? <div className="empty-appointments"><span>♡</span><h3>{appointmentSection === "upcoming" ? "No tienes citas próximas" : "Tu historial está vacío"}</h3><p>{appointmentSection === "upcoming" ? "Cuando reserves un servicio, aparecerá aquí." : "Las citas anteriores, canceladas o completadas aparecerán aquí."}</p>{appointmentSection === "upcoming" && <button className="button-dark" onClick={() => setTab("inicio")}>Ver mis manicuristas <span>↗</span></button>}</div> : visibleAppointments.map(renderAppointment)}</section>}

    {tab === "perfil" && <section className="simple-page"><span className="eyebrow">TU ESPACIO LUNI</span><h1>{sessionName ? <>Hola, <em>{sessionName.split(" ")[0]}.</em></> : <>Mi <em>perfil.</em></>}</h1>{sessionEmail ? <div className="profile-panel"><div className="profile-avatar">{(sessionName || sessionEmail)[0].toUpperCase()}</div><div><h3>{sessionName || sessionEmail}</h3><p>{sessionName ? sessionEmail : "Sesión iniciada"}</p></div><button className="button-outline" onClick={async () => { setBusy(true); try { if (!confirmSignOut()) return; await signOut(); setAppointments([]); setSessionEmail(""); setNotice("Sesión cerrada."); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cerrar sesión."); } finally { setBusy(false); } }} disabled={busy}>Cerrar sesión</button></div> : <AuthPanel onError={setError} onNotice={setNotice} onSignedIn={async kind => {
          await refreshAppointments();
          if (selectedDesign) {
            await loadCatalog();
            setSearch("");
            setTab("inicio");
            setHomeSection("services");
            setNotice(`Tu diseño de ${selectedDesign.business_name} sigue seleccionado. Ya puedes continuar desde aquí; si aún no has añadido a esta manicurista, usa el botón para vincularla.`);
          } else if (kind === "signup") setTab("inicio");
        }} />}<p className="muted offline-note">Necesitas conexión a internet para ver horarios y reservar.</p></section>}

    <footer className="client-footer"><div className="brand-lockup"><div className="brand-mark small-mark">l<span>✦</span></div><div><div className="brand-name">luni</div><div className="brand-sub">TU MOMENTO, TU ESTILO</div></div></div><span>Hecho con cariño ♡</span></footer>

    {lightboxWork && <div className="design-lightbox-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setLightboxWork(null); }}><section className="design-lightbox" role="dialog" aria-modal="true" aria-label={`Fotos del trabajo ${lightboxWork.title || lightboxWork.category}`}><button type="button" className="design-lightbox-close" aria-label="Cerrar fotos" onClick={() => setLightboxWork(null)}>×</button><div className="design-lightbox-image">{lightboxWork.image_paths[lightboxIndex] ? <CachedImage path={lightboxWork.image_paths[lightboxIndex]} alt={`${lightboxWork.title || lightboxWork.category}, foto ${lightboxIndex + 1}`} decoding="async" /> : <div className="public-work-no-photo">No hay foto disponible</div>}{lightboxWork.image_paths.length > 1 && <><button type="button" className="design-lightbox-arrow previous" aria-label="Foto anterior" onClick={() => setLightboxIndex(index => (index - 1 + lightboxWork.image_paths.length) % lightboxWork.image_paths.length)}>‹</button><button type="button" className="design-lightbox-arrow next" aria-label="Foto siguiente" onClick={() => setLightboxIndex(index => (index + 1) % lightboxWork.image_paths.length)}>›</button></>}</div><div className="design-lightbox-caption"><div><span className="portfolio-work-category">{lightboxWork.category}</span><h2>{lightboxWork.title && lightboxWork.title.trim().toLocaleLowerCase("es-CU") !== lightboxWork.category.trim().toLocaleLowerCase("es-CU") ? lightboxWork.title : lightboxWork.category}</h2><p>{lightboxWork.business_name}{lightboxWork.description ? ` · ${lightboxWork.description}` : ""}</p><small>{lightboxIndex + 1} de {lightboxWork.image_paths.length} {lightboxWork.image_paths.length === 1 ? "foto" : "fotos"}</small></div><button type="button" className="button-dark" onClick={() => { const item = lightboxWork; setLightboxWork(null); chooseDesignForBooking(item); }}>Elegir este diseño <span>↗</span></button></div></section></div>}
    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="modal-close" aria-label="Cerrar" onClick={() => { setSelected(null); setReschedulingAppointmentId(null); }}>×</button><span className="eyebrow">{reschedulingAppointmentId ? "MODIFICA TU CITA" : "TU PRÓXIMO MOMENTO"}</span><h2 id="booking-title">{reschedulingAppointmentId ? <>Cambia tu <em>horario.</em></> : <>Reserva tu <em>espacio.</em></>}</h2><div className="selected-service"><div className={"mini-service-art " + selected.tone}>{selected.thumb_path ? <CachedImage className="service-photo loaded" path={selected.thumb_path} alt="" /> : "✿"}</div><div><b>{selected.name}</b><small><span className="studio-card-icon">{selected.providerLogoPath ? <CachedImage className="provider-brand-logo small" path={selected.providerLogoPath} alt="" /> : selected.providerIcon}</span> {selected.providerName} · {selected.duration_minutes} min</small><small>{money(selected.price_cents, selected.currency)}</small></div></div>{selectedDesign && selectedDesign.provider_id === selected.provider_id && !reschedulingAppointmentId && <div className="booking-design-selected"><div className="booking-design-thumb">{selectedDesign.image_paths[0] ? <CachedImage path={selectedDesign.image_paths[0]} alt="" /> : <span aria-hidden="true">✧</span>}</div><div><span className="eyebrow">DISEÑO ADJUNTO</span><b>{selectedDesign.title.trim() && selectedDesign.title.trim().toLocaleLowerCase("es-CU") !== selectedDesign.category.trim().toLocaleLowerCase("es-CU") ? selectedDesign.title : selectedDesign.category}</b><small>{selectedDesign.business_name} · Se enviará junto con la solicitud</small></div></div>}<div className="field-label" role="group" aria-labelledby="day-label"><span id="day-label">Elige un día</span>
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
        <label className="field-label">Teléfono de contacto <input type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Ej. +53 5XXXXXXX" autoComplete="tel" required /></label><p className="muted">La manicurista utilizará este número para contactarte sobre tu cita.</p><p className="booking-disclaimer">{reschedulingAppointmentId ? "Se cambiará la fecha y hora de la misma cita; no se creará una segunda reserva." : "Solo ves horarios que están libres ahora mismo. Tu solicitud queda pendiente hasta que el estudio la confirme."}</p><button className="button-dark full-button" disabled={busy || !net.online || !slot || (!reschedulingAppointmentId && clientPhone.trim().replace(/[^0-9]/g, "").length < 7)} onClick={() => void submitBooking()}>{busy ? (reschedulingAppointmentId ? "Modificando…" : "Enviando…") : !net.online ? "Sin conexión" : !slot ? "Elige una hora" : (!reschedulingAppointmentId && clientPhone.trim().replace(/[^0-9]/g, "").length < 7) ? "Añade tu teléfono" : reschedulingAppointmentId ? "Guardar cambios" : "Enviar solicitud"} <span>↗</span></button>{!sessionEmail && <p className="muted">Debes iniciar sesión. Puedes hacerlo desde “Mi perfil” sin perder el servicio seleccionado.</p>}</section></div>}
  </main>;
}
