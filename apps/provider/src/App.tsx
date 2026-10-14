import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AuthPanel from "./AuthPanel";
import ScheduleEditor from "./ScheduleEditor";
import { CachedImage } from "@lumi/ui/CachedImage";
import ManualTurnsEditor from "./ManualTurnsEditor";
import LicenseRenewal from "./LicenseRenewal";
import AdminLicenses from "./AdminLicenses";
import AdminRoles from "./AdminRoles";
import ColorMixer from "./ColorMixer";
import { processImageLocally, type ProcessedImageSet } from "@lumi/image-processor";
import {
  getIsAdmin,
  friendlyError,
  getOfflineStatus,
  onReconnect,
  subscribeOfflineStatus,
  dismissConflicts,
  offlineBannerText,
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
  type PortfolioItem,
  listMyPortfolio,
  savePortfolioItem,
  deletePortfolioItem,
  getSupabaseClient,
  SERVICE_CATEGORIES,
  inferServiceCategory,
} from "@lumi/api";

type Tab = "agenda" | "servicios" | "trabajos" | "clientes" | "colores" | "perfil";
const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
const licenseText: Record<string, string> = {
  trial: "Prueba gratuita", active: "Activa", grace: "En periodo de gracia", expired: "Vencida", suspended: "Suspendida"
};

const statusText: Record<string, string> = {
  pending_confirmation: "Por confirmar", confirmed: "Confirmada", cancelled: "Cancelada",
  rejected: "Rechazada", completed: "Completada"
};
const BRAND_ICONS = ["💅", "🌸", "✨", "🌷", "🦋", "💎", "🌺", "🤍", "🎀", "🌿", "⭐", "👑"];

