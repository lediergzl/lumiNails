import { getSupabaseClient } from "./client";

export type ProviderProfile = {
  id: string;
  user_id: string;
  slug: string;
  business_name: string;
  bio: string;
  avatar_path: string | null;
  trial_started_at: string;
  license_expires_at: string | null;
  license_status: "trial" | "active" | "grace" | "expired" | "suspended";
  is_published: boolean;
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
};

export async function getMyProviderProfile(): Promise<ProviderProfile | null> {
  const { data: { user }, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) return null;
  const { data, error } = await getSupabaseClient()
    .from("provider_profiles")
    .select("id,user_id,slug,business_name,bio,avatar_path,trial_started_at,license_expires_at,license_status,is_published,timezone")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProviderProfile | null;
}

export async function createMyProviderProfile(businessName: string, bio = ""): Promise<ProviderProfile> {
  const { data: { user }, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!user) throw new Error("Inicia sesión para registrar tu estudio.");
  const cleanName = businessName.trim();
  if (!cleanName) throw new Error("Escribe el nombre de tu estudio.");
  const slugBase = cleanName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 35) || "estudio";
  const slug = `${slugBase}-${user.id.slice(0, 8)}`;
  const { data, error } = await getSupabaseClient()
    .from("provider_profiles")
    .insert({ user_id: user.id, slug, business_name: cleanName, bio: bio.trim() })
    .select("id,user_id,slug,business_name,bio,avatar_path,trial_started_at,license_expires_at,license_status,is_published")
    .single();
  if (error) throw new Error(error.message);
  return data as ProviderProfile;
}

export async function listMyProviderServices(providerId: string): Promise<ProviderService[]> {
  const { data, error } = await getSupabaseClient()
    .from("services")
    .select("id,provider_id,name,description,price_cents,currency,duration_minutes,is_active,thumb_path")
    .eq("provider_id", providerId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderService[];
}

export async function saveProviderService(input: {
  providerId: string;
  id?: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  durationMinutes: number;
}): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre del servicio es obligatorio.");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new Error("El precio debe ser un número válido.");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) throw new Error("La duración debe estar entre 1 y 1440 minutos.");
  const supabase = getSupabaseClient();
  const payload = {
    provider_id: input.providerId,
    name,
    description: input.description.trim(),
    price_cents: input.priceCents,
    currency: input.currency,
    duration_minutes: input.durationMinutes,
    is_active: true,
  };
  if (input.id) {
    const { error } = await supabase.from("services").update(payload)
      .eq("id", input.id).eq("provider_id", input.providerId);
    if (error) throw new Error(error.message);
    return input.id;
  }
  const { data, error } = await supabase.from("services").insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function setProviderServiceActive(providerId: string, serviceId: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from("services").update({ is_active: isActive })
    .eq("id", serviceId).eq("provider_id", providerId);
  if (error) throw new Error(error.message);
}

export async function setProviderServicePhoto(providerId: string, serviceId: string, thumbPath: string): Promise<void> {
  const { error } = await getSupabaseClient().from("services").update({ thumb_path: thumbPath })
    .eq("id", serviceId).eq("provider_id", providerId);
  if (error) throw new Error(error.message);
}

export async function listProviderAppointments(providerId: string): Promise<ProviderAppointment[]> {
  const { data, error } = await getSupabaseClient()
    .rpc("luni_provider_appointments_with_contacts", { p_provider_id: providerId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderAppointment[];
}

export async function setProviderAppointmentStatus(
  appointmentId: string,
  status: "confirmed" | "rejected" | "completed" | "cancelled",
  reason = ""
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("appointments")
    .update({
      status,
      cancellation_reason: status === "cancelled" || status === "rejected" ? reason.trim() : "",
    })
    .eq("id", appointmentId);
  if (error) throw new Error(error.message);
}
