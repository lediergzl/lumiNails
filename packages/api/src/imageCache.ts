import { IMAGES, idb } from "./offline";
import { serviceImageUrl } from "./serviceImages";

/**
 * Imágenes guardadas en el teléfono para verlas sin conexión. Los nombres de archivo llevan el hash del
 * contenido, así que una imagen guardada nunca queda desactualizada. Se guardan al verlas por primera vez
 * (sin descargas extra) y se descartan las más antiguas al pasar el tope.
 */

type StoredImage = { blob: Blob; savedAt: number; size: number };

const MAX_IMAGES = 200;
const MAX_BYTES = 25 * 1024 * 1024;
const urls = new Map<string, string>(); // ruta -> URL local ya creada (evita fugas de memoria)

export const isLocalImagePath = (path: string): boolean => path.startsWith("local:");

async function readImage(path: string): Promise<StoredImage | null> {
  return idb<StoredImage>("readonly", (s) => s.get(path) as IDBRequest<StoredImage>, IMAGES);
}

async function evictIfNeeded(): Promise<void> {
  const count = await idb<number>("readonly", (s) => s.count(), IMAGES);
  if (!count || count <= MAX_IMAGES / 2) return;
  const keys = (await idb<IDBValidKey[]>("readonly", (s) => s.getAllKeys(), IMAGES)) ?? [];
  const records: Array<{ key: string; savedAt: number; size: number }> = [];
  for (const key of keys) {
    const r = await readImage(String(key));
    if (r) records.push({ key: String(key), savedAt: r.savedAt, size: r.size });
  }
  let total = records.reduce((sum, r) => sum + r.size, 0);
  let n = records.length;
  if (n <= MAX_IMAGES && total <= MAX_BYTES) return;
  for (const old of records.filter((r) => !isLocalImagePath(r.key)).sort((a, b) => a.savedAt - b.savedAt)) {
    if (n <= MAX_IMAGES && total <= MAX_BYTES) break;
    await idb("readwrite", (s) => s.delete(old.key), IMAGES);
    const url = urls.get(old.key);
    if (url) { URL.revokeObjectURL(url); urls.delete(old.key); }
    n--; total -= old.size;
  }
}

/** Guarda una imagen (descargada o creada en el teléfono) bajo su ruta. */
export async function storeImage(path: string, blob: Blob): Promise<void> {
  await idb("readwrite", (s) => s.put({ blob, savedAt: Date.now(), size: blob.size } satisfies StoredImage, path), IMAGES);
  if (!isLocalImagePath(path)) void evictIfNeeded();
}

export async function removeStoredImages(paths: string[]): Promise<void> {
  for (const path of paths) {
    await idb("readwrite", (s) => s.delete(path), IMAGES);
    const url = urls.get(path);
    if (url) { URL.revokeObjectURL(url); urls.delete(path); }
  }
}

/** URL local de una imagen ya guardada en el teléfono, o null si no está. */
export async function resolveImageUrl(path: string): Promise<string | null> {
  const known = urls.get(path);
  if (known) return known;
  const stored = await readImage(path);
  if (!stored) return null;
  const url = URL.createObjectURL(stored.blob);
  urls.set(path, url);
  return url;
}

/** Descarga la imagen (casi siempre ya está en la caché del navegador) y la guarda para verla sin conexión. */
export async function cacheRemoteImage(path: string): Promise<void> {
  if (isLocalImagePath(path) || urls.has(path)) return;
  const url = serviceImageUrl(path);
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const blob = await response.blob();
    if (blob.size > 0 && blob.size < 2 * 1024 * 1024) await storeImage(path, blob);
  } catch { /* sin red: se guardará la próxima vez que se vea */ }
}