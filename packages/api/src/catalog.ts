import { getSupabaseClient } from "./client";
import { withOfflineCache } from "./offline";

export type PublicProvider = {
  id: string;
  slug: string;
  business_name: string;
  bio: string;
  business_phone: string | null;
  business_location: string | null;
  avatar_path: string | null;
  brand_icon: string;
};

export type PublicService = {
  id: string;
  provider_id: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  currency: string;
  duration_minutes: number;
  thumb_path: string | null;
  card_path: string | null;
  detail_path: string | null;
  blurhash: string | null;
};

export const SERVICE_CATEGORIES = [
  "Manicura",
  "Extensiones",
  "Uñas naturales",
  "Rellenos",
  "Diseños y decoración",
  "Pedicura",
  "Retirada",
  "Tratamientos",
  "Otros",
] as const;

export type ServiceCategory = typeof SERVICE_CATEGORIES[number];

/** Clasificación inicial para catálogos antiguos y servicios creados sin categoría explícita. */
export function inferServiceCategory(name: string, description = ""): ServiceCategory {
  const text = (name + " " + description)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CU");
  if (text.includes("pedicura") || text.includes("pedicure")) return "Pedicura";
  if (/\brellen[oa]s?\b/.test(text)) return "Rellenos";
  if (/\bretirad[ao]\b|\bretiro\b|\bquitar\b/.test(text)) return "Retirada";
  if (/unas naturales|rubber base natural|esmalte semipermanente/.test(text)) return "Uñas naturales";
  if (/diseno|decoracion|encapsulad|ojo de gato|aurora|efecto espejo|azucar|baby boomer|difuminad|cromad|joyeria|piedras|calcoman|relieve|francesa/.test(text)) return "Diseños y decoración";
  if (/unas nuevas|acrilic|acripie|tips|extension|cover/.test(text)) return "Extensiones";
  if (/hidrat|tratamiento|parafina|cuticula|reparacion|fortalecimiento/.test(text)) return "Tratamientos";
  if (/manicura|unas|gel|rubber|esmalte|pintura/.test(text)) return "Manicura";
  return "Otros";
}

async function listPublishedProvidersRemote(): Promise<PublicProvider[]> {
  const { data, error } = await getSupabaseClient()
    .from("provider_profiles")
    .select("id,slug,business_name,bio,business_phone,business_location,avatar_path,brand_icon")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("business_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicProvider[];
}

async function listPublicServicesRemote(providerId?: string): Promise<PublicService[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("services")
    .select("id,provider_id,name,description,category,price_cents,currency,duration_minutes,thumb_path,card_path,detail_path,blurhash")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name");
  if (providerId) query = query.eq("provider_id", providerId);

  const result = await query;
  if (!result.error) return (result.data ?? []) as PublicService[];

  // Permite que una versión recién instalada siga leyendo el catálogo mientras
  // el administrador aplica la migración de categorías en Supabase.
  const categoryColumnMissing = /category.*(schema cache|does not exist|not found)|column .*category/i.test(result.error.message);
  if (!categoryColumnMissing) throw new Error(result.error.message);

  let legacyQuery = supabase
    .from("services")
    .select("id,provider_id,name,description,price_cents,currency,duration_minutes,thumb_path,card_path,detail_path,blurhash")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name");
  if (providerId) legacyQuery = legacyQuery.eq("provider_id", providerId);
  const legacy = await legacyQuery;
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []).map(service => ({
    ...service,
    category: inferServiceCategory(service.name, service.description),
  })) as PublicService[];
}

export const listPublishedProviders = withOfflineCache("listPublishedProviders", listPublishedProvidersRemote);
export const listPublicServices = withOfflineCache("listPublicServices", listPublicServicesRemote);
