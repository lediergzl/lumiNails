import { getSupabaseClient } from "./client";
import { isNetworkError, registerOutboxHandler, withOfflineCache, writeOrQueue } from "./offline";
import { clearServiceImageRemote } from "./serviceImages";

export type ProviderProfile = {
  id: string;
  user_id: string;
  slug: string;
  business_name: string;
  bio: string;
  business_phone: string | null;
  business_location: string | null;
  avatar_path: string | null;
  brand_icon: string;
  trial_started_at: string;
  license_expires_at: string | null;
  license_status: "trial" | "active" | "grace" | "expired" | "suspended";
  is_published: boolean;
  auto_confirm_appointments: boolean;
  timezone: string;
};

export type ProviderService = {
  id: string;
  provider_id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  duration_minutes: number;
  is_active: boolean;
  thumb_path: string | null;
  card_path: string | null;
};

export type ProviderAppointment = {
  id: string;
  provider_id: string;
  client_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: "pending_confirmation" | "confirmed" | "cancelled" | "rejected" | "completed";
  notes: string;
  client_service_name: string;
  client_price_cents: number;
  client_currency: string;
  cancellation_reason?: string;
  client_display_name?: string;
  client_phone?: string | null;
  payment_received?: boolean;
};

async function getMyProviderProfileRemote(): Promise<ProviderProfile | null> {
  const { data: { user }, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) return null;
  const { data, error } = await getSupabaseClient()
    .from("provider_profiles")
    .select("id,user_id,slug,business_name,bio,business_phone,business_location,avatar_path,brand_icon,trial_started_at,license_expires_at,license_status,is_published,auto_confirm_appointments,timezone")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProviderProfile | null;
}

export async function createMyProviderProfile(businessName: string, bio = "", brandIcon = "💅"): Promise<ProviderProfile> {
  const { data: { user }, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("Inicia sesión para registrar tu estudio.");
  const cleanName = businessName.trim();
  if (!cleanName) throw new Error("Escribe el nombre de tu estudio.");
  const slugBase = cleanName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35) || "estudio";
  const slug = `${slugBase}-${user.id.slice(0, 8)}`;
  const { data, error } = await getSupabaseClient()
    .from("provider_profiles")
    .insert({ user_id: user.id, slug, business_name: cleanName, bio: bio.trim(), brand_icon: brandIcon })
    .select("id,user_id,slug,business_name,bio,avatar_path,brand_icon,trial_started_at,license_expires_at,license_status,is_published,timezone")
    .single();
  if (error) throw new Error(error.message);
  return data as ProviderProfile;
}

async function listMyProviderServicesRemote(providerId: string): Promise<ProviderService[]> {
  const { data, error } = await getSupabaseClient()
    .from("services")
    .select("id,provider_id,name,description,price_cents,currency,duration_minutes,is_active,thumb_path,card_path")
    .eq("provider_id", providerId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderService[];
}

type ServiceInput = {
  providerId: string;
  id?: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  durationMinutes: number;
};

/** Servicio ya validado; `create` indica un alta con id generado en el dispositivo (válida sin conexión). */
type ServicePayload = ServiceInput & { id: string; create: boolean };

async function saveProviderServiceRemote(input: ServicePayload): Promise<string> {
  const supabase = getSupabaseClient();
  const payload = {
    provider_id: input.providerId,
    name: input.name,
    description: input.description,
    price_cents: input.priceCents,
    currency: input.currency,
    duration_minutes: input.durationMinutes,
  };
  if (input.create) {
    const { error } = await supabase.from("services").insert({ ...payload, id: input.id, is_active: true });
    // Si un intento anterior sí llegó al servidor, el reintento no debe fallar ni duplicar.
    if (error && !/duplicate key|already exists/i.test(error.message)) throw new Error(error.message);
    return input.id;
  }
  // Al editar no se toca is_active: así un servicio pausado no se reactiva solo.
  const result = await supabase.from("services").update(payload).eq("id", input.id).eq("provider_id", input.providerId).select("id");
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.length) throw new Error("No se pudo guardar el servicio. Es posible que ya no exista.");
  return input.id;
}

