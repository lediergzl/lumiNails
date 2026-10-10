import { getSupabaseClient } from "./client";

export const SERVICE_IMAGE_BUCKET = "service-images";

/** Forma mínima de lo que produce @lumi/image-processor (la API no depende de ese paquete). */
export type ServiceImageUpload = {
  blurhash: string;
  variants: Array<{ variant: "thumb" | "card" | "detail" | "original"; file: Blob; sha256: string }>;
};

export type ServiceImageProgress = { done: number; total: number; variant: string };

// Pensado para conexiones lentas: archivos diminutos, un tiempo de espera por intento y reintentos con pausa creciente.
const ATTEMPT_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [1_500, 4_000, 9_000];

class NonRetryableError extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function friendlyUploadError(error: Error): Error {
  if (error instanceof NonRetryableError) return error;
  return new Error("Conexión lenta o sin señal. Inténtalo de nuevo cuando mejore.");
}

async function uploadOne(path: string, blob: Blob): Promise<void> {
  const storage = getSupabaseClient().storage.from(SERVICE_IMAGE_BUCKET);
  let lastError: Error = new Error("Sin conexión");
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const { error } = await withTimeout(
        storage.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false }),
        ATTEMPT_TIMEOUT_MS
      );
      if (!error) return;
      // El nombre incluye el hash del contenido: si ya existe, es la misma imagen (p. ej. un intento anterior que sí llegó).
      if (/already exists|duplicate/i.test(error.message)) return;
      if (/row-level security|policy|not allowed|mime|too large|exceeded|unauthorized/i.test(error.message)) {
        throw new NonRetryableError("No tienes permiso para subir esta foto o el archivo no es válido.");
      }
      lastError = new Error(error.message);
    } catch (e) {
      if (e instanceof NonRetryableError) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw friendlyUploadError(lastError);
}

async function removeFiles(paths: Array<string | null | undefined>): Promise<void> {
  const list = paths.filter((p): p is string => Boolean(p));
  if (!list.length) return;
  try { await getSupabaseClient().storage.from(SERVICE_IMAGE_BUCKET).remove(list); } catch { /* mejor esfuerzo */ }
}

type StoredPaths = { thumb_path: string | null; card_path: string | null; detail_path: string | null };

async function readPaths(providerId: string, serviceId: string): Promise<StoredPaths | null> {
  const { data, error } = await getSupabaseClient()
    .from("services")
    .select("thumb_path,card_path,detail_path")
    .eq("id", serviceId)
    .eq("provider_id", providerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as StoredPaths | null;
}

/** Sube las variantes (la más pequeña primero), enlaza la foto al servicio y borra la anterior. */
export async function setServiceImage(
  providerId: string,
  serviceId: string,
  image: ServiceImageUpload,
  onProgress?: (progress: ServiceImageProgress) => void
): Promise<void> {
  const previous = await readPaths(providerId, serviceId);
  const ordered = [...image.variants].sort((a, b) => a.file.size - b.file.size);
  const paths: Partial<Record<string, string>> = {};
  const uploaded: string[] = [];

  try {
    for (const [index, item] of ordered.entries()) {
      onProgress?.({ done: index, total: ordered.length, variant: item.variant });
      const ext = item.file.type === "image/webp" ? "webp" : "jpg";
      const path = `${providerId}/${serviceId}/${item.sha256.slice(0, 16)}-${item.variant}.${ext}`;
      await uploadOne(path, item.file);
      paths[item.variant] = path;
      uploaded.push(path);
    }
    onProgress?.({ done: ordered.length, total: ordered.length, variant: "" });

    const cardHash = image.variants.find((v) => v.variant === "card")?.sha256 ?? image.variants[0]?.sha256 ?? null;
    const { data, error } = await getSupabaseClient()
      .from("services")
      .update({
        thumb_path: paths.thumb ?? null,
        card_path: paths.card ?? null,
        detail_path: paths.detail ?? null,
        blurhash: image.blurhash || null,
        image_hash: cardHash,
        image_version: String(Date.now()),
      })
      .eq("id", serviceId)
      .eq("provider_id", providerId)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("El servicio ya no existe.");
  } catch (e) {
    await removeFiles(uploaded); // no dejar archivos huérfanos ocupando el cupo gratuito
    throw e;
  }

  await removeFiles([previous?.thumb_path, previous?.card_path, previous?.detail_path].filter((p) => p && !uploaded.includes(p)));
}

/** Quita la foto del servicio y libera el espacio. */
export async function clearServiceImage(providerId: string, serviceId: string): Promise<void> {
  const previous = await readPaths(providerId, serviceId);
  const { error } = await getSupabaseClient()
    .from("services")
    .update({ thumb_path: null, card_path: null, detail_path: null, original_path: null, blurhash: null, image_hash: null, image_version: null })
    .eq("id", serviceId)
    .eq("provider_id", providerId);
  if (error) throw new Error(error.message);
  await removeFiles([previous?.thumb_path, previous?.card_path, previous?.detail_path]);
}

export function serviceImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return getSupabaseClient().storage.from(SERVICE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