// La agenda usa la fecha civil del estudio, no la fecha UTC del servidor.
function dateKeyInTimeZone(timeZone = "America/Havana", date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function appointmentDesign(notes: string) {
  if (!notes.startsWith("DISEÑO ELEGIDO POR LA CLIENTA")) return null;
  const value = (label: string) => notes.match(new RegExp("^" + label + ": (.*)$", "m"))?.[1] ?? "";
  return { title: value("Trabajo"), category: value("Categoría"), imagePath: value("Foto"), publicationId: value("Publicación Luni") };
}

const STARTER_NAIL_CATALOG: Array<{ name: string; description: string; price: number; minutes: number }> = [
  { name: "Uñas nuevas · cortas", description: "Manicura · Uñas nuevas · Largo corto", price: 1500, minutes: 90 },
  { name: "Uñas nuevas · medianas", description: "Manicura · Uñas nuevas · Largo mediano", price: 2000, minutes: 100 },
  { name: "Uñas nuevas · largas", description: "Manicura · Uñas nuevas · Largo largo", price: 2500, minutes: 110 },
  { name: "Uñas nuevas · extralargas", description: "Manicura · Uñas nuevas · Largo extralargo", price: 3000, minutes: 120 },
  { name: "Uñas naturales · gel · cortas", description: "Manicura · Uñas naturales · Gel · Cortas", price: 300, minutes: 45 },
  { name: "Uñas naturales · rubber · cortas", description: "Manicura · Uñas naturales · Rubber · Cortas", price: 800, minutes: 45 },
  { name: "Uñas naturales · acrílico · cortas", description: "Manicura · Uñas naturales · Acrílico · Cortas", price: 1300, minutes: 60 },
  { name: "Uñas naturales · gel · largas", description: "Manicura · Uñas naturales · Gel · Largas", price: 500, minutes: 45 },
  { name: "Uñas naturales · rubber · largas", description: "Manicura · Uñas naturales · Rubber · Largas", price: 1000, minutes: 50 },
  { name: "Uñas naturales · acrílico · largas", description: "Manicura · Uñas naturales · Acrílico · Largas", price: 1500, minutes: 60 },
  { name: "Relleno básico", description: "Manicura · Relleno · Incluye pintura y decoración extremadamente sencilla", price: 1300, minutes: 75 },
  { name: "Relleno completo", description: "Manicura · Relleno · Incluye pintura y decoración extremadamente sencilla", price: 1500, minutes: 80 },
  { name: "Relleno de uñas muy deterioradas", description: "Manicura · Relleno · Uñas muy deterioradas · Incluye pintura y decoración sencilla", price: 1800, minutes: 90 },
  { name: "Efecto ojo de gato / aurora", description: "Manicura · Diseño · Precio por pareja de uñas; extralargas +100 CUP", price: 150, minutes: 15 },
  { name: "Efecto espejo / azúcar", description: "Manicura · Diseño · Precio por pareja de uñas; extralargas +100 CUP", price: 100, minutes: 15 },
  { name: "Baby boomer / difuminado / cover", description: "Manicura · Diseño · Precio por pareja de uñas; extralargas +100 CUP", price: 200, minutes: 20 },
  { name: "Encapsulado", description: "Manicura · Diseño · Precio por pareja de uñas; extralargas +100 CUP", price: 150, minutes: 20 },
  { name: "Relieve · pareja de flores", description: "Manicura · Decoración · Precio por pareja de flores", price: 100, minutes: 15 },
  { name: "Relieve en gel · pareja de flores", description: "Manicura · Decoración · Precio por pareja de flores", price: 200, minutes: 20 },
  { name: "Cromados", description: "Manicura · Decoración · Precio configurable según diseño (referencia 100–200 CUP)", price: 100, minutes: 15 },
  { name: "Joyería", description: "Manicura · Decoración · Precio configurable según pieza (referencia 150–300 CUP)", price: 150, minutes: 15 },
  { name: "Decoración con piedras", description: "Manicura · Decoración · Precio configurable según diseño (referencia 50–300 CUP)", price: 50, minutes: 15 },
  { name: "Calcomanías", description: "Manicura · Decoración", price: 50, minutes: 10 },
  { name: "Pedicura · cover en todas las uñas", description: "Pedicura · Uñas nuevas · Incluye pintura", price: 1000, minutes: 60 },
  { name: "Pedicura · relleno cover en todas", description: "Pedicura · Relleno cover en todas las uñas", price: 500, minutes: 40 },
  { name: "Pedicura · cover en una uña", description: "Pedicura · Uñas nuevas · Incluye pintura", price: 800, minutes: 45 },
  { name: "Pedicura · relleno cover en una", description: "Pedicura · Relleno cover en una uña", price: 400, minutes: 30 },
  { name: "Pedicura · acripie", description: "Pedicura · Uñas nuevas · Incluye pintura", price: 800, minutes: 45 },
  { name: "Pedicura · relleno acripie", description: "Pedicura · Relleno acripie", price: 400, minutes: 30 },
  { name: "Pedicura · uña principal", description: "Pedicura · Uñas nuevas · Incluye pintura", price: 500, minutes: 35 },
  { name: "Pedicura · relleno uña principal", description: "Pedicura · Relleno uña principal", price: 250, minutes: 20 },
  { name: "Pedicura · pintura de gel natural", description: "Pedicura · Uñas naturales", price: 300, minutes: 30 },
  { name: "Pedicura · rubber base natural", description: "Pedicura · Uñas naturales", price: 500, minutes: 35 },
];


export default function App() {
  const [tab, setTab] = useState<Tab>("agenda");
  const [agendaSection, setAgendaSection] = useState<"all" | "pending" | "confirmed" | "completed">("all");
  const [agendaView, setAgendaView] = useState<"day" | "week">("day");
  const [agendaSearch, setAgendaSearch] = useState("");
  const [showAgendaSearch, setShowAgendaSearch] = useState(false);
  const [expandedAppointment, setExpandedAppointment] = useState<string | null>(null);
  const [showManualAppointment, setShowManualAppointment] = useState(false);
  const [editingAgendaAppointment, setEditingAgendaAppointment] = useState<string | null>(null);
  const [editAppointmentDateTime, setEditAppointmentDateTime] = useState("");
  const [editAppointmentNotes, setEditAppointmentNotes] = useState("");
  const [manualClientId, setManualClientId] = useState("");
  const [manualClientMode, setManualClientMode] = useState<"existing" | "new">("existing");
  const [manualNewClientName, setManualNewClientName] = useState("");
  const [manualNewClientPhone, setManualNewClientPhone] = useState("");
  const [manualServiceId, setManualServiceId] = useState("");
  const [manualDateTime, setManualDateTime] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [profileSection, setProfileSection] = useState<"business" | "license" | "schedule" | "account">("business");
  const [portfolioFilter, setPortfolioFilter] = useState("Todas");
  const [sessionEmail, setSessionEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<"licenses" | "roles" | "account">("licenses");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [appointments, setAppointments] = useState<ProviderAppointment[]>([]);
  const [zoomDesign, setZoomDesign] = useState<{ path: string; title: string; category: string } | null>(null);
  const [clients, setClients] = useState<ProviderClient[]>([]);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [workTitle, setWorkTitle] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [workCategory, setWorkCategory] = useState("Diseños");
  const [workPhotos, setWorkPhotos] = useState<File[]>([]);
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null);
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setErrorRaw] = useState("");
  const setError = useCallback((message: string) => setErrorRaw(friendlyError(message)), []);
  const net = useSyncExternalStore(subscribeOfflineStatus, getOfflineStatus);
  const bannerText = offlineBannerText(net);
  // Cerrar sesión borra lo guardado en el teléfono, incluidos los cambios que aún no se enviaron.
  const confirmSignOut = () => net.pending === 0 || window.confirm("Tienes " + net.pending + (net.pending === 1 ? " cambio" : " cambios") + " sin enviar. Si cierras sesión se perderán. ¿Cerrar sesión de todos modos?");
  const [notice, setNotice] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
  const [editBusinessName, setEditBusinessName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editBusinessPhone, setEditBusinessPhone] = useState("");
  const [editBusinessLocation, setEditBusinessLocation] = useState("");
  const [newBrandIcon, setNewBrandIcon] = useState("💅");
  const [brandLogoFile, setBrandLogoFile] = useState<File | null>(null);
  const [brandLogoPreview, setBrandLogoPreview] = useState<string | null>(null);
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
  const [serviceCatalogCategoryFilter, setServiceCatalogCategoryFilter] = useState<string>("Todas");
  const [serviceCatalogPages, setServiceCatalogPages] = useState<Record<string, number>>({});
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceCategory, setServiceCategory] = useState<string>("Manicura");
  const [servicePrice, setServicePrice] = useState("800");
  const [serviceDuration, setServiceDuration] = useState("45");
  const [day, setDay] = useState(dateKeyInTimeZone("America/Havana"));

  const refresh = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    if (!session) {
      setIsAdmin(false);
      setProfile(null); setServices([]); setAppointments([]); setClients([]); setPortfolioItems([]); setInviteLink("");
      return;
    }
    setIsAdmin(await getIsAdmin().catch(() => false));
    const currentProfile = await getMyProviderProfile();
    setProfile(currentProfile);
    setEditBusinessName(currentProfile?.business_name ?? "");
    setEditBio(currentProfile?.bio ?? "");
    setEditBusinessPhone(currentProfile?.business_phone ?? "");
    setEditBusinessLocation(currentProfile?.business_location ?? "");
    if (!currentProfile) {
      setServices([]); setAppointments([]); setClients([]); setPortfolioItems([]);
      return;
    }
    const [serviceRows, appointmentRows, clientRows, portfolioRows, invite] = await Promise.all([
      listMyProviderServices(currentProfile.id),
      listProviderAppointments(currentProfile.id),
      listProviderClients(currentProfile.id),
      listMyPortfolio(currentProfile.id),
      createProviderInvite(currentProfile.id).catch(() => null),
    ]);
    setInviteLink(invite?.token ?? "");
    setServices(serviceRows);
    // El cobro se consulta por separado para mantener compatibilidad con la RPC de agenda.
    let paymentRows: Array<{ id: string; payment_received: boolean }> = [];
    if (appointmentRows.length && net.online) {
      const paymentResult = await getSupabaseClient().from("appointments").select("id,payment_received").in("id", appointmentRows.map(a => a.id));
      if (!paymentResult.error) paymentRows = (paymentResult.data ?? []) as Array<{ id: string; payment_received: boolean }>;
    }
    const paidById = new Map(paymentRows.map(row => [row.id, row.payment_received]));
    setAppointments(appointmentRows.map(a => ({ ...a, payment_received: paidById.get(a.id) ?? a.payment_received ?? false })));
    setClients(clientRows);
    setPortfolioItems(portfolioRows);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setError("Falta configurar la URL y la clave pública de Supabase en apps/provider/.env.");
      setLoading(false);
      return;
    }
    void refresh().then(() => setLoadFailed(false)).catch(e => { setLoadFailed(true); setError(e instanceof Error ? e.message : "No se pudo conectar. Revisa tu conexión a internet."); })
      .finally(() => setLoading(false));
    return onAuthStateChange(() => {
      void refresh().then(() => setLoadFailed(false)).catch(e => setError(e instanceof Error ? e.message : "No se pudo actualizar la cuenta."));
    });
  }, [refresh]);

  // Al recuperar la red se vuelve a pedir todo, sin que haya que reabrir la app.
  useEffect(() => onReconnect(() => { void refresh().then(() => setLoadFailed(false)).catch(() => undefined); }), [refresh]);

  const weekStart = useMemo(() => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }, [day]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }), [weekStart]);
  const filteredAppointments = useMemo(() => appointments.filter(a => a.starts_at.slice(0, 10) === day), [appointments, day]);
  const agendaAppointments = useMemo(() => filteredAppointments.filter(a => {
    if (agendaSection === "pending" && a.status !== "pending_confirmation") return false;
    if (agendaSection === "confirmed" && a.status !== "confirmed") return false;
    if (agendaSection === "completed" && a.status !== "completed") return false;
    const query = agendaSearch.trim().toLocaleLowerCase("es");
    return !query || [a.client_display_name, a.client_phone, a.client_service_name].some(v => (v ?? "").toLocaleLowerCase("es").includes(query));
  }).sort((a,b) => a.starts_at.localeCompare(b.starts_at)), [filteredAppointments, agendaSection, agendaSearch]);
  const weekAppointments = useMemo(() => appointments.filter(a => weekDays.includes(a.starts_at.slice(0, 10)) && (
    !agendaSearch.trim() || [a.client_display_name, a.client_phone, a.client_service_name].some(v => (v ?? "").toLocaleLowerCase("es").includes(agendaSearch.trim().toLocaleLowerCase("es")))
  )).sort((a,b) => a.starts_at.localeCompare(b.starts_at)), [appointments, weekDays, agendaSearch]);
  const knownAgendaClients = useMemo(() => Array.from(new Map(appointments.filter(a => a.client_id && a.client_display_name).map(a => [a.client_id, { id: a.client_id, name: a.client_display_name || "Clienta", phone: a.client_phone || "" }] as const)).values()), [appointments]);
  const expectedIncome = filteredAppointments.filter(a => a.status === "confirmed" || a.status === "pending_confirmation").reduce((sum,a) => sum + a.client_price_cents, 0);
  const collectedIncome = filteredAppointments.filter(a => a.status === "completed" && a.payment_received).reduce((sum,a) => sum + a.client_price_cents, 0);
  const unpaidIncome = filteredAppointments.filter(a => a.status === "completed" && !a.payment_received).reduce((sum,a) => sum + a.client_price_cents, 0);
  const activeServices = useMemo(() => services.filter(s => s.is_active), [services]);
  const serviceCatalogCategories = useMemo(() => {
    const present = new Set(activeServices.map(s => s.category?.trim() || inferServiceCategory(s.name, s.description)));
    return [
      ...SERVICE_CATEGORIES.filter(category => present.has(category)),
      ...Array.from(present).filter(category => !(SERVICE_CATEGORIES as readonly string[]).includes(category)).sort((a,b) => a.localeCompare(b, "es")),
    ];
  }, [activeServices]);
  const groupedActiveServices = useMemo(() => {
    const categories = serviceCatalogCategoryFilter === "Todas"
      ? serviceCatalogCategories
      : serviceCatalogCategories.filter(category => category === serviceCatalogCategoryFilter);
    return categories.map(category => {
      const items = activeServices.filter(s => (s.category?.trim() || inferServiceCategory(s.name, s.description)) === category);
      const totalPages = Math.max(1, Math.ceil(items.length / 6));
      const page = Math.min(Math.max(1, serviceCatalogPages[category] ?? 1), totalPages);
      return { category, items, totalPages, page, pageItems: items.slice((page - 1) * 6, page * 6) };
    }).filter(group => group.items.length > 0);
  }, [activeServices, serviceCatalogCategories, serviceCatalogCategoryFilter, serviceCatalogPages]);
  useEffect(() => {
    setServiceCatalogPages({});
    if (serviceCatalogCategoryFilter !== "Todas" && !serviceCatalogCategories.includes(serviceCatalogCategoryFilter)) {
      setServiceCatalogCategoryFilter("Todas");
    }
  }, [serviceCatalogCategories, serviceCatalogCategoryFilter]);
  const portfolioCategories = useMemo(() => ["Todas", ...Array.from(new Set(portfolioItems.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"))], [portfolioItems]);
  const filteredPortfolioItems = useMemo(() => portfolioFilter === "Todas" ? portfolioItems : portfolioItems.filter(item => item.category === portfolioFilter), [portfolioItems, portfolioFilter]);
  const pendingCount = appointments.filter(a => a.status === "pending_confirmation").length;

  const saveAppointmentApprovalMode = async (autoConfirm: boolean) => {
    if (!profile || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error } = await getSupabaseClient().from("provider_profiles")
        .update({ auto_confirm_appointments: autoConfirm }).eq("id", profile.id).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("No se pudo guardar la preferencia de citas.");
      setProfile(prev => prev ? { ...prev, auto_confirm_appointments: autoConfirm } : prev);
      setNotice(autoConfirm
        ? "Aprobación automática activada. Las nuevas citas se confirmarán al reservar."
        : "Aprobación manual activada. Las nuevas citas quedarán pendientes hasta que las confirmes.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la preferencia."); }
    finally { setBusy(false); }
  };

  const createProfile = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await createMyProviderProfile(businessName, bio, newBrandIcon);
      let logoNotice = "";
      if (brandLogoFile) {
        let uploadedPath: string | null = null;
        try {
          const processed = await processImageLocally(brandLogoFile);
          const image = processed.variants.find(v => v.variant === "card") ?? processed.variants[0];
          if (!image) throw new Error("No se pudo preparar el logotipo.");
          const ext = image.file.type === "image/webp" ? "webp" : "jpg";
          uploadedPath = created.id + "/brand/" + image.sha256.slice(0, 16) + "-" + crypto.randomUUID().slice(0, 8) + "-logo." + ext;
          const { error: uploadError } = await getSupabaseClient().storage.from("service-images")
            .upload(uploadedPath, image.file, { upsert: false, contentType: image.file.type, cacheControl: "31536000" });
          if (uploadError) throw new Error(uploadError.message);
          const { error: updateError } = await getSupabaseClient().from("provider_profiles")
            .update({ avatar_path: uploadedPath }).eq("id", created.id);
          if (updateError) throw new Error(updateError.message);
          created.avatar_path = uploadedPath;
          setBrandLogoFile(null);
          setBrandLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
        } catch (logoError) {
          if (uploadedPath) await getSupabaseClient().storage.from("service-images").remove([uploadedPath]);
          logoNotice = " El estudio se creó, pero el logotipo no se guardó: " + (logoError instanceof Error ? logoError.message : "inténtalo desde Mi negocio.");
        }
      }
      setProfile(created);
      setNotice("Estudio registrado. Añade servicios para completar tu catálogo." + logoNotice);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar el estudio."); }
    finally { setBusy(false); }
  };


  const loadStarterCatalog = async () => {
    if (!profile || busy) return;
    setBusy(true); setError(""); setNotice("");
    let created = 0;
    let skipped = 0;
    try {
      // Completa el catálogo sin duplicar servicios ya existentes ni sobrescribir sus precios.
      const existingNames = new Set(services.map(s => s.name.trim().toLocaleLowerCase("es")));
      for (const item of STARTER_NAIL_CATALOG) {
        if (existingNames.has(item.name.trim().toLocaleLowerCase("es"))) {
          skipped++;
          continue;
        }
        await saveProviderService({
          providerId: profile.id,
          name: item.name,
          description: item.description,
          category: inferServiceCategory(item.name, item.description),
          priceCents: Math.round(item.price * 100),
          currency: "CUP",
          durationMinutes: item.minutes,
        });
        created++;
      }
      await refresh();
      setNotice(created > 0
        ? `Catálogo completado: se añadieron ${created} servicios y se conservaron ${skipped} existentes. Revisa y ajusta los precios a tus tarifas reales.`
        : `No faltan servicios del catálogo inicial: se encontraron ${skipped}. Tus precios actuales no se modificaron.`);
    } catch (e) {
      await refresh().catch(() => undefined);
      setError(`Se añadieron ${created} servicios antes del error. Puedes volver a completar los que falten. ${e instanceof Error ? e.message : "No se pudo completar la carga."}`);
    } finally { setBusy(false); }
  };

  const createService = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const price = Number(servicePrice.replace(",", "."));
      const duration = Number(serviceDuration);
      if (!Number.isFinite(price) || price < 0) throw new Error("Escribe un precio válido.");
      const { id: serviceId, queued: serviceQueued } = await saveProviderService({
        providerId: profile.id,
        id: editingServiceId ?? undefined,
        name: serviceName,
        description: serviceDescription,
        category: serviceCategory,
        priceCents: Math.round(price * 100),
        currency: "CUP",
        durationMinutes: duration,
      });
      // El servicio ya está guardado; la foto va después para que una conexión lenta nunca pierda los datos.
      let photoProblem = "";
      let photoQueued = false;
      try {
        if (photo) photoQueued = (await setServiceImage(profile.id, serviceId, photo.set, p => setPhotoInfo(`Subiendo foto (${Math.min(p.done + 1, p.total)} de ${p.total})…`))).queued;
        else if (removePhoto) photoQueued = (await clearServiceImage(profile.id, serviceId)).queued;
      } catch (e) { photoProblem = e instanceof Error ? e.message : "No se pudo subir la foto."; }
      setShowServiceForm(false); setEditingServiceId(null); setServiceName(""); setServiceDescription(""); setServiceCategory("Manicura"); resetPhoto();
      await refresh();
      if (photoProblem) setNotice(`Servicio guardado, pero la foto no se subió: ${photoProblem} Ábrelo con «Editar» para reintentar.`);
      else if (serviceQueued || photoQueued) setNotice("Guardado en este teléfono" + (photo ? ", con su foto" : "") + ". Se enviará cuando haya conexión.");
      else setNotice("Servicio guardado.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el servicio."); }
    finally { setBusy(false); }
  };

  const createPortfolioPost = async () => {
    if (!profile) return;
    setBusy(true); setError(""); setNotice("");
    const uploadedPaths: string[] = [];
    let itemId = editingWorkId;
    try {
      const old = editingWorkId ? portfolioItems.find(item => item.id === editingWorkId) : undefined;
      if (workPhotos.length + (old?.image_paths.length ?? 0) > 6) throw new Error("Cada publicación admite un máximo de 6 fotos en total.");
      if (!old && workPhotos.length === 0) throw new Error("Añade al menos una foto del trabajo terminado.");
      if (!itemId) itemId = await savePortfolioItem({ providerId: profile.id, title: workTitle, description: workDescription, category: workCategory, imagePaths: [], isPublished: true });
      const paths = [...(old?.image_paths ?? [])];
      for (const file of workPhotos) {
        // Las fotos de trabajos se muestran grandes en Inspiración y deben conservar detalle.
        // A diferencia de las fotos pequeñas de servicios, aquí se sube la variante de 2048 px.
        const processed = await processImageLocally(file, ["original"]);
        const variant = processed.variants.find(v => v.variant === "original");
        if (!variant) throw new Error("No se pudo preparar una de las fotos.");
        const ext = variant.file.type === "image/webp" ? "webp" : "jpg";
        const path = profile.id + "/" + itemId + "/" + variant.sha256.slice(0, 12) + "-" + crypto.randomUUID().slice(0, 8) + "-work." + ext;
        const { error: uploadError } = await getSupabaseClient().storage.from("service-images").upload(path, variant.file, { upsert: false, contentType: variant.file.type, cacheControl: "31536000" });
        if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error("No se pudo subir una foto: " + uploadError.message);
        uploadedPaths.push(path);
        paths.push(path);
      }
      await savePortfolioItem({ providerId: profile.id, id: itemId, title: workTitle, description: workDescription, category: workCategory, imagePaths: paths, isPublished: true });
      setShowWorkForm(false); setEditingWorkId(null); setWorkTitle(""); setWorkDescription(""); setWorkCategory("Diseños"); setWorkPhotos([]);
      await refresh();
      setNotice("Trabajo publicado en tu portafolio.");
    } catch (e) {
      if (uploadedPaths.length) await getSupabaseClient().storage.from("service-images").remove(uploadedPaths);
      setError(e instanceof Error ? e.message : "No se pudo publicar el trabajo.");
    } finally { setBusy(false); }
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
    setEditingServiceId(null); setServiceName(""); setServiceDescription(""); setServiceCategory("Manicura");
    setServicePrice("800"); setServiceDuration("45"); setShowServiceForm(true);
  };

  const openEditService = (s: ProviderService) => {
    resetPhoto(); setSavedPhotoPath(s.card_path);
    setEditingServiceId(s.id); setServiceName(s.name); setServiceDescription(s.description); setServiceCategory(s.category || inferServiceCategory(s.name, s.description));
    setServicePrice(String(s.price_cents / 100)); setServiceDuration(String(s.duration_minutes));
    setShowServiceForm(true);
  };

  const removeService = async () => {
    if (!profile || !deleteTarget) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const outcome = await deleteProviderService(profile.id, deleteTarget.id, "«" + deleteTarget.name + "»");
      setDeleteTarget(null);
      await refresh();
      setNotice(outcome.queued ? "Eliminado en este teléfono. Se enviará cuando haya conexión." : "Servicio eliminado. Las citas ya reservadas no cambian.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar el servicio."); }
    finally { setBusy(false); }
  };

  const changeAppointment = async (appointmentId: string, status: "confirmed" | "rejected" | "completed" | "cancelled", reason = "") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const target = appointments.find(x => x.id === appointmentId);
      const verb = { confirmed: "Confirmar", rejected: "Rechazar", completed: "Completar", cancelled: "Cancelar" }[status];
      const outcome = await setProviderAppointmentStatus(appointmentId, status, reason, `${verb} cita de ${target?.client_display_name || "una clienta"}`);
      await refresh();
      setNotice(outcome.queued ? "Guardado en este teléfono. Se enviará cuando haya conexión." : "Estado de la cita actualizado.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar la cita."); }
    finally { setBusy(false); }
  };

  const pickBrandLogo = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("El logotipo debe ser una imagen JPG, PNG o WebP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("El archivo del logotipo no puede superar 8 MB.");
      return;
    }
    setError(""); setNotice("");
    setBrandLogoFile(file);
    setBrandLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  };

  const saveBrandLogo = async () => {
    if (!profile || busy || !brandLogoFile) return;
    setBusy(true); setError(""); setNotice("");
    let uploadedPath: string | null = null;
    try {
      const processed = await processImageLocally(brandLogoFile);
      const image = processed.variants.find(v => v.variant === "card") ?? processed.variants[0];
      if (!image) throw new Error("No se pudo preparar el logotipo.");
      const ext = image.file.type === "image/webp" ? "webp" : "jpg";
      uploadedPath = profile.id + "/brand/" + image.sha256.slice(0, 16) + "-" + crypto.randomUUID().slice(0, 8) + "-logo." + ext;
      const { error: uploadError } = await getSupabaseClient().storage.from("service-images")
        .upload(uploadedPath, image.file, { upsert: false, contentType: image.file.type, cacheControl: "31536000" });
      if (uploadError) throw new Error(uploadError.message);
      const previousPath = profile.avatar_path;
      const { error: updateError } = await getSupabaseClient().from("provider_profiles")
        .update({ avatar_path: uploadedPath }).eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);
      if (previousPath && !/^https?:\/\//i.test(previousPath)) {
        await getSupabaseClient().storage.from("service-images").remove([previousPath]);
      }
      setBrandLogoFile(null);
      setBrandLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      await refresh();
      setNotice("Logotipo guardado. Ya aparecerá en Luni Cliente.");
    } catch (e) {
      if (uploadedPath) await getSupabaseClient().storage.from("service-images").remove([uploadedPath]);
      setError(e instanceof Error ? e.message : "No se pudo guardar el logotipo.");
    } finally { setBusy(false); }
  };

  const removeBrandLogo = async () => {
    if (!profile || busy || !profile.avatar_path) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const previousPath = profile.avatar_path;
      const { error: updateError } = await getSupabaseClient().from("provider_profiles")
        .update({ avatar_path: null }).eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);
      if (!/^https?:\/\//i.test(previousPath)) {
        await getSupabaseClient().storage.from("service-images").remove([previousPath]);
      }
      setBrandLogoFile(null);
      setBrandLogoPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      await refresh();
      setNotice("Logotipo eliminado. Luni Cliente mostrará el icono predeterminado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar el logotipo.");
    } finally { setBusy(false); }
  };

  const saveBusinessDetails = async () => {
    if (!profile || busy) return;
    const cleanName = editBusinessName.trim();
    if (!cleanName) {
      setError("Escribe el nombre de tu negocio.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const { error: updateError } = await getSupabaseClient()
        .from("provider_profiles")
        .update({ business_name: cleanName, bio: editBio.trim(), business_phone: editBusinessPhone.trim() || null, business_location: editBusinessLocation.trim() || null })
        .eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);
      await refresh();
      setNotice("Nombre y descripción del negocio guardados.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los datos del negocio.");
    } finally { setBusy(false); }
  };

  const saveBrandIcon = async (icon: string) => {
    if (!profile || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { error: updateError } = await getSupabaseClient()
        .from("provider_profiles")
        .update({ brand_icon: icon })
        .eq("id", profile.id);
      if (updateError) throw new Error(updateError.message);
      await refresh();
      setNotice("Icono del estudio guardado. Se mostrará en Luni Cliente.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el icono del estudio.");
    } finally { setBusy(false); }
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
      setNotice("Este es el código permanente de tu estudio. Compártelo por WhatsApp o muéstralo a tus clientas.");
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

  return <main className={"provider-shell" + (showMobileNav ? " has-mobile-nav" : "") + (isAdmin ? " admin-shell" : "")}>
    <aside className="provider-sidebar"><div className="provider-brand"><div className="provider-mark">l<span>✦</span></div><div><b>luni</b><small>STUDIO</small></div></div><div className="studio-switch"><div className="studio-avatar">{profile?.business_name?.[0]?.toUpperCase() ?? "♡"}</div><div><b>{profile?.business_name ?? "Mi estudio"}</b><small>{sessionEmail || "Espacio de belleza"}</small></div><span>⌄</span></div><div className="side-label">ESPACIO DE TRABAJO</div><nav className="side-nav"><button className={tab==="agenda"?"selected":""} onClick={()=>setTab("agenda")}><span>▦</span> Agenda</button><button className={tab==="servicios"?"selected":""} onClick={()=>setTab("servicios")}><span>✧</span> Mis servicios</button><button className={tab==="trabajos"?"selected":""} onClick={()=>setTab("trabajos")}><span>▧</span> Trabajos terminados</button><button className={tab==="clientes"?"selected":""} onClick={()=>setTab("clientes")}><span>♙</span> Clientas</button><button className={tab==="colores"?"selected":""} onClick={()=>setTab("colores")}><span>◉</span> Mezclador de colores</button><button className={tab==="perfil"?"selected":""} onClick={()=>setTab("perfil")}><span>⚙</span> Mi negocio</button></nav><div className="sidebar-bottom"><div className="help-mark">♡</div><b>Un espacio para crecer</b><p>Organiza tu tiempo. Cuida cada detalle.</p>{profile && <span className="trial-pill">LICENCIA: {(licenseText[profile.license_status] ?? profile.license_status).toUpperCase()}</span>}<div className="user-mini"><div className="studio-avatar">{sessionEmail ? sessionEmail[0].toUpperCase() : "♡"}</div><div><b>{sessionEmail || "Sin sesión"}</b><small>Mi cuenta</small></div><span>···</span></div></div></aside>
    <section className="provider-main"><header className="provider-header"><div className="mobile-brand"><div className="provider-mark">l<span>✦</span></div><b>luni studio</b></div><div className="breadcrumb">Mi estudio <span>/</span> <b>{tab==="agenda"?"Agenda":tab==="servicios"?"Mis servicios":tab==="trabajos"?"Trabajos terminados":tab==="clientes"?"Clientas":tab==="colores"?"Mezclador de colores":"Mi negocio"}</b></div><div className="header-actions"><span className="connection-dot" style={{background:loading?"#c3a56c":error?"#c65c5c":"#79a77a"}}></span><span className="connection-label">{loading ? "Conectando…" : (!net.online || net.stale) ? "Sin conexión" : error ? "Revisar conexión" : sessionEmail ? "En línea" : "Inicia sesión"}</span><button className="header-avatar" onClick={()=>setTab("perfil")}>{sessionEmail ? sessionEmail[0].toUpperCase() : "A"}</button></div></header>
      {(bannerText || net.conflicts.length > 0) && <div>{bannerText && <div className="offline-banner" role="status">{bannerText}</div>}{net.conflicts.length > 0 && <div className="offline-conflicts" role="alert">{net.conflicts.map((m, i) => <p key={i}>{m}</p>)}<button onClick={() => void dismissConflicts()}>Entendido</button></div>}</div>}
      {(error || notice) && <div role={error ? "alert" : "status"} className="provider-notice">{error || notice}<button onClick={()=>{setError("");setNotice("");}}>×</button></div>}
      {!sessionEmail ? <div className="workspace"><span className="eyebrow">BIENVENIDA A LUNI STUDIO</span><h1>Tu negocio, <em>en buenas manos.</em></h1><AuthPanel onError={setError} onNotice={setNotice} onSignedIn={() => refresh()} /></div>
      : isAdmin ? <div className="workspace admin-license-workspace">
        <span className="eyebrow">CONTROL DEL SISTEMA</span>
        <h1>Administración <em>de Luni.</em></h1>
        <p className="setup-description">Administra licencias, renovaciones, métodos de pago y accesos desde secciones independientes.</p>
        <div className="admin-main-tabs" role="tablist" aria-label="Secciones de administración">
          <button type="button" role="tab" aria-selected={adminTab === "licenses"} className={adminTab === "licenses" ? "admin-main-tab active" : "admin-main-tab"} onClick={() => setAdminTab("licenses")}>Licencias</button>
          <button type="button" role="tab" aria-selected={adminTab === "roles"} className={adminTab === "roles" ? "admin-main-tab active" : "admin-main-tab"} onClick={() => setAdminTab("roles")}>Roles de usuarios</button>
          <button type="button" role="tab" aria-selected={adminTab === "account"} className={adminTab === "account" ? "admin-main-tab active" : "admin-main-tab"} onClick={() => setAdminTab("account")}>Mi sesión</button>
        </div>
        <div className="admin-tab-panel" role="tabpanel">
          {adminTab === "licenses" && <AdminLicenses />}
          {adminTab === "roles" && <AdminRoles />}
          {adminTab === "account" && <div className="settings-card admin-account-card"><div className="settings-icon">⌁</div><div><h3>Sesión de administrador</h3><p>{sessionEmail}</p></div><button className="provider-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{if (!confirmSignOut()) return; await signOut();setProfile(null);setServices([]);setAppointments([]);setSessionEmail("");setIsAdmin(false);setNotice("Sesión cerrada.");}catch(e){setError(e instanceof Error?e.message:"No se pudo cerrar sesión.");}finally{setBusy(false);}}}>Cerrar sesión</button></div>}
        </div>
      </div> : !profile && loadFailed ? <div className="workspace"><span className="eyebrow">SIN CONEXIÓN</span><h1>Aún no hay <em>datos guardados.</em></h1><p className="setup-description">No pudimos cargar tu estudio y este teléfono todavía no tiene una copia. Conéctate a internet una vez y quedará guardada para trabajar sin señal.</p><button className="provider-primary" disabled={busy} onClick={()=>void refresh().then(()=>setLoadFailed(false)).catch(e=>setError(e instanceof Error ? e.message : "No se pudo conectar."))}>Reintentar</button></div> : !profile ? <div className="workspace"><span className="eyebrow">PRIMER PASO</span><h1>Registra tu <em>estudio.</em></h1><p className="setup-description">Completa los datos básicos para empezar a administrar tus servicios.</p><div className="settings-card provider-setup-card"><label>Nombre del estudio<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Ej. Studio Ana"/></label><label>Descripción breve<textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Qué servicios ofreces y qué te distingue"/></label><div className="setup-brand-picker"><b>Personaliza la identidad de tu estudio</b><p>Si tienes logotipo, puedes subirlo; también puedes elegir un icono. Si no personalizas nada, usaremos 💅 por defecto.</p><div className="brand-logo-editor"><div className="brand-logo-preview">{brandLogoPreview ? <img src={brandLogoPreview} alt="Vista previa del logotipo" /> : <span>{newBrandIcon}</span>}</div><div className="brand-logo-actions"><label className="provider-secondary photo-pick">{brandLogoPreview ? "Cambiar logotipo" : "Subir logotipo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";pickBrandLogo(file);}} /></label>{brandLogoPreview && <button type="button" className="provider-secondary" disabled={busy} onClick={()=>{setBrandLogoFile(null);setBrandLogoPreview(prev=>{if(prev)URL.revokeObjectURL(prev);return null;});}}>Quitar selección</button>}</div><small>Opcional · JPG, PNG o WebP · máximo 8 MB.</small></div><b>O elige un icono</b><div className="studio-brand-options" role="group" aria-label="Icono inicial del estudio">{BRAND_ICONS.map(icon=><button type="button" key={icon} className={newBrandIcon===icon?"selected":""} aria-pressed={newBrandIcon===icon} disabled={busy} onClick={()=>setNewBrandIcon(icon)}>{icon}</button>)}</div></div><button className="provider-primary" disabled={busy||!businessName.trim()} onClick={()=>void createProfile()}>{busy?"Guardando…":"Registrar estudio"}</button></div></div> : <>
        {tab==="colores" && <ColorMixer />}
        {tab==="agenda" && <div className="workspace agenda-workspace">
          <div className="welcome-row agenda-welcome"><div><span className="eyebrow">TU AGENDA REAL</span><h1>Tu día, <em>a tu manera.</em></h1><p>Organiza tus citas y controla los cobros de tu estudio.</p></div><div className="agenda-top-actions"><button type="button" className="provider-secondary" onClick={()=>setShowAgendaSearch(v=>!v)} aria-label="Buscar citas" title="Buscar citas">⌕ Buscar</button><label className="date-filter">Fecha<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label></div></div>
          {showAgendaSearch && <div className="agenda-search"><span>⌕</span><input autoFocus value={agendaSearch} onChange={e=>setAgendaSearch(e.target.value)} placeholder="Buscar por clienta, teléfono o servicio…" aria-label="Buscar por clienta, teléfono o servicio"/><button type="button" onClick={()=>{setAgendaSearch("");setShowAgendaSearch(false);}} aria-label="Cerrar búsqueda">×</button></div>}
          <div className="metric-grid agenda-finance-grid">
            <article className="metric-card"><span>INGRESOS PREVISTOS</span><div><b>{money(expectedIncome)}</b><i>↗</i></div><small>Citas confirmadas y por confirmar</small></article>
            <article className="metric-card"><span>INGRESOS COBRADOS</span><div><b>{money(collectedIncome)}</b><i>✓</i></div><small>Citas completadas y pagadas</small></article>
            <article className="metric-card"><span>POR COBRAR</span><div><b>{money(unpaidIncome)}</b><i>◷</i></div><small>Citas completadas sin pago registrado</small></article>
          </div>
          {expectedIncome===0 && collectedIncome===0 && unpaidIncome===0 && <p className="agenda-no-income">Sin citas con precio hoy</p>}
          <section className="agenda-panel agenda-redesigned"><div className="agenda-heading"><div><h2>Agenda</h2><p>{profile.business_name}</p></div><div className="agenda-heading-actions"><button type="button" className="provider-secondary" disabled={busy} onClick={()=>void refresh().then(()=>setNotice("Agenda actualizada.")).catch(e=>setError(e instanceof Error?e.message:"No se pudo actualizar la agenda."))}>↻ Actualizar</button><button className="today-button" onClick={()=>setDay(dateKeyInTimeZone(profile?.timezone || "America/Havana"))}>Hoy</button></div></div>
            <div className="agenda-toolbar"><div className="agenda-date"><b>{new Date(day+"T12:00:00").toLocaleDateString("es-CU",{weekday:"long",day:"numeric",month:"long"})}</b><span>{filteredAppointments.length} citas</span></div><div className="agenda-view-switch" role="group" aria-label="Vista de agenda"><button type="button" className={agendaView==="day"?"active":""} onClick={()=>setAgendaView("day")}>Día</button><button type="button" className={agendaView==="week"?"active":""} onClick={()=>setAgendaView("week")}>Semana</button></div></div>
            {agendaView==="day" && <div className="agenda-day-view">
              <div className="section-tabs provider-agenda-tabs" role="tablist" aria-label="Filtrar citas">
                <button type="button" role="tab" aria-selected={agendaSection==="all"} className={agendaSection==="all"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("all")}>Todas <span>{filteredAppointments.length}</span></button>
                <button type="button" role="tab" aria-selected={agendaSection==="pending"} className={agendaSection==="pending"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("pending")}>Por confirmar <span>{filteredAppointments.filter(a=>a.status==="pending_confirmation").length}</span></button>
                <button type="button" role="tab" aria-selected={agendaSection==="completed"} className={agendaSection==="completed"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("completed")}>Completadas <span>{filteredAppointments.filter(a=>a.status==="completed").length}</span></button>
              </div>
              <div className="appointment-list agenda-appointment-list">
                {agendaAppointments.map(a=><article className={"agenda-appointment-card "+(appointmentDesign(a.notes||"")?"has-selected-design ":"")+(expandedAppointment===a.id?"expanded":"")} key={a.id}>
                  <button type="button" className="agenda-appointment-summary" onClick={()=>setExpandedAppointment(expandedAppointment===a.id?null:a.id)} aria-expanded={expandedAppointment===a.id}>
                    <span className="agenda-client-avatar" style={{background:["#f3dce1","#e8e1f1","#dcebe2","#f4e6d3","#dce9f2"][Math.abs((a.client_display_name||"C").charCodeAt(0))%5]}}>{(a.client_display_name||"C").trim().slice(0,1).toUpperCase()}</span>
                    <span className="agenda-appointment-main"><b>{new Date(a.starts_at).toLocaleTimeString("es-CU",{hour:"2-digit",minute:"2-digit"})} <small>({Math.max(1,Math.round((Date.parse(a.ends_at)-Date.parse(a.starts_at))/60000))} min)</small></b><strong>{a.client_display_name||"Clienta"}</strong><span>{a.client_service_name}</span>{appointmentDesign(a.notes||"")&&<span className="agenda-design-badge">✧ Diseño elegido</span>}</span>
                    <span className="agenda-appointment-price">{money(a.client_price_cents,a.client_currency)}</span>
                    <span className={"agenda-status-chip "+a.status}>{statusText[a.status]||a.status}</span><span className="agenda-expand-icon">{expandedAppointment===a.id?"−":"+"}</span>
                  </button>
                  {expandedAppointment===a.id&&<div className="agenda-appointment-expanded">
                    <div className="agenda-appointment-meta">
                      {a.client_phone&&<span>Teléfono: <a href={"tel:"+a.client_phone}>{a.client_phone}</a></span>}
                      {a.notes&& !appointmentDesign(a.notes)&&<span>Nota: {a.notes}</span>}
                      {appointmentDesign(a.notes||"")&&<div className="appointment-design-reference"><b>✧ Diseño elegido por la clienta</b><p>{appointmentDesign(a.notes||"")!.title} · {appointmentDesign(a.notes||"")!.category}</p>{appointmentDesign(a.notes||"")!.imagePath&&appointmentDesign(a.notes||"")!.imagePath!=="sin foto"&&<button type="button" onClick={()=>setZoomDesign({path:appointmentDesign(a.notes||"")!.imagePath,title:appointmentDesign(a.notes||"")!.title,category:appointmentDesign(a.notes||"")!.category})}><CachedImage path={appointmentDesign(a.notes||"")!.imagePath} alt="Diseño elegido por la clienta" style={{width:100,height:100,objectFit:"cover",borderRadius:8}}/></button>}</div>}
                      {!a.client_phone&&!a.notes&&<span>Sin notas adicionales.</span>}
                    </div>
                    <div className="agenda-expanded-actions">
                      {a.client_phone&&<a className="provider-secondary agenda-call" href={"tel:"+a.client_phone}>Llamar</a>}
                      {(a.status==="pending_confirmation"||a.status==="confirmed")&&<button className="provider-secondary" disabled={busy} onClick={()=>{setEditingAgendaAppointment(a.id);setEditAppointmentDateTime(new Date(a.starts_at).toLocaleString("sv-SE",{timeZone:profile.timezone||"America/Havana"}).replace(" ","T").slice(0,16));setEditAppointmentNotes(a.notes||"");}}>Editar</button>}
                      {a.status==="pending_confirmation"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"confirmed")}>Confirmar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"rejected"});}}>Rechazar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"cancelled"});}}>Cancelar</button></>}
                      {a.status==="confirmed"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"completed")}>Completar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"cancelled"});}}>Cancelar</button></>}
                      {a.status==="completed"&&<button className={a.payment_received?"provider-secondary":"provider-primary"} disabled={busy||!net.online} onClick={async()=>{setBusy(true);try{const {error:paymentError}=await getSupabaseClient().rpc("luni_provider_set_appointment_payment",{p_appointment_id:a.id,p_paid:!a.payment_received});if(paymentError)throw new Error(paymentError.message);setAppointments(prev=>prev.map(item=>item.id===a.id?{...item,payment_received:!a.payment_received}:item));setNotice(a.payment_received?"Pago marcado como pendiente.":"Pago registrado como cobrado.");}catch(e){setError(e instanceof Error?e.message:"No se pudo guardar el pago.");}finally{setBusy(false);}}}>{a.payment_received?"✓ Cobrado · Desmarcar":"Registrar cobro"}</button>}
                    </div>
                  </div>}
                </article>)}
                {agendaAppointments.length===0&&<div className="provider-empty"><span>✧</span><b>{agendaSearch?"No hay coincidencias":agendaSection==="pending"?"No hay citas por confirmar":agendaSection==="completed"?"No hay citas completadas":"Tu agenda está despejada"}</b><p>{agendaSearch?"Prueba con otro nombre, teléfono o servicio.":"No hay citas registradas para esta fecha."}</p></div>}
              </div>
            </div>}
            {agendaView==="week" && <div className="agenda-week-grid">{weekDays.map(date=>{const dayAppointments=weekAppointments.filter(a=>a.starts_at.slice(0,10)===date);return <section className={"agenda-week-column "+(date===day?"selected":"")} key={date}><button type="button" className="agenda-week-day" onClick={()=>{setDay(date);setAgendaView("day");}}><span>{new Date(date+"T12:00:00").toLocaleDateString("es-CU",{weekday:"short"}).replace(".","")}</span><b>{new Date(date+"T12:00:00").getDate()}</b></button>{dayAppointments.map(a=><button type="button" key={a.id} className={"agenda-week-event "+a.status+(appointmentDesign(a.notes||"")?" has-selected-design":"")} onClick={()=>{setDay(date);setAgendaView("day");setExpandedAppointment(a.id);}}><b>{new Date(a.starts_at).toLocaleTimeString("es-CU",{hour:"2-digit",minute:"2-digit"})}</b><span>{a.client_display_name||"Clienta"}</span><small>{a.client_service_name}</small></button>)}{!dayAppointments.length&&<span className="agenda-week-empty">—</span>}</section>;})}</div>}
          </section>
          <button type="button" className="agenda-fab" onClick={()=>{setManualClientId(knownAgendaClients[0]?.id||"");setManualClientMode(knownAgendaClients.length?"existing":"new");setManualNewClientName("");setManualNewClientPhone("");setManualServiceId(activeServices[0]?.id||"");setManualDateTime(day+"T09:00");setManualNotes("");setShowManualAppointment(true);}} aria-label="Nueva cita">＋ <span>Nueva cita</span></button>
          {editingAgendaAppointment&&<div className="provider-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingAgendaAppointment(null);}}><form className="provider-modal agenda-manual-modal" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");try{const {error:editError}=await getSupabaseClient().rpc("luni_provider_edit_appointment",{p_appointment_id:editingAgendaAppointment,p_starts_at:new Date(editAppointmentDateTime).toISOString(),p_notes:editAppointmentNotes.trim()});if(editError)throw new Error(editError.message==="SLOT_ALREADY_TAKEN"?"Ese horario ya está ocupado.":editError.message);setEditingAgendaAppointment(null);await refresh();setNotice("Cita actualizada.");}catch(e){setError(e instanceof Error?e.message:"No se pudo editar la cita.");}finally{setBusy(false);}}}><button type="button" className="modal-close" onClick={()=>setEditingAgendaAppointment(null)}>×</button><span className="eyebrow">MODIFICAR RESERVA</span><h2>Editar <em>cita.</em></h2><label>Fecha y hora<input type="datetime-local" required min={new Date(Date.now()+60000).toISOString().slice(0,16)} value={editAppointmentDateTime} onChange={e=>setEditAppointmentDateTime(e.target.value)}/></label><label>Notas<textarea value={editAppointmentNotes} onChange={e=>setEditAppointmentNotes(e.target.value)} maxLength={1000} placeholder="Notas para esta cita"/></label><button className="provider-primary full-provider-button" type="submit" disabled={busy}>{busy?"Guardando…":"Guardar cambios"}</button></form></div>}
          {showManualAppointment&&<div className="provider-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setShowManualAppointment(false);}}><form className="provider-modal agenda-manual-modal" onSubmit={async e=>{e.preventDefault();if(!manualServiceId||!manualDateTime){setError("Selecciona servicio, fecha y hora.");return;}if(manualClientMode==="existing"&&!manualClientId){setError("Selecciona una clienta o registra una nueva.");return;}if(manualClientMode==="new"&&(!manualNewClientName.trim()||!manualNewClientPhone.trim())){setError("Escribe el nombre y teléfono de la nueva clienta.");return;}setBusy(true);setError("");try{const rpcName=manualClientMode==="new"?"luni_provider_create_manual_client_appointment":"luni_provider_create_manual_appointment";const args=manualClientMode==="new"?{p_client_name:manualNewClientName.trim(),p_client_phone:manualNewClientPhone.trim(),p_service_id:manualServiceId,p_starts_at:new Date(manualDateTime).toISOString(),p_notes:manualNotes.trim()}:{p_client_id:manualClientId,p_service_id:manualServiceId,p_starts_at:new Date(manualDateTime).toISOString(),p_notes:manualNotes.trim()};const {error:manualError}=await getSupabaseClient().rpc(rpcName,args);if(manualError)throw new Error(manualError.message==="SLOT_ALREADY_TAKEN"?"Ese horario ya está ocupado.":manualError.message==="INVALID_CLIENT_DETAILS"?"Revisa el nombre y el teléfono de la clienta.":manualError.message);setShowManualAppointment(false);await refresh();setNotice("Cita creada correctamente.");}catch(e){setError(e instanceof Error?e.message:"No se pudo crear la cita.");}finally{setBusy(false);}}}><button type="button" className="modal-close" onClick={()=>setShowManualAppointment(false)}>×</button><span className="eyebrow">NUEVA RESERVA</span><h2>Crear <em>cita.</em></h2><div className="agenda-client-mode"><button type="button" className={manualClientMode==="existing"?"provider-primary":"provider-secondary"} onClick={()=>setManualClientMode("existing")} disabled={!knownAgendaClients.length}>Clienta existente</button><button type="button" className={manualClientMode==="new"?"provider-primary":"provider-secondary"} onClick={()=>setManualClientMode("new")}>Nueva clienta</button></div>{manualClientMode==="existing"?<label>Clienta<select required value={manualClientId} onChange={e=>setManualClientId(e.target.value)}>{knownAgendaClients.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?" · "+c.phone:""}</option>)}</select></label>:<><label>Nombre y apellidos<input required maxLength={120} value={manualNewClientName} onChange={e=>setManualNewClientName(e.target.value)} placeholder="Nombre de la clienta"/></label><label>Teléfono<input required maxLength={30} value={manualNewClientPhone} onChange={e=>setManualNewClientPhone(e.target.value)} placeholder="Teléfono de contacto" inputMode="tel"/></label><p className="agenda-manual-help">Se registrará en la agenda del estudio sin exigirle crear una cuenta en Luni.</p></>}<label>Servicio<select required value={manualServiceId} onChange={e=>setManualServiceId(e.target.value)}>{activeServices.map(s=><option key={s.id} value={s.id}>{s.name} · {money(s.price_cents,s.currency)}</option>)}</select></label><label>Fecha y hora<input type="datetime-local" required min={new Date(Date.now()+60000).toISOString().slice(0,16)} value={manualDateTime} onChange={e=>setManualDateTime(e.target.value)}/></label><label>Notas (opcional)<textarea value={manualNotes} onChange={e=>setManualNotes(e.target.value)} maxLength={1000} placeholder="Indicaciones para esta cita"/></label><button className="provider-primary full-provider-button" type="submit" disabled={busy||!activeServices.length||(manualClientMode==="existing"&&!knownAgendaClients.length)}>{busy?"Guardando…":"Crear cita"}</button></form></div>}
        </div>}
        {tab==="servicios"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">LO QUE HACES MEJOR</span><h1>Mis <em>servicios.</em></h1><p>Tus clientas ven aquí lo que ofreces, con su precio y duración.</p></div><button className="provider-primary" onClick={openNewService}>＋ Añadir servicio</button></div><div className="provider-service-toolbar"><p>Define tus tarifas: cada servicio, descripción y duración se puede modificar sin afectar a otros estudios.</p><button type="button" className="provider-secondary" disabled={busy} onClick={()=>void loadStarterCatalog()}>{busy?"Completando catálogo…":"Cargar o completar catálogo inicial (33 servicios)"}</button></div><div className="provider-service-category-tabs" role="group" aria-label="Filtrar servicios por tipo"><button type="button" className={serviceCatalogCategoryFilter==="Todas"?"active":""} aria-pressed={serviceCatalogCategoryFilter==="Todas"} onClick={()=>setServiceCatalogCategoryFilter("Todas")}>Todos <span>{activeServices.length}</span></button>{serviceCatalogCategories.map(category=><button type="button" key={category} className={serviceCatalogCategoryFilter===category?"active":""} aria-pressed={serviceCatalogCategoryFilter===category} onClick={()=>setServiceCatalogCategoryFilter(category)}>{category}<span>{activeServices.filter(s=>(s.category?.trim()||inferServiceCategory(s.name,s.description))===category).length}</span></button>)}</div>{groupedActiveServices.map(group=><section className="provider-service-category-section" key={group.category}><header><div><span className="eyebrow">TIPO DE SERVICIO</span><h2>{group.category}</h2></div><span>{group.items.length} {group.items.length===1?"servicio":"servicios"}</span></header><div className="provider-service-grid">{group.pageItems.map((s,i)=><article className="provider-service-card" key={s.id}><div className={"provider-service-art art-"+(i%3)}>{s.card_path?<CachedImage className="service-photo" path={s.card_path} alt="" loading="lazy" decoding="async" onLoad={e=>e.currentTarget.classList.add("loaded")}> </CachedImage>:["✿","✧","❀"][i%3]}<span>{String((group.page-1)*6+i+1).padStart(2,"0")}</span></div><div className="provider-service-content"><span className="provider-service-category-tag">{group.category}</span><h3>{s.name}</h3><p>{s.description}</p><div><span>◷ {s.duration_minutes} min</span><b>{money(s.price_cents,s.currency)}</b></div><div className="appointment-actions"><button className="provider-secondary" disabled={busy} onClick={()=>openEditService(s)}>Editar</button><button className="provider-secondary" disabled={busy} onClick={()=>setDeleteTarget(s)}>Eliminar</button></div></div></article>)}</div>{group.totalPages>1&&<nav className="provider-service-pagination" aria-label={"Páginas de "+group.category}><button type="button" disabled={group.page<=1} onClick={()=>setServiceCatalogPages(current=>({...current,[group.category]:group.page-1}))}>Anterior</button>{Array.from({length:group.totalPages},(_,index)=>index+1).map(page=><button type="button" key={page} className={page===group.page?"active":""} aria-current={page===group.page?"page":undefined} aria-label={"Página "+page} onClick={()=>setServiceCatalogPages(current=>({...current,[group.category]:page}))}>{page}</button>)}<button type="button" disabled={group.page>=group.totalPages} onClick={()=>setServiceCatalogPages(current=>({...current,[group.category]:group.page+1}))}>Siguiente</button></nav>}</section>)}{activeServices.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes servicios</b><p>Añade tu primer servicio para completar el catálogo del estudio.</p><button className="provider-primary" onClick={openNewService}>Añadir servicio</button></div>}</div>}
        {tab==="trabajos"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">TU GALERÍA PÚBLICA</span><h1>Mis trabajos <em>terminados.</em></h1><p>Publica fotos reales para que futuras clientas conozcan tu estilo. Puedes incluir hasta 6 fotos en cada publicación.</p></div><button className="provider-primary" onClick={()=>{setEditingWorkId(null);setWorkTitle("");setWorkDescription("");setWorkCategory("Diseños");setWorkPhotos([]);setShowWorkForm(true);}}>＋ Publicar trabajo</button></div><div className="section-tabs portfolio-category-tabs" role="tablist" aria-label="Filtrar trabajos por categoría">{portfolioCategories.map(category=><button key={category} type="button" role="tab" aria-selected={portfolioFilter===category} className={portfolioFilter===category?"section-tab active":"section-tab"} onClick={()=>setPortfolioFilter(category)}>{category}<span>{category==="Todas"?portfolioItems.length:portfolioItems.filter(item=>item.category===category).length}</span></button>)}</div><div className="portfolio-work-grid">{filteredPortfolioItems.map(item=><article className="portfolio-work-card" key={item.id}><div className="portfolio-work-images">{item.image_paths.slice(0,3).map(path=><CachedImage key={path} path={path} alt={item.title||"Trabajo de uñas"} loading="lazy"/>)}</div><div className="portfolio-work-body"><span className="portfolio-work-category">{item.category}</span><h3>{item.title||item.category}</h3><p>{item.description||"Trabajo terminado publicado en tu galería."}</p><small>{item.image_paths.length} {item.image_paths.length===1?"foto":"fotos"} · {item.is_published?"Visible públicamente":"Oculto"}</small><div className="service-actions"><button className="provider-secondary" onClick={()=>{setEditingWorkId(item.id);setWorkTitle(item.title);setWorkDescription(item.description);setWorkCategory(item.category);setWorkPhotos([]);setShowWorkForm(true);}}>Editar</button><button className="provider-secondary" disabled={busy} onClick={async()=>{if(!window.confirm("¿Eliminar esta publicación de tu portafolio?"))return;setBusy(true);setError("");try{await deletePortfolioItem(profile.id,item.id);await refresh();setNotice("Publicación eliminada de la galería.");}catch(e){setError(e instanceof Error?e.message:"No se pudo eliminar el trabajo.");}finally{setBusy(false);}}}>Eliminar</button></div></div></article>)}</div>{portfolioItems.length>0&&filteredPortfolioItems.length===0&&<div className="provider-empty"><p>No hay trabajos en esta categoría.</p></div>}{portfolioItems.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Tu galería empieza aquí</b><p>Publica tu primer trabajo terminado con hasta 6 fotos.</p><button className="provider-primary" onClick={()=>setShowWorkForm(true)}>Publicar primer trabajo</button></div>}</div>}
        {tab==="clientes"&&<div className="workspace">
          <div className="welcome-row"><div><span className="eyebrow">CARTERA PRIVADA</span><h1>Tus <em>clientas.</em></h1><p>Cada clienta entra por tu invitación personal. Tu cartera es independiente de la de otras manicuristas.</p></div></div>
          {inviteLink&&<section className="invite-share-card"><span className="eyebrow">CÓDIGO PERMANENTE DEL ESTUDIO</span><h2>Tu código de vinculación</h2><p>Siempre visible y sin vencimiento. Muéstralo a una clienta o compártelo para que otra persona pueda recomendar tu estudio. La clienta lo introduce en Luni Cliente, en «Mis manicuristas».</p><div className="invite-link-row"><input className="invite-code-display" aria-label="Código de vinculación" readOnly value={inviteLink}/><button className="provider-secondary" onClick={()=>void copyInviteLink()}>Copiar código</button></div><div className="invite-share-actions"><button className="provider-primary" onClick={()=>void shareInviteLink()}>Compartir código ↗</button></div></section>}
          <div className="client-portfolio-summary"><b>{clients.length}</b><span>{clients.length===1?"clienta conectada":"clientas conectadas"}</span><small>La información de cada clienta solo es visible para tu estudio.</small></div>
          {clients.length===0?<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes clientas vinculadas</b><p>Comparte el código permanente que aparece arriba para que las clientas te añadan en Luni Cliente. No existe un directorio público de clientas ni de estudios.</p></div>
          :<div className="client-portfolio-list">{clients.map(client=><article className="client-portfolio-card" key={client.client_id}><div className="client-portfolio-avatar">{(client.display_name||"C").trim()[0]?.toUpperCase()}</div><div className="client-portfolio-main"><h3>{client.display_name||"Clienta de Luni"}</h3><p>{client.phone?<a href={"tel:"+client.phone}>{client.phone}</a>:"Sin teléfono registrado"}</p><small>Conectada desde {new Date(client.linked_at).toLocaleDateString("es-CU",{day:"numeric",month:"short",year:"numeric"})}</small></div><div className="client-portfolio-stats"><b>{client.appointment_count}</b><span>{client.appointment_count===1?"cita":"citas"}</span><small>{client.last_appointment_at?"Última: "+new Date(client.last_appointment_at).toLocaleDateString("es-CU",{day:"numeric",month:"short",year:"numeric"}):"Sin citas todavía"}</small></div></article>)}</div>}
        </div>}
        {tab==="perfil"&&<div className="workspace"><span className="eyebrow">TU MARCA, TUS REGLAS</span><h1>Mi <em>negocio.</em></h1><div className="section-tabs profile-section-tabs" role="tablist" aria-label="Secciones del negocio"><button type="button" role="tab" aria-selected={profileSection==="business"} className={profileSection==="business"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("business")}>Datos del estudio</button><button type="button" role="tab" aria-selected={profileSection==="license"} className={profileSection==="license"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("license")}>Licencia</button><button type="button" role="tab" aria-selected={profileSection==="schedule"} className={profileSection==="schedule"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("schedule")}>Horarios y turnos</button><button type="button" role="tab" aria-selected={profileSection==="account"} className={profileSection==="account"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("account")}>Cuenta</button></div>{profileSection==="business"&&<><div className="settings-card"><div className="settings-avatar studio-brand-icon">{profile.brand_icon || "💅"}</div><div><h3>{profile.business_name}</h3><p>{profile.bio || "Sin descripción todavía."}</p><p>Prueba iniciada: {new Date(profile.trial_started_at).toLocaleDateString("es-CU",{day:"numeric",month:"short",year:"numeric"})} · Licencia: {licenseText[profile.license_status] ?? profile.license_status}{profile.license_expires_at ? " · Vence: " + new Date(profile.license_expires_at).toLocaleDateString("es-CU",{day:"numeric",month:"short",year:"numeric"}) : ""}</p></div><span className="trial-pill">{profile.is_published?"RESERVAS ACTIVAS":"RESERVAS PAUSADAS"}</span></div><section className="settings-card"><div className="settings-icon">✎</div><div className="studio-brand-copy"><h3>Datos de tu negocio</h3><p>Estos datos son propios de tu cuenta y se muestran con tu marca. No se usa el nombre de ningún negocio de ejemplo.</p><label>Nombre comercial<input maxLength={120} value={editBusinessName} onChange={e=>setEditBusinessName(e.target.value)} placeholder="Ej. Mi estudio de uñas" /></label><label>Descripción breve<textarea maxLength={1000} value={editBio} onChange={e=>setEditBio(e.target.value)} placeholder="Describe tus servicios y lo que te distingue" /></label><label>Teléfono de contacto<input type="tel" maxLength={40} value={editBusinessPhone} onChange={e=>setEditBusinessPhone(e.target.value)} placeholder="Ej. 56772836" /></label><label>Dirección o zona de atención<input maxLength={200} value={editBusinessLocation} onChange={e=>setEditBusinessLocation(e.target.value)} placeholder="Ej. La Habana Vieja" /></label><button type="button" className="provider-primary" disabled={busy||!editBusinessName.trim()} onClick={()=>void saveBusinessDetails()}>Guardar datos del negocio</button></div></section><section className="settings-card"><div className="settings-icon">✓</div><div className="studio-brand-copy"><h3>Aprobación de citas</h3><p>Decide qué ocurre cuando una clienta solicita un turno. Este ajuste se aplica a las nuevas solicitudes; no cambia las citas que ya existen.</p><label className="approval-mode-option"><input type="radio" name="appointment-approval-mode" checked={!profile.auto_confirm_appointments} disabled={busy} onChange={()=>void saveAppointmentApprovalMode(false)} /><span><b>Aprobación manual</b><small>La cita queda «Por confirmar» hasta que la revises y la aceptes desde Agenda.</small></span></label><label className="approval-mode-option"><input type="radio" name="appointment-approval-mode" checked={profile.auto_confirm_appointments} disabled={busy} onChange={()=>void saveAppointmentApprovalMode(true)} /><span><b>Aprobación automática</b><small>La cita se confirma automáticamente si el horario está disponible y la reserva cumple las reglas de Luni.</small></span></label></div></section><section className="settings-card studio-brand-customizer"><div className="settings-icon">✦</div><div className="studio-brand-copy"><h3>Identidad de tu estudio</h3><p>Si tienes un logotipo, súbelo aquí para que aparezca en Luni Cliente. Es opcional: si no lo tienes, se mostrará el icono que elijas abajo.</p><div className="brand-logo-editor"><div className="brand-logo-preview">{brandLogoPreview ? <img src={brandLogoPreview} alt="Vista previa del logotipo" /> : profile.avatar_path ? <CachedImage path={profile.avatar_path} alt={"Logotipo de " + profile.business_name} /> : <span>{profile.brand_icon || "💅"}</span>}</div><div className="brand-logo-actions"><label className="provider-secondary photo-pick">{brandLogoPreview || profile.avatar_path ? "Cambiar logotipo" : "Elegir logotipo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";pickBrandLogo(file);}} /></label>{brandLogoFile && <button type="button" className="provider-primary" disabled={busy} onClick={()=>void saveBrandLogo()}>{busy?"Guardando…":"Guardar logotipo"}</button>}{profile.avatar_path && !brandLogoFile && <button type="button" className="provider-secondary" disabled={busy} onClick={()=>void removeBrandLogo()}>Quitar logotipo</button>}{brandLogoPreview && <button type="button" className="provider-secondary" disabled={busy} onClick={()=>{setBrandLogoFile(null);setBrandLogoPreview(prev=>{if(prev)URL.revokeObjectURL(prev);return null;});}}>Cancelar</button>}</div><small>JPG, PNG o WebP · máximo 8 MB. Se optimiza antes de subirlo.</small></div><h3>O elige un icono predeterminado</h3><div className="studio-brand-options" role="group" aria-label="Icono del estudio">{BRAND_ICONS.map(icon=><button type="button" key={icon} className={(profile.brand_icon || "💅")===icon?"selected":""} aria-pressed={(profile.brand_icon || "💅")===icon} disabled={busy} onClick={()=>void saveBrandIcon(icon)}>{icon}</button>)}</div></div></section><div className="settings-card"><div className="settings-icon">↗</div><div><h3>Reservas por invitación</h3><p>{profile.is_published?"Tu estudio puede aceptar reservas de clientas vinculadas por invitación.":"Activa las reservas cuando tengas servicios y horarios listos. Tu estudio no aparecerá en un directorio público."}</p></div><button className="provider-secondary" disabled={busy||activeServices.length===0&&!profile.is_published} onClick={()=>void publishProfile()}>{profile.is_published?"Pausar reservas":"Activar reservas"}</button></div></>}{profileSection==="license"&&<div className="profile-section-panel">{!isAdmin && <LicenseRenewal providerId={profile.id} />}<AdminLicenses /></div>}{profileSection==="schedule"&&<div className="profile-section-panel"><ManualTurnsEditor providerId={profile.id} appointments={appointments} timezone={profile.timezone || "America/Havana"} /><ScheduleEditor providerId={profile.id} appointments={appointments} timezone={profile.timezone || "America/Havana"} legacyScheduleHidden /></div>}{profileSection==="account"&&<div className="profile-section-panel"><div className="settings-card"><div className="settings-icon">⌁</div><div><h3>Cuenta</h3><p>{sessionEmail}</p></div><button className="provider-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{if (!confirmSignOut()) return; await signOut();setProfile(null);setServices([]);setAppointments([]);setSessionEmail("");setNotice("Sesión cerrada.");}catch(e){setError(e instanceof Error?e.message:"No se pudo cerrar sesión.");}finally{setBusy(false);}}}>Cerrar sesión</button></div></div>}
      </div>}
      <footer className="provider-footer"><span>luni studio</span><span>Hecho con cuidado, para quienes cuidan. ♡</span></footer>
      </>}
    </section>
    {showMobileNav && <nav className="mobile-nav" aria-label="Navegación principal">
      {([["agenda", "Agenda", "▦"], ["servicios", "Servicios", "✧"], ["trabajos", "Trabajos", "▧"], ["clientes", "Clientas", "♙"], ["colores", "Colores", "◉"], ["perfil", "Negocio", "⚙"]] as const).map(([id, label, icon]) =>
        <button key={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
    </nav>}
    {deleteTarget&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="delete-service-title"><button className="modal-close" onClick={()=>setDeleteTarget(null)} aria-label="Cerrar">×</button><span className="eyebrow">ELIMINAR SERVICIO</span><h2 id="delete-service-title">¿Eliminar <em>{deleteTarget.name}</em>?</h2><p>Dejará de mostrarse a tus clientas. Las citas ya reservadas conservan su nombre y precio.</p><button className="provider-primary full-provider-button" disabled={busy} onClick={()=>void removeService()}>{busy?"Eliminando…":"Sí, eliminar"}</button><button className="provider-secondary full-provider-button" disabled={busy} onClick={()=>setDeleteTarget(null)}>No, conservar</button></section></div>}
    {reasonTarget&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="reason-title"><button className="modal-close" onClick={()=>setReasonTarget(null)} aria-label="Cerrar">×</button><span className="eyebrow">{reasonTarget.status==="rejected"?"RECHAZAR CITA":"CANCELAR CITA"}</span><h2 id="reason-title">Avisa a la <em>clienta.</em></h2><label>Motivo (opcional)<input value={reasonText} maxLength={200} onChange={e=>setReasonText(e.target.value)} placeholder="Ej. Ese día no podré atender"/></label><button className="provider-primary full-provider-button" disabled={busy} onClick={async()=>{const t=reasonTarget;setReasonTarget(null);await changeAppointment(t.id,t.status,reasonText);}}>{reasonTarget.status==="rejected"?"Rechazar cita":"Cancelar cita"}</button></section></div>}
    {zoomDesign && <div className="provider-modal-backdrop" role="presentation" onClick={() => setZoomDesign(null)} style={{ zIndex: 10000, padding: 16, background: "rgba(28, 18, 24, .88)" }}><section role="dialog" aria-modal="true" aria-label="Vista ampliada del diseño elegido" onClick={e => e.stopPropagation()} style={{ position: "relative", width: "min(94vw, 900px)", maxHeight: "94vh", overflow: "auto", margin: "auto", padding: 14, borderRadius: 18, background: "#fffaf8", boxSizing: "border-box" }}><button type="button" onClick={() => setZoomDesign(null)} aria-label="Cerrar imagen ampliada" style={{ position: "sticky", top: 0, float: "right", zIndex: 1, width: 42, height: 42, borderRadius: "50%", border: "1px solid #ead1d8", background: "#fff", color: "#5d3445", fontSize: 28, cursor: "pointer" }}>×</button><div style={{ clear: "both", textAlign: "center", padding: "0 4px 12px" }}><b style={{ color: "#5d3445" }}>{zoomDesign.title || "Diseño elegido"}</b><div style={{ color: "#8a6b77", fontSize: 13, marginTop: 3 }}>{zoomDesign.category}</div></div><CachedImage path={zoomDesign.path} alt={"Vista ampliada: " + zoomDesign.title} style={{ display: "block", width: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 10, background: "#f4eef0" }} /></section></div>}
    {showWorkForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-work-title"><button className="modal-close" onClick={()=>{setShowWorkForm(false);setEditingWorkId(null);setWorkPhotos([]);}} aria-label="Cerrar">×</button><span className="eyebrow">PORTAFOLIO DE TRABAJOS</span><h2 id="portfolio-work-title">{editingWorkId?"Editar":"Publicar"} <em>trabajo terminado.</em></h2><label>Título (opcional)<input maxLength={120} value={workTitle} onChange={e=>setWorkTitle(e.target.value)} placeholder="Ej. Francesa con detalles dorados"/></label><label>Categoría<select value={workCategory} onChange={e=>setWorkCategory(e.target.value)}><option>Diseños</option><option>Acrílicas</option><option>Semipermanente</option><option>Manicura</option><option>Pedicura</option><option>Gel</option><option>Novias y eventos</option><option>Otros</option></select></label><label>Descripción<textarea maxLength={1000} value={workDescription} onChange={e=>setWorkDescription(e.target.value)} placeholder="Cuenta qué técnica o diseño realizaste"/></label><label>Fotos (hasta 6 en total; JPG, PNG o WebP)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setWorkPhotos(Array.from(e.target.files??[]).slice(0,6))}/></label><p>{workPhotos.length} foto(s) nuevas seleccionadas. Las fotos se optimizan antes de subirlas a Supabase Storage.</p><button className="provider-primary full-provider-button" disabled={busy||photoBusy||(!editingWorkId&&workPhotos.length===0)} onClick={()=>void createPortfolioPost()}>{busy?"Publicando…":editingWorkId?"Guardar cambios":"Publicar trabajo"}</button></section></div>}
    {showServiceForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="new-service-title"><button className="modal-close" onClick={()=>setShowServiceForm(false)} aria-label="Cerrar">×</button><span className="eyebrow">{editingServiceId?"AJUSTA TU CATÁLOGO":"AMPLÍA TU CATÁLOGO"}</span><h2 id="new-service-title">{editingServiceId?<>Editar <em>servicio.</em></>:<>Nuevo <em>servicio.</em></>}</h2><label>Nombre del servicio<input value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="Ej. Manicura clásica"/></label><label>Tipo de servicio<select value={serviceCategory} onChange={e=>setServiceCategory(e.target.value)}>{SERVICE_CATEGORIES.map(category=><option key={category} value={category}>{category}</option>)}</select><small>Esta categoría organiza tu catálogo y ayuda a tus clientas a encontrar el servicio.</small></label><label>Descripción<input value={serviceDescription} onChange={e=>setServiceDescription(e.target.value)} placeholder="Describe brevemente el servicio"/></label><div className="photo-field"><span>Foto del servicio</span>{(photo||(savedPhotoPath&&!removePhoto))?(photo?<img className="photo-preview" src={photo.previewUrl} alt="Foto del servicio"/>:<CachedImage className="photo-preview" path={savedPhotoPath} alt="Foto del servicio"/>):<div className="photo-empty">Sin foto</div>}<div className="photo-actions"><label className="provider-secondary photo-pick">{(photo||(savedPhotoPath&&!removePhoto))?"Cambiar foto":"Añadir foto"}<input type="file" accept="image/*" hidden disabled={busy||photoBusy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";void pickPhoto(f);}}/></label>{(photo||(savedPhotoPath&&!removePhoto))&&<button type="button" className="provider-secondary" disabled={busy||photoBusy} onClick={()=>{if(photo)resetPhoto();else setRemovePhoto(true);}}>{photo?"Descartar":"Quitar foto"}</button>}</div>{photoBusy&&<small>Preparando la foto en tu teléfono…</small>}{!photoBusy&&photoInfo&&<small>{photoInfo}</small>}{photoError&&<small className="photo-error" role="alert">{photoError}</small>}</div><label>Precio (CUP)<input inputMode="decimal" value={servicePrice} onChange={e=>setServicePrice(e.target.value)} /></label><label>Duración en minutos<input type="number" min="1" max="1440" value={serviceDuration} onChange={e=>setServiceDuration(e.target.value)} /></label><p>El precio se guarda en centavos en la base de datos. Ejemplo: 800 CUP se guarda como 80000.</p><button className="provider-primary full-provider-button" disabled={busy||photoBusy||!serviceName.trim()} onClick={()=>void createService()}>{busy?(photoInfo.startsWith("Subiendo")?photoInfo:"Guardando…"):"Guardar servicio"}</button></section></div>}
  </main>;
}
