import { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import ScheduleEditor from "./ScheduleEditor";
import ManualTurnsEditor from "./ManualTurnsEditor";
import LicenseRenewal from "./LicenseRenewal";
import AdminLicenses from "./AdminLicenses";
import AdminRoles from "./AdminRoles";
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
  type PortfolioItem,
  listMyPortfolio,
  savePortfolioItem,
  deletePortfolioItem,
  getSupabaseClient,
} from "@lumi/api";

type Tab = "agenda" | "servicios" | "trabajos" | "clientes" | "perfil";
const money = (amount: number, currency = "CUP") =>
  new Intl.NumberFormat("es-CU", { maximumFractionDigits: 2 }).format(amount / 100) + " " + currency;
const statusText: Record<string, string> = {
  pending_confirmation: "Por confirmar", confirmed: "Confirmada", cancelled: "Cancelada",
  rejected: "Rechazada", completed: "Completada"
};
const BRAND_ICONS = ["💅", "🌸", "✨", "🌷", "🦋", "💎", "🌺", "🤍", "🎀", "🌿", "⭐", "👑"];

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
  const [profileSection, setProfileSection] = useState<"business" | "license" | "schedule" | "account">("business");
  const [portfolioFilter, setPortfolioFilter] = useState("Todas");
  const [sessionEmail, setSessionEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<"licenses" | "roles" | "account">("licenses");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [appointments, setAppointments] = useState<ProviderAppointment[]>([]);
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bio, setBio] = useState("");
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
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("800");
  const [serviceDuration, setServiceDuration] = useState("45");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));

  const refresh = useCallback(async () => {
    const session = await getCurrentSession();
    setSessionEmail(session?.user.email ?? "");
    if (!session) {
      setIsAdmin(false);
      setProfile(null); setServices([]); setAppointments([]); setClients([]); setPortfolioItems([]); setInviteLink("");
      return;
    }
    const { data: adminFlag, error: adminError } = await getSupabaseClient().rpc("luni_is_admin");
    setIsAdmin(!adminError && adminFlag === true);
    const currentProfile = await getMyProviderProfile();
    setProfile(currentProfile);
    if (!currentProfile) {
      setServices([]); setAppointments([]); setClients([]); setPortfolioItems([]);
      return;
    }
    const [serviceRows, appointmentRows, clientRows, portfolioRows] = await Promise.all([
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
  const agendaAppointments = useMemo(() => filteredAppointments.filter(a => {
    if (agendaSection === "pending") return a.status === "pending_confirmation";
    if (agendaSection === "confirmed") return a.status === "confirmed";
    if (agendaSection === "completed") return a.status === "completed";
    return true;
  }), [filteredAppointments, agendaSection]);
  const activeServices = services.filter(s => s.is_active);
  const portfolioCategories = useMemo(() => ["Todas", ...Array.from(new Set(portfolioItems.map(item => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"))], [portfolioItems]);
  const filteredPortfolioItems = useMemo(() => portfolioFilter === "Todas" ? portfolioItems : portfolioItems.filter(item => item.category === portfolioFilter), [portfolioItems, portfolioFilter]);
  const pendingCount = appointments.filter(a => a.status === "pending_confirmation").length;

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
    if (services.length > 0) {
      setError("El catálogo de ejemplo solo se carga cuando el estudio no tiene servicios. Puedes añadir o editar cada precio manualmente.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    let created = 0;
    try {
      for (const item of STARTER_NAIL_CATALOG) {
        await saveProviderService({
          providerId: profile.id,
          name: item.name,
          description: item.description,
          priceCents: Math.round(item.price * 100),
          currency: "CUP",
          durationMinutes: item.minutes,
        });
        created++;
      }
      await refresh();
      setNotice(`Catálogo inicial cargado: ${created} servicios. Entra en «Editar» para ajustar cualquier precio, duración o descripción.`);
    } catch (e) {
      await refresh().catch(() => undefined);
      setError(`Se cargaron ${created} servicios antes del error. Puedes revisar el catálogo y volver a añadir los que falten. ${e instanceof Error ? e.message : "No se pudo completar la carga."}`);
    } finally { setBusy(false); }
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
        const processed = await processImageLocally(file);
        const variant = processed.variants.find(v => v.variant === "detail") ?? processed.variants.find(v => v.variant === "card") ?? processed.variants[0];
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
    <aside className="provider-sidebar"><div className="provider-brand"><div className="provider-mark">l<span>✦</span></div><div><b>luni</b><small>STUDIO</small></div></div><div className="studio-switch"><div className="studio-avatar">{profile?.business_name?.[0]?.toUpperCase() ?? "♡"}</div><div><b>{profile?.business_name ?? "Mi estudio"}</b><small>{sessionEmail || "Espacio de belleza"}</small></div><span>⌄</span></div><div className="side-label">ESPACIO DE TRABAJO</div><nav className="side-nav"><button className={tab==="agenda"?"selected":""} onClick={()=>setTab("agenda")}><span>▦</span> Agenda</button><button className={tab==="servicios"?"selected":""} onClick={()=>setTab("servicios")}><span>✧</span> Mis servicios</button><button className={tab==="trabajos"?"selected":""} onClick={()=>setTab("trabajos")}><span>▧</span> Trabajos terminados</button><button className={tab==="clientes"?"selected":""} onClick={()=>setTab("clientes")}><span>♙</span> Clientas</button><button className={tab==="perfil"?"selected":""} onClick={()=>setTab("perfil")}><span>⚙</span> Mi negocio</button></nav><div className="sidebar-bottom"><div className="help-mark">♡</div><b>Un espacio para crecer</b><p>Organiza tu tiempo. Cuida cada detalle.</p>{profile && <span className="trial-pill">LICENCIA: {profile.license_status.toUpperCase()}</span>}<div className="user-mini"><div className="studio-avatar">{sessionEmail ? sessionEmail[0].toUpperCase() : "♡"}</div><div><b>{sessionEmail || "Sin sesión"}</b><small>Mi cuenta</small></div><span>···</span></div></div></aside>
    <section className="provider-main"><header className="provider-header"><div className="mobile-brand"><div className="provider-mark">l<span>✦</span></div><b>luni studio</b></div><div className="breadcrumb">Mi estudio <span>/</span> <b>{tab==="agenda"?"Agenda":tab==="servicios"?"Mis servicios":tab==="trabajos"?"Trabajos terminados":tab==="clientes"?"Clientas":"Mi negocio"}</b></div><div className="header-actions"><span className="connection-dot" style={{background:loading?"#c3a56c":error?"#c65c5c":"#79a77a"}}></span><span className="connection-label">{loading ? "Conectando…" : error ? "Revisar conexión" : sessionEmail ? "Conectado a Supabase" : "Inicia sesión"}</span><button className="header-avatar" onClick={()=>setTab("perfil")}>{sessionEmail ? sessionEmail[0].toUpperCase() : "A"}</button></div></header>
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
          {adminTab === "account" && <div className="settings-card admin-account-card"><div className="settings-icon">⌁</div><div><h3>Sesión de administrador</h3><p>{sessionEmail}</p></div><button className="provider-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await signOut();setProfile(null);setServices([]);setAppointments([]);setSessionEmail("");setIsAdmin(false);setNotice("Sesión cerrada.");}catch(e){setError(e instanceof Error?e.message:"No se pudo cerrar sesión.");}finally{setBusy(false);}}}>Cerrar sesión</button></div>}
        </div>
      </div> : !profile ? <div className="workspace"><span className="eyebrow">PRIMER PASO</span><h1>Registra tu <em>estudio.</em></h1><p className="setup-description">Completa los datos básicos para empezar a administrar tus servicios.</p><div className="settings-card provider-setup-card"><label>Nombre del estudio<input value={businessName} onChange={e=>setBusinessName(e.target.value)} placeholder="Ej. Studio Ana"/></label><label>Descripción breve<textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Qué servicios ofreces y qué te distingue"/></label><div className="setup-brand-picker"><b>Personaliza la identidad de tu estudio</b><p>Si tienes logotipo, puedes subirlo; también puedes elegir un icono. Si no personalizas nada, usaremos 💅 por defecto.</p><div className="brand-logo-editor"><div className="brand-logo-preview">{brandLogoPreview ? <img src={brandLogoPreview} alt="Vista previa del logotipo" /> : <span>{newBrandIcon}</span>}</div><div className="brand-logo-actions"><label className="provider-secondary photo-pick">{brandLogoPreview ? "Cambiar logotipo" : "Subir logotipo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";pickBrandLogo(file);}} /></label>{brandLogoPreview && <button type="button" className="provider-secondary" disabled={busy} onClick={()=>{setBrandLogoFile(null);setBrandLogoPreview(prev=>{if(prev)URL.revokeObjectURL(prev);return null;});}}>Quitar selección</button>}</div><small>Opcional · JPG, PNG o WebP · máximo 8 MB.</small></div><b>O elige un icono</b><div className="studio-brand-options" role="group" aria-label="Icono inicial del estudio">{BRAND_ICONS.map(icon=><button type="button" key={icon} className={newBrandIcon===icon?"selected":""} aria-pressed={newBrandIcon===icon} disabled={busy} onClick={()=>setNewBrandIcon(icon)}>{icon}</button>)}</div></div><button className="provider-primary" disabled={busy||!businessName.trim()} onClick={()=>void createProfile()}>{busy?"Guardando…":"Registrar estudio"}</button></div></div> : <>
        {tab==="agenda" && <div className="workspace"><div className="welcome-row"><div><span className="eyebrow">TU AGENDA REAL</span><h1>Tu día, <em>a tu manera.</em></h1><p>Las citas se cargan desde tu cuenta de Luni.</p></div><label className="date-filter">Fecha<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label></div>
          <div className="metric-grid"><article className="metric-card"><span>CITAS DEL DÍA</span><div><b>{filteredAppointments.length}</b><i>▦</i></div><small>En la agenda</small></article><article className="metric-card"><span>INGRESOS PREVISTOS</span><div><b>{money(filteredAppointments.filter(a=>a.status==="confirmed"||a.status==="pending_confirmation").reduce((sum,a)=>sum+a.client_price_cents,0))}</b><i>♧</i></div><small>Confirmadas y pendientes</small></article><article className="metric-card"><span>POR CONFIRMAR</span><div><b>{filteredAppointments.filter(a=>a.status==="pending_confirmation").length}</b><i>◷</i></div><small>Requieren seguimiento</small></article></div>
          <section className="agenda-panel"><div className="agenda-heading"><div><h2>Agenda</h2><p>{profile.business_name}</p></div><button className="today-button" onClick={()=>setDay(new Date().toISOString().slice(0,10))}>Hoy ↗</button></div><div className="agenda-date"><b>{new Date(day+"T12:00:00").toLocaleDateString("es-CU",{weekday:"long",day:"numeric",month:"long"})}</b><span>{filteredAppointments.length} citas</span></div><div className="section-tabs provider-agenda-tabs" role="tablist" aria-label="Filtrar citas de la agenda"><button type="button" role="tab" aria-selected={agendaSection==="all"} className={agendaSection==="all"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("all")}>Todas <span>{filteredAppointments.length}</span></button><button type="button" role="tab" aria-selected={agendaSection==="pending"} className={agendaSection==="pending"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("pending")}>Por confirmar <span>{filteredAppointments.filter(a=>a.status==="pending_confirmation").length}</span></button><button type="button" role="tab" aria-selected={agendaSection==="confirmed"} className={agendaSection==="confirmed"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("confirmed")}>Confirmadas <span>{filteredAppointments.filter(a=>a.status==="confirmed").length}</span></button><button type="button" role="tab" aria-selected={agendaSection==="completed"} className={agendaSection==="completed"?"section-tab active":"section-tab"} onClick={()=>setAgendaSection("completed")}>Completadas <span>{filteredAppointments.filter(a=>a.status==="completed").length}</span></button></div><div className="appointment-list">{agendaAppointments.map(a=><article className="provider-appointment" key={a.id}><div className="appointment-time"><b>{new Date(a.starts_at).toLocaleTimeString("es-CU",{hour:"2-digit",minute:"2-digit"})}</b><span>{Math.max(1,Math.round((Date.parse(a.ends_at)-Date.parse(a.starts_at))/60000))} min</span></div><div className={"appointment-color "+(a.status==="confirmed"?"pink":a.status==="pending_confirmation"?"sand":"lilac")}></div><div className="appointment-details"><b>{a.client_service_name}</b><small>{a.client_display_name || "Clienta"} · {a.client_phone ? <a href={"tel:" + a.client_phone}>{a.client_phone}</a> : "Sin teléfono registrado"}</small><span>{money(a.client_price_cents,a.client_currency)} · {statusText[a.status] ?? a.status}</span><small>{a.notes || "Sin notas"}</small></div><div className="appointment-actions">{a.status==="pending_confirmation"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"confirmed")}>Confirmar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"rejected"});}}>Rechazar</button></>}{a.status==="confirmed"&&<><button className="provider-secondary" disabled={busy} onClick={()=>void changeAppointment(a.id,"completed")}>Completar</button><button className="provider-secondary" disabled={busy} onClick={()=>{setReasonText("");setReasonTarget({id:a.id,status:"cancelled"});}}>Cancelar</button></>}</div></article>)}{agendaAppointments.length===0&&<div className="provider-empty"><span>✧</span><b>{agendaSection==="all"?"Tu agenda está despejada":agendaSection==="pending"?"No hay citas por confirmar":agendaSection==="confirmed"?"No hay citas confirmadas":"No hay citas completadas"}</b><p>{agendaSection==="all"?"No hay citas registradas para esta fecha.":"Prueba otra pestaña o selecciona otra fecha."}</p></div>}</div></section>
        </div>}
        {tab==="servicios"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">LO QUE HACES MEJOR</span><h1>Mis <em>servicios.</em></h1><p>Los cambios se guardan en Supabase.</p></div><button className="provider-primary" onClick={openNewService}>＋ Añadir servicio</button></div><div className="provider-service-toolbar"><p>Define tus tarifas: cada servicio, descripción y duración se puede modificar sin afectar a otros estudios.</p>{services.length===0&&<button type="button" className="provider-secondary" disabled={busy} onClick={()=>void loadStarterCatalog()}>{busy?"Cargando catálogo…":"Cargar catálogo inicial de manicura y pedicura"}</button>}</div><div className="provider-service-grid">{activeServices.map((s,i)=><article className="provider-service-card" key={s.id}><div className={"provider-service-art art-"+(i%3)}>{s.card_path?<img className="service-photo" src={serviceImageUrl(s.card_path)??""} alt="" loading="lazy" decoding="async" onLoad={e=>e.currentTarget.classList.add("loaded")}/>:["✿","✧","❀"][i%3]}<span>{String(i+1).padStart(2,"0")}</span></div><div className="provider-service-content"><h3>{s.name}</h3><p>{s.description}</p><div><span>◷ {s.duration_minutes} min</span><b>{money(s.price_cents,s.currency)}</b></div><div className="appointment-actions"><button className="provider-secondary" disabled={busy} onClick={()=>openEditService(s)}>Editar</button><button className="provider-secondary" disabled={busy} onClick={()=>setDeleteTarget(s)}>Eliminar</button></div></div></article>)}</div>{activeServices.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes servicios</b><p>Añade tu primer servicio para completar el catálogo del estudio.</p><button className="provider-primary" onClick={openNewService}>Añadir servicio</button></div>}</div>}
        {tab==="trabajos"&&<div className="workspace"><div className="welcome-row"><div><span className="eyebrow">TU GALERÍA PÚBLICA</span><h1>Mis trabajos <em>terminados.</em></h1><p>Publica fotos reales para que futuras clientas conozcan tu estilo. Puedes incluir hasta 6 fotos en cada publicación.</p></div><button className="provider-primary" onClick={()=>{setEditingWorkId(null);setWorkTitle("");setWorkDescription("");setWorkCategory("Diseños");setWorkPhotos([]);setShowWorkForm(true);}}>＋ Publicar trabajo</button></div><div className="section-tabs portfolio-category-tabs" role="tablist" aria-label="Filtrar trabajos por categoría">{portfolioCategories.map(category=><button key={category} type="button" role="tab" aria-selected={portfolioFilter===category} className={portfolioFilter===category?"section-tab active":"section-tab"} onClick={()=>setPortfolioFilter(category)}>{category}<span>{category==="Todas"?portfolioItems.length:portfolioItems.filter(item=>item.category===category).length}</span></button>)}</div><div className="portfolio-work-grid">{filteredPortfolioItems.map(item=><article className="portfolio-work-card" key={item.id}><div className="portfolio-work-images">{item.image_paths.slice(0,3).map(path=><img key={path} src={getSupabaseClient().storage.from("service-images").getPublicUrl(path).data.publicUrl} alt={item.title||"Trabajo de uñas"} loading="lazy"/>)}</div><div className="portfolio-work-body"><span className="portfolio-work-category">{item.category}</span><h3>{item.title||item.category}</h3><p>{item.description||"Trabajo terminado publicado en tu galería."}</p><small>{item.image_paths.length} {item.image_paths.length===1?"foto":"fotos"} · {item.is_published?"Visible públicamente":"Oculto"}</small><div className="service-actions"><button className="provider-secondary" onClick={()=>{setEditingWorkId(item.id);setWorkTitle(item.title);setWorkDescription(item.description);setWorkCategory(item.category);setWorkPhotos([]);setShowWorkForm(true);}}>Editar</button><button className="provider-secondary" disabled={busy} onClick={async()=>{if(!window.confirm("¿Eliminar esta publicación de tu portafolio?"))return;setBusy(true);setError("");try{await deletePortfolioItem(profile.id,item.id);await refresh();setNotice("Publicación eliminada de la galería.");}catch(e){setError(e instanceof Error?e.message:"No se pudo eliminar el trabajo.");}finally{setBusy(false);}}}>Eliminar</button></div></div></article>)}</div>{portfolioItems.length>0&&filteredPortfolioItems.length===0&&<div className="provider-empty"><p>No hay trabajos en esta categoría.</p></div>}{portfolioItems.length===0&&<div className="provider-empty large-empty"><span>♡</span><b>Tu galería empieza aquí</b><p>Publica tu primer trabajo terminado con hasta 6 fotos.</p><button className="provider-primary" onClick={()=>setShowWorkForm(true)}>Publicar primer trabajo</button></div>}</div>}
        {tab==="clientes"&&<div className="workspace">
          <div className="welcome-row"><div><span className="eyebrow">CARTERA PRIVADA</span><h1>Tus <em>clientas.</em></h1><p>Cada clienta entra por tu invitación personal. Tu cartera es independiente de la de otras manicuristas.</p></div><button className="provider-primary" disabled={busy||!profile} onClick={()=>void createInvite()}>＋ Ver mi código permanente</button></div>
          {inviteLink&&<section className="invite-share-card"><span className="eyebrow">CÓDIGO PERMANENTE DEL ESTUDIO</span><h2>Invita a una nueva clienta</h2><p>Este es el código fijo que identifica tu estudio. No vence y no cambia cuando vuelves a mostrarlo. La clienta lo introduce en Luni Cliente para añadirte a su cartera.</p><div className="invite-link-row"><input className="invite-code-display" aria-label="Código de invitación" readOnly value={inviteLink}/><button className="provider-secondary" onClick={()=>void copyInviteLink()}>Copiar código</button></div><div className="invite-share-actions"><button className="provider-primary" onClick={()=>void shareInviteLink()}>Compartir invitación ↗</button><button className="provider-secondary" onClick={()=>setInviteLink("")}>Ocultar código</button></div></section>}
          <div className="client-portfolio-summary"><b>{clients.length}</b><span>{clients.length===1?"clienta conectada":"clientas conectadas"}</span><small>La información de cada clienta solo es visible para tu estudio.</small></div>
          {clients.length===0?<div className="provider-empty large-empty"><span>♡</span><b>Aún no tienes clientas vinculadas</b><p>Crea un código y compártelo por WhatsApp o muéstralo a la clienta para que lo introduzca en Luni Cliente. No existe un directorio público de clientas ni de estudios.</p><button className="provider-primary" disabled={busy||!profile} onClick={()=>void createInvite()}>Ver mi código permanente</button></div>
          :<div className="client-portfolio-list">{clients.map(client=><article className="client-portfolio-card" key={client.client_id}><div className="client-portfolio-avatar">{(client.display_name||"C").trim()[0]?.toUpperCase()}</div><div className="client-portfolio-main"><h3>{client.display_name||"Clienta de Luni"}</h3><p>{client.phone?<a href={"tel:"+client.phone}>{client.phone}</a>:"Sin teléfono registrado"}</p><small>Conectada desde {new Date(client.linked_at).toLocaleDateString("es-CU")}</small></div><div className="client-portfolio-stats"><b>{client.appointment_count}</b><span>{client.appointment_count===1?"cita":"citas"}</span><small>{client.last_appointment_at?"Última: "+new Date(client.last_appointment_at).toLocaleDateString("es-CU"):"Sin citas todavía"}</small></div></article>)}</div>}
        </div>}
        {tab==="perfil"&&<div className="workspace"><span className="eyebrow">TU MARCA, TUS REGLAS</span><h1>Mi <em>negocio.</em></h1><div className="section-tabs profile-section-tabs" role="tablist" aria-label="Secciones del negocio"><button type="button" role="tab" aria-selected={profileSection==="business"} className={profileSection==="business"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("business")}>Datos del estudio</button><button type="button" role="tab" aria-selected={profileSection==="license"} className={profileSection==="license"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("license")}>Licencia</button><button type="button" role="tab" aria-selected={profileSection==="schedule"} className={profileSection==="schedule"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("schedule")}>Horarios y turnos</button><button type="button" role="tab" aria-selected={profileSection==="account"} className={profileSection==="account"?"section-tab active":"section-tab"} onClick={()=>setProfileSection("account")}>Cuenta</button></div>{profileSection==="business"&&<><div className="settings-card"><div className="settings-avatar studio-brand-icon">{profile.brand_icon || "💅"}</div><div><h3>{profile.business_name}</h3><p>{profile.bio || "Sin descripción todavía."}</p><p>Prueba iniciada: {new Date(profile.trial_started_at).toLocaleDateString("es-CU")} · Estado: {profile.license_status}{profile.license_expires_at ? " · Vence: " + new Date(profile.license_expires_at).toLocaleDateString("es-CU") : ""}</p></div><span className="trial-pill">{profile.is_published?"RESERVAS ACTIVAS":"RESERVAS PAUSADAS"}</span></div><section className="settings-card studio-brand-customizer"><div className="settings-icon">✦</div><div className="studio-brand-copy"><h3>Identidad de tu estudio</h3><p>Si tienes un logotipo, súbelo aquí para que aparezca en Luni Cliente. Es opcional: si no lo tienes, se mostrará el icono que elijas abajo.</p><div className="brand-logo-editor"><div className="brand-logo-preview">{brandLogoPreview ? <img src={brandLogoPreview} alt="Vista previa del logotipo" /> : profile.avatar_path ? <img src={serviceImageUrl(profile.avatar_path) ?? ""} alt={"Logotipo de " + profile.business_name} /> : <span>{profile.brand_icon || "💅"}</span>}</div><div className="brand-logo-actions"><label className="provider-secondary photo-pick">{brandLogoPreview || profile.avatar_path ? "Cambiar logotipo" : "Elegir logotipo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";pickBrandLogo(file);}} /></label>{brandLogoFile && <button type="button" className="provider-primary" disabled={busy} onClick={()=>void saveBrandLogo()}>{busy?"Guardando…":"Guardar logotipo"}</button>}{profile.avatar_path && !brandLogoFile && <button type="button" className="provider-secondary" disabled={busy} onClick={()=>void removeBrandLogo()}>Quitar logotipo</button>}{brandLogoPreview && <button type="button" className="provider-secondary" disabled={busy} onClick={()=>{setBrandLogoFile(null);setBrandLogoPreview(prev=>{if(prev)URL.revokeObjectURL(prev);return null;});}}>Cancelar</button>}</div><small>JPG, PNG o WebP · máximo 8 MB. Se optimiza antes de subirlo.</small></div><h3>O elige un icono predeterminado</h3><div className="studio-brand-options" role="group" aria-label="Icono del estudio">{BRAND_ICONS.map(icon=><button type="button" key={icon} className={(profile.brand_icon || "💅")===icon?"selected":""} aria-pressed={(profile.brand_icon || "💅")===icon} disabled={busy} onClick={()=>void saveBrandIcon(icon)}>{icon}</button>)}</div></div></section><div className="settings-card"><div className="settings-icon">↗</div><div><h3>Reservas por invitación</h3><p>{profile.is_published?"Tu estudio puede aceptar reservas de clientas vinculadas por invitación.":"Activa las reservas cuando tengas servicios y horarios listos. Tu estudio no aparecerá en un directorio público."}</p></div><button className="provider-secondary" disabled={busy||activeServices.length===0&&!profile.is_published} onClick={()=>void publishProfile()}>{profile.is_published?"Pausar reservas":"Activar reservas"}</button></div></>}{profileSection==="license"&&<div className="profile-section-panel">{!isAdmin && <LicenseRenewal providerId={profile.id} />}<AdminLicenses /></div>}{profileSection==="schedule"&&<div className="profile-section-panel"><ManualTurnsEditor providerId={profile.id} appointments={appointments} timezone={profile.timezone || "America/Havana"} /><ScheduleEditor providerId={profile.id} appointments={appointments} timezone={profile.timezone || "America/Havana"} legacyScheduleHidden /></div>}{profileSection==="account"&&<div className="profile-section-panel"><div className="settings-card"><div className="settings-icon">⌁</div><div><h3>Cuenta</h3><p>{sessionEmail}</p></div><button className="provider-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await signOut();setProfile(null);setServices([]);setAppointments([]);setSessionEmail("");setNotice("Sesión cerrada.");}catch(e){setError(e instanceof Error?e.message:"No se pudo cerrar sesión.");}finally{setBusy(false);}}}>Cerrar sesión</button></div></div>}
      </div>}
      <footer className="provider-footer"><span>luni studio</span><span>Hecho con cuidado, para quienes cuidan. ♡</span></footer>
      </>}
    </section>
    {showMobileNav && <nav className="mobile-nav" aria-label="Navegación principal">
      {([["agenda", "Agenda", "▦"], ["servicios", "Servicios", "✧"], ["trabajos", "Trabajos", "▧"], ["clientes", "Clientas", "♙"], ["perfil", "Negocio", "⚙"]] as const).map(([id, label, icon]) =>
        <button key={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
    </nav>}
    {deleteTarget&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="delete-service-title"><button className="modal-close" onClick={()=>setDeleteTarget(null)} aria-label="Cerrar">×</button><span className="eyebrow">ELIMINAR SERVICIO</span><h2 id="delete-service-title">¿Eliminar <em>{deleteTarget.name}</em>?</h2><p>Dejará de mostrarse a tus clientas. Las citas ya reservadas conservan su nombre y precio.</p><button className="provider-primary full-provider-button" disabled={busy} onClick={()=>void removeService()}>{busy?"Eliminando…":"Sí, eliminar"}</button><button className="provider-secondary full-provider-button" disabled={busy} onClick={()=>setDeleteTarget(null)}>No, conservar</button></section></div>}
    {reasonTarget&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="reason-title"><button className="modal-close" onClick={()=>setReasonTarget(null)} aria-label="Cerrar">×</button><span className="eyebrow">{reasonTarget.status==="rejected"?"RECHAZAR CITA":"CANCELAR CITA"}</span><h2 id="reason-title">Avisa a la <em>clienta.</em></h2><label>Motivo (opcional)<input value={reasonText} maxLength={200} onChange={e=>setReasonText(e.target.value)} placeholder="Ej. Ese día no podré atender"/></label><button className="provider-primary full-provider-button" disabled={busy} onClick={async()=>{const t=reasonTarget;setReasonTarget(null);await changeAppointment(t.id,t.status,reasonText);}}>{reasonTarget.status==="rejected"?"Rechazar cita":"Cancelar cita"}</button></section></div>}
    {showWorkForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-work-title"><button className="modal-close" onClick={()=>{setShowWorkForm(false);setEditingWorkId(null);setWorkPhotos([]);}} aria-label="Cerrar">×</button><span className="eyebrow">PORTAFOLIO DE TRABAJOS</span><h2 id="portfolio-work-title">{editingWorkId?"Editar":"Publicar"} <em>trabajo terminado.</em></h2><label>Título (opcional)<input maxLength={120} value={workTitle} onChange={e=>setWorkTitle(e.target.value)} placeholder="Ej. Francesa con detalles dorados"/></label><label>Categoría<select value={workCategory} onChange={e=>setWorkCategory(e.target.value)}><option>Diseños</option><option>Acrílicas</option><option>Semipermanente</option><option>Manicura</option><option>Pedicura</option><option>Gel</option><option>Novias y eventos</option><option>Otros</option></select></label><label>Descripción<textarea maxLength={1000} value={workDescription} onChange={e=>setWorkDescription(e.target.value)} placeholder="Cuenta qué técnica o diseño realizaste"/></label><label>Fotos (hasta 6 en total; JPG, PNG o WebP)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setWorkPhotos(Array.from(e.target.files??[]).slice(0,6))}/></label><p>{workPhotos.length} foto(s) nuevas seleccionadas. Las fotos se optimizan antes de subirlas a Supabase Storage.</p><button className="provider-primary full-provider-button" disabled={busy||photoBusy||(!editingWorkId&&workPhotos.length===0)} onClick={()=>void createPortfolioPost()}>{busy?"Publicando…":editingWorkId?"Guardar cambios":"Publicar trabajo"}</button></section></div>}
    {showServiceForm&&<div className="provider-modal-backdrop"><section className="provider-modal" role="dialog" aria-modal="true" aria-labelledby="new-service-title"><button className="modal-close" onClick={()=>setShowServiceForm(false)} aria-label="Cerrar">×</button><span className="eyebrow">{editingServiceId?"AJUSTA TU CATÁLOGO":"AMPLÍA TU CATÁLOGO"}</span><h2 id="new-service-title">{editingServiceId?<>Editar <em>servicio.</em></>:<>Nuevo <em>servicio.</em></>}</h2><label>Nombre del servicio<input value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="Ej. Manicura clásica"/></label><label>Descripción<input value={serviceDescription} onChange={e=>setServiceDescription(e.target.value)} placeholder="Describe brevemente el servicio"/></label><div className="photo-field"><span>Foto del servicio</span>{(photo||(savedPhotoPath&&!removePhoto))?<img className="photo-preview" src={photo?.previewUrl??serviceImageUrl(savedPhotoPath)??""} alt="Foto del servicio"/>:<div className="photo-empty">Sin foto</div>}<div className="photo-actions"><label className="provider-secondary photo-pick">{(photo||(savedPhotoPath&&!removePhoto))?"Cambiar foto":"Añadir foto"}<input type="file" accept="image/*" hidden disabled={busy||photoBusy} onChange={e=>{const f=e.target.files?.[0];e.target.value="";void pickPhoto(f);}}/></label>{(photo||(savedPhotoPath&&!removePhoto))&&<button type="button" className="provider-secondary" disabled={busy||photoBusy} onClick={()=>{if(photo)resetPhoto();else setRemovePhoto(true);}}>{photo?"Descartar":"Quitar foto"}</button>}</div>{photoBusy&&<small>Preparando la foto en tu teléfono…</small>}{!photoBusy&&photoInfo&&<small>{photoInfo}</small>}{photoError&&<small className="photo-error" role="alert">{photoError}</small>}</div><label>Precio (CUP)<input inputMode="decimal" value={servicePrice} onChange={e=>setServicePrice(e.target.value)} /></label><label>Duración en minutos<input type="number" min="1" max="1440" value={serviceDuration} onChange={e=>setServiceDuration(e.target.value)} /></label><p>El precio se guarda en centavos en la base de datos. Ejemplo: 800 CUP se guarda como 80000.</p><button className="provider-primary full-provider-button" disabled={busy||photoBusy||!serviceName.trim()} onClick={()=>void createService()}>{busy?(photoInfo.startsWith("Subiendo")?photoInfo:"Guardando…"):"Guardar servicio"}</button></section></div>}
  </main>;
}
