import type { Session } from "@supabase/supabase-js";
import { getAuthStorageKey } from "./client";

/**
 * Lectura con copia local: cada lectura guarda su último resultado y, si no hay red o la conexión
 * es demasiado lenta, devuelve ese resultado en lugar de fallar. Las escrituras no pasan por aquí.
 */

const DB_NAME = "luni-offline";
const STORE = "snapshots";
// Con copia guardada, no se espera más que esto a una red lenta antes de mostrar lo guardado.
// (La librería reintenta cada lectura fallida con esperas crecientes: sin este tope, cada lectura
// tardaría ~7 s en rendirse y, al ir encadenadas, la pantalla tardaría decenas de segundos.)
const SLOW_MS = 4_000;
// Tras una lectura fallida o lenta, las siguientes muestran lo guardado al instante durante este tiempo.
const DEGRADED_MS = 30_000;
// Como mucho un aviso de "hay datos nuevos" cada tanto, para no encadenar recargas.
const FRESH_NOTICE_MS = 15_000;

export type OfflineStatus = {
  /** El dispositivo informa que tiene red. */
  online: boolean;
  /** Se está mostrando información guardada en lugar de la del servidor. */
  stale: boolean;
  /** La causa es una conexión lenta (y no la falta de red). */
  slow: boolean;
  /** Momento (ms) de la copia más antigua que se está mostrando. */
  savedAt: number | null;
};

let status: OfflineStatus = {
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  stale: false,
  slow: false,
  savedAt: null,
};
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
const staleKeys = new Map<string, { savedAt: number; slow: boolean }>();
let degradedUntil = 0;
let degradedBySlow = false;
let lastFreshNotice = 0;
const isOfflineNow = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
const isDegraded = (): boolean => Date.now() < degradedUntil;
const degrade = (slow: boolean): void => { degradedUntil = Date.now() + DEGRADED_MS; degradedBySlow = slow; };

const failureWaiters = new Set<() => void>();

/** Lo llama el cliente HTTP en cuanto una petición se cae por falta de red (antes de los reintentos de la librería). */
export function reportNetworkFailure(): void {
  degrade(false);
  failureWaiters.forEach((wake) => wake());
  failureWaiters.clear();
}

/** Lo llama el cliente HTTP cuando una petición llega al servidor. */
export function reportNetworkSuccess(): void {
  degradedUntil = 0;
}

/** Se resuelve en cuanto se detecta un fallo de red (o ya se estaba en modo degradado). */
export function networkFailureSignal(): { promise: Promise<void>; cancel: () => void } {
  if (isDegraded()) return { promise: Promise.resolve(), cancel: () => undefined };
  let wake: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { wake = resolve; failureWaiters.add(wake); });
  return { promise, cancel: () => { failureWaiters.delete(wake); } };
}

function notifyFresh(): void {
  if (Date.now() - lastFreshNotice < FRESH_NOTICE_MS) return;
  lastFreshNotice = Date.now();
  reconnectListeners.forEach((cb) => cb());
}

function setStatus(next: OfflineStatus): void {
  if (next.online === status.online && next.stale === status.stale && next.slow === status.slow && next.savedAt === status.savedAt) return;
  status = next;
  listeners.forEach((l) => l());
}

function recompute(online = status.online): void {
  const values = [...staleKeys.values()];
  setStatus({
    online,
    stale: values.length > 0,
    slow: values.some((v) => v.slow),
    savedAt: values.length ? Math.min(...values.map((v) => v.savedAt)) : null,
  });
}

export const getOfflineStatus = (): OfflineStatus => status;

export function subscribeOfflineStatus(callback: () => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/** Avisa cuando el dispositivo recupera la red, para volver a pedir los datos. */
export function onReconnect(callback: () => void): () => void {
  reconnectListeners.add(callback);
  return () => { reconnectListeners.delete(callback); };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { degradedUntil = 0; recompute(true); reconnectListeners.forEach((cb) => cb()); });
  window.addEventListener("offline", () => recompute(false));
}

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|authretryablefetcherror/i.test(message);
}

/** Mensaje en español para errores de red que de otro modo saldrían en inglés. */
export function friendlyError(message: string): string {
  return isNetworkError(message) && message ? "Sin conexión. Revisa tu señal e inténtalo de nuevo." : message;
}

export function timeAgo(ms: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

// ---- Sesión guardada: la app sigue abierta sin red aunque haya caducado el token (se renueva al volver).
export function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(getAuthStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.user ? (parsed as Session) : null;
  } catch {
    return null;
  }
}

const scope = (): string => readStoredSession()?.user?.id ?? "anon";

// ---- IndexedDB mínima (sin dependencias). Si no está disponible, todo funciona sin copia local.
type Snapshot = { savedAt: number; json: string };
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
const db = () => (dbPromise ??= openDb());

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const database = await db();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = run(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

const readSnapshot = (key: string) => idb<Snapshot>("readonly", (s) => s.get(key) as IDBRequest<Snapshot>);
const writeSnapshot = (key: string, value: unknown) =>
  idb("readwrite", (s) => s.put({ savedAt: Date.now(), json: JSON.stringify(value ?? null) } satisfies Snapshot, key));

/** Borra todo lo guardado en el dispositivo (al cerrar sesión). */
export async function clearOfflineData(): Promise<void> {
  await idb("readwrite", (s) => s.clear());
  staleKeys.clear();
  recompute();
}

const SLOW = Symbol("slow");
const FAILED = Symbol("failed");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readThrough<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const fullKey = `${scope()}|${key}`;
  const snapshot = await readSnapshot(fullKey);

  // Sin red y sin copia no hay nada que mostrar: se falla enseguida, sin esperar reintentos.
  if (!snapshot && isOfflineNow()) throw new Error("Sin conexión. Revisa tu señal e inténtalo de nuevo.");

  let servedStale = false;
  const live = fetcher().then(async (value) => {
    await writeSnapshot(fullKey, value);
    degradedUntil = 0;
    if (staleKeys.delete(key)) recompute();
    // Llegó tarde y distinto de lo que se mostró: se avisa para que la app se refresque una vez.
    if (servedStale && snapshot && JSON.stringify(value ?? null) !== snapshot.json) notifyFresh();
    return value;
  });

  // Sin copia guardada no hay alternativa: se comporta como siempre.
  if (!snapshot) return live;

  live.catch(() => undefined); // si se sirve la copia, un fallo tardío no debe quedar sin atender
  const serveSnapshot = (slow: boolean): T => {
    servedStale = true;
    staleKeys.set(key, { savedAt: snapshot.savedAt, slow });
    recompute();
    return JSON.parse(snapshot.json) as T;
  };

  // Ya se sabe que no hay red (o que va mal): se muestra lo guardado al instante y se refresca en segundo plano.
  if (isOfflineNow()) return serveSnapshot(false);
  if (isDegraded()) return serveSnapshot(degradedBySlow);

  const failure = networkFailureSignal();
  try {
    const first = await Promise.race([live, sleep(SLOW_MS).then(() => SLOW), failure.promise.then(() => FAILED)]);
    if (first === FAILED) return serveSnapshot(false);
    if (first !== SLOW) return first as T;
    degrade(true);
    return serveSnapshot(true);
  } catch (error) {
    if (!isNetworkError(error)) throw error; // errores reales (permisos, datos) no se esconden
    degrade(false);
    return serveSnapshot(false);
  } finally {
    failure.cancel();
  }
}

export function withOfflineCache<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => readThrough(`${name}:${JSON.stringify(args)}`, () => fn(...args));
}
