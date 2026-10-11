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
  price_cents: number;
  currency: string;
  duration_minutes: number;
  thumb_path: string | null;
  card_path: string | null;
  detail_path: string | null;
  blurhash: string | null;
};

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
  let query = getSupabaseClient()
    .from("services")
    .select("id,provider_id,name,description,price_cents,currency,duration_minutes,thumb_path,card_path,detail_path,blurhash")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name");

  if (providerId) query = query.eq("provider_id", providerId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as PublicService[];
}

export const listPublishedProviders = withOfflineCache("listPublishedProviders", listPublishedProvidersRemote);
export const listPublicServices = withOfflineCache("listPublicServices", listPublicServicesRemote);