/** Guarda el servicio; sin conexión queda en cola y se envía al volver la red (`queued: true`). */
export async function saveProviderService(input: ServiceInput): Promise<{ id: string; queued: boolean }> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre del servicio es obligatorio.");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new Error("El precio debe ser un número válido.");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) throw new Error("La duración debe estar entre 1 y 1440 minutos.");
  const payload: ServicePayload = {
    ...input,
    name,
    description: input.description.trim(),
    id: input.id ?? crypto.randomUUID(),
    create: !input.id,
  };
  const fields = { name: payload.name, description: payload.description, price_cents: payload.priceCents, currency: payload.currency, duration_minutes: payload.durationMinutes };
  const outcome = await writeOrQueue(
    {
      type: "service.save",
      payload,
      label: `Servicio «${name}»`,
      patches: [
        payload.create
          ? { read: "listMyProviderServices", op: "upsert", id: payload.id, item: { id: payload.id, provider_id: payload.providerId, ...fields, is_active: true, thumb_path: null, card_path: null } }
          : { read: "listMyProviderServices", op: "merge", id: payload.id, changes: fields },
      ],
    },
    () => saveProviderServiceRemote(payload)
  );
  return { id: payload.id, queued: outcome.queued };
}

/** Borrado lógico: las citas existentes conservan nombre y precio en su propia copia. */
async function deleteProviderServiceRemote(providerId: string, serviceId: string): Promise<void> {
  await clearServiceImageRemote(providerId, serviceId).catch(() => undefined); // liberar espacio; si falla, el borrado sigue
  const { data, error } = await getSupabaseClient()
    .from("services")
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq("id", serviceId)
    .eq("provider_id", providerId)
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No se pudo eliminar el servicio. Es posible que ya no exista.");
}

export async function deleteProviderService(providerId: string, serviceId: string, label = "Servicio"): Promise<{ queued: boolean }> {
  const outcome = await writeOrQueue(
    {
      type: "service.delete",
      payload: { providerId, serviceId },
      label: `Eliminar ${label}`,
      patches: [{ read: "listMyProviderServices", op: "remove", id: serviceId }],
    },
    () => deleteProviderServiceRemote(providerId, serviceId)
  );
  return { queued: outcome.queued };
}

async function listProviderAppointmentsRemote(providerId: string): Promise<ProviderAppointment[]> {
  const { data, error } = await getSupabaseClient()
    .rpc("luni_provider_appointments_with_contacts", { p_provider_id: providerId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderAppointment[];
}

async function setProviderAppointmentStatusRemote(
  appointmentId: string,
  status: "confirmed" | "rejected" | "completed" | "cancelled",
  reason: string
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("appointments")
    .update({
      status,
      cancellation_reason: status === "cancelled" || status === "rejected" ? reason.trim() : "",
    })
    .eq("id", appointmentId);
  if (error) throw new Error(error.message.includes("APPOINTMENT_STATUS_CHANGE_FORBIDDEN") ? "Esa cita ya no admite este cambio. Actualiza la lista." : error.message);
}

/** Cambia el estado de la cita; sin conexión queda en cola y se envía al volver la red (`queued: true`). */
export async function setProviderAppointmentStatus(
  appointmentId: string,
  status: "confirmed" | "rejected" | "completed" | "cancelled",
  reason = "",
  label = ""
): Promise<{ queued: boolean }> {
  const cleanReason = status === "cancelled" || status === "rejected" ? reason.trim() : "";
  const outcome = await writeOrQueue(
    {
      type: "appointment.status",
      payload: { appointmentId, status, reason: cleanReason },
      label: label || "Cambio en una cita",
      patches: [{ read: "listProviderAppointments", op: "merge", id: appointmentId, changes: { status, cancellation_reason: cleanReason } }],
    },
    () => setProviderAppointmentStatusRemote(appointmentId, status, cleanReason)
  );
  return { queued: outcome.queued };
}

registerOutboxHandler("appointment.status", (p: { appointmentId: string; status: "confirmed" | "rejected" | "completed" | "cancelled"; reason: string }) =>
  setProviderAppointmentStatusRemote(p.appointmentId, p.status, p.reason));
registerOutboxHandler("service.save", (p: ServicePayload) => saveProviderServiceRemote(p));
registerOutboxHandler("service.delete", (p: { providerId: string; serviceId: string }) => deleteProviderServiceRemote(p.providerId, p.serviceId));

export const getMyProviderProfile = withOfflineCache("getMyProviderProfile", getMyProviderProfileRemote);
export const listMyProviderServices = withOfflineCache("listMyProviderServices", listMyProviderServicesRemote);
export const listProviderAppointments = withOfflineCache("listProviderAppointments", listProviderAppointmentsRemote);

async function getIsAdminRemote(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("luni_is_admin");
  if (error) {
    if (isNetworkError(error.message)) throw new Error(error.message); // sin red: que decida la copia guardada
    return false;
  }
  return data === true;
}
export const getIsAdmin = withOfflineCache("getIsAdmin", getIsAdminRemote);
