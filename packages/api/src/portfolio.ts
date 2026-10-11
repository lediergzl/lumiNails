import { getSupabaseClient } from "./client";
import { withOfflineCache } from "./offline";

export type PortfolioItem = {
  id: string;
  provider_id: string;
  title: string;
  description: string;
  category: string;
  image_paths: string[];
  is_published: boolean;
  created_at: string;
};

export type PublicPortfolioItem = PortfolioItem & {
  business_name: string;
  provider_slug: string;
  provider_bio: string;
};

async function listMyPortfolioRemote(providerId: string): Promise<PortfolioItem[]> {
  const { data, error } = await getSupabaseClient()
    .from("provider_portfolio_items")
    .select("id,provider_id,title,description,category,image_paths,is_published,created_at")
    .eq("provider_id", providerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PortfolioItem[];
}

async function listPublicPortfolioRemote(): Promise<PublicPortfolioItem[]> {
  const { data, error } = await getSupabaseClient().rpc("luni_public_portfolio");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    id: String(row.item_id),
    provider_id: String(row.provider_id),
    business_name: String(row.business_name ?? ""),
    provider_slug: String(row.provider_slug ?? ""),
    provider_bio: String(row.provider_bio ?? ""),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    category: String(row.category ?? "Diseños"),
    image_paths: Array.isArray(row.image_paths) ? row.image_paths.map(String) : [],
    is_published: true,
    created_at: String(row.created_at ?? ""),
  }));
}

export async function savePortfolioItem(input: {
  providerId: string;
  id?: string;
  title: string;
  description: string;
  category: string;
  imagePaths: string[];
  isPublished: boolean;
}): Promise<string> {
  const title = input.title.trim();
  const description = input.description.trim();
  const category = input.category.trim();
  if (title.length > 120) throw new Error("El título no puede superar 120 caracteres.");
  if (description.length > 1000) throw new Error("La descripción no puede superar 1000 caracteres.");
  if (!category || category.length > 60) throw new Error("Selecciona una categoría válida.");
  if (input.imagePaths.length > 6) throw new Error("Cada publicación admite hasta 6 fotos.");
  const payload = {
    provider_id: input.providerId,
    title,
    description,
    category,
    image_paths: input.imagePaths,
    is_published: input.isPublished,
    updated_at: new Date().toISOString(),
  };
  const supabase = getSupabaseClient();
  if (input.id) {
    const { error } = await supabase.from("provider_portfolio_items").update(payload)
      .eq("id", input.id).eq("provider_id", input.providerId);
    if (error) throw new Error(error.message);
    return input.id;
  }
  const { data, error } = await supabase.from("provider_portfolio_items")
    .insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function deletePortfolioItem(providerId: string, itemId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error: readError } = await supabase.from("provider_portfolio_items")
    .select("image_paths").eq("id", itemId).eq("provider_id", providerId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!data) throw new Error("La publicación ya no existe.");
  if (data.image_paths?.length) {
    const { error: storageError } = await supabase.storage.from("service-images").remove(data.image_paths);
    if (storageError) throw new Error("No se pudieron borrar las fotos: " + storageError.message);
  }
  const { error } = await supabase.from("provider_portfolio_items")
    .update({ deleted_at: new Date().toISOString(), is_published: false, updated_at: new Date().toISOString() })
    .eq("id", itemId).eq("provider_id", providerId);
  if (error) throw new Error(error.message);
}

export const listMyPortfolio = withOfflineCache("listMyPortfolio", listMyPortfolioRemote);
export const listPublicPortfolio = withOfflineCache("listPublicPortfolio", listPublicPortfolioRemote);
