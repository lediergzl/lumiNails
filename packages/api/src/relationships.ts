import { getSupabaseClient } from "./client";

export type ClientProvider = {
  provider_id: string;
  business_name: string;
  slug: string;
  bio: string;
  relationship_id: string;
  linked_at: string;
};

export type ProviderInvitePreview = {
  provider_id: string;
  business_name: string;
  slug: string;
  bio: string;
  invite_valid: boolean;
};

export type ProviderClient = {
  client_id: string;
  display_name: string;
  phone: string | null;
  linked_at: string;
  appointment_count: number;
  last_appointment_at: string | null;
};

export async function createProviderInvite(providerId: string): Promise<{ token: string; expires_at: string }> {
  const { data, error } = await getSupabaseClient()
    .rpc("luni_create_provider_invite", { p_provider_id: providerId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) throw new Error("No se pudo crear el enlace de invitación.");
  return row as { token: string; expires_at: string };
}

export async function previewProviderInvite(token: string): Promise<ProviderInvitePreview | null> {
  const clean = token.trim();
  if (!clean) return null;
  const { data, error } = await getSupabaseClient()
    .rpc("luni_preview_provider_invite", { p_token: clean });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row ? row as ProviderInvitePreview : null;
}

export async function acceptProviderInvite(token: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .rpc("luni_accept_provider_invite", { p_token: token.trim() });
  if (error) throw new Error(error.message);
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error("La invitación no es válida o ha vencido.");
  }
}

export async function listMyClientProviders(): Promise<ClientProvider[]> {
  const { data, error } = await getSupabaseClient().rpc("luni_my_client_providers");
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientProvider[];
}

export async function listMyClientProviderBrandIcons(): Promise<Array<{ provider_id: string; brand_icon: string }>> {
  const { data, error } = await getSupabaseClient().rpc("luni_my_client_provider_brand_icons");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ provider_id: string; brand_icon: string }>;
}

export async function removeClientProvider(providerId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .rpc("luni_remove_client_provider", { p_provider_id: providerId });
  if (error) throw new Error(error.message);
}

export async function listProviderClients(providerId: string): Promise<ProviderClient[]> {
  const { data, error } = await getSupabaseClient()
    .rpc("luni_provider_clients", { p_provider_id: providerId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderClient[];
}
