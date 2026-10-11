import type { Session } from "@supabase/supabase-js";
import { getAuthStorageKey } from "./client";

/**
 * Lectura con copia local: cada lectura guarda su último resultado y, si no hay red o la conexión
 * es demasiado lenta, devuelve ese resultado en lugar de fallar. Las escrituras no pasan por aquí.
 */

const DB_NAME = "luni-offline";
const STORE = "snapshots";
const OUTBOX = "outbox";
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
  /** Cambios hechos sin conexión que aún no se han enviado. */
  pending: number;
  /** Se están enviando los cambios pendientes. */
  syncing: boolean;
  /** Cambios que el servidor no pudo aplicar (la persona debe enterarse). */
  conflicts: string[];
};

let status: OfflineStatus = {
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  stale: false,
  slow: false,
  savedAt: null,
  pending: 0,
  syncing: false,
  conflicts: [],
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
  if (!flushing && entries.length > 0) void autoFlush(); // la red volvió sin evento «online» (señal débil)
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
  if (
    next.online === status.online && next.stale === status.stale && next.slow === status.slow && next.savedAt === status.savedAt &&
    next.pending === status.pending && next.syncing === status.syncing && next.conflicts.join("\n") === status.conflicts.join("\n")
  ) return;
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
    pending: mine("pending").length,
    syncing: flushing !== null,
    conflicts: mine("conflict").map((e) => e.error ?? e.label),
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
  window.addEventListener("online", () => {
    degradedUntil = 0;
    recompute(true);
    // Primero se envía lo pendiente; después las apps vuelven a pedir los datos ya actualizados.
    void runFlush().finally(() => reconnectListeners.forEach((cb) => cb()));
  });
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
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
        if (!database.objectStoreNames.contains(OUTBOX)) database.createObjectStore(OUTBOX);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
const db = () => (dbPromise ??= openDb());

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, storeName = STORE): Promise<T | null> {
  const database = await db();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = run(database.transaction(storeName, mode).objectStore(storeName));
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
  await idb("readwrite", (s) => s.clear(), OUTBOX);
  entries = [];
  staleKeys.clear();
  recompute();
}

const SLOW = Symbol("slow");
const FAILED = Symbol("failed");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readThrough<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const fullKey = `${scope()}|${key}`;
  const name = key.split(":")[0];
  await outboxReady;
  if (flushing) await flushing.catch(() => undefined); // que la lectura vea ya lo enviado
  const snapshot = await readSnapshot(fullKey);
  const show = (value: T): T => applyPending(name, value);

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
  if (!snapshot) return live.then(show);

  live.catch(() => undefined); // si se sirve la copia, un fallo tardío no debe quedar sin atender
  const serveSnapshot = (slow: boolean): T => {
    servedStale = true;
    staleKeys.set(key, { savedAt: snapshot.savedAt, slow });
    recompute();
    return show(JSON.parse(snapshot.json) as T);
  };

  // Ya se sabe que no hay red (o que va mal): se muestra lo guardado al instante y se refresca en segundo plano.
  if (isOfflineNow()) return serveSnapshot(false);
  if (isDegraded()) return serveSnapshot(degradedBySlow);

  const failure = networkFailureSignal();
  try {
    const first = await Promise.race([live, sleep(SLOW_MS).then(() => SLOW), failure.promise.then(() => FAILED)]);
    if (first === FAILED) return serveSnapshot(false);
    if (first !== SLOW) return show(first as T);
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

// ======================= Cambios hechos sin conexión (cola) =======================

/**
 * Cómo se ve un cambio pendiente sobre los datos guardados (para que la pantalla ya lo muestre).
 * Se aplican al leer; los datos guardados siguen siendo la copia fiel del servidor.
 */
export type Patch = {
  /** Nombre de la lectura a la que afecta (p. ej. "listProviderAppointments"). */
  read: string;
  op: "merge" | "upsert" | "remove";
  id: string;
  changes?: Record<string, unknown>;
  item?: Record<string, unknown>;
};

export type WriteSpec = { type: string; payload: unknown; label: string; patches?: Patch[] };

type OutboxEntry = {
  id: string;
  scope: string;
  type: string;
  payload: unknown;
  label: string;
  patches: Patch[];
  createdAt: number;
  state: "pending" | "conflict";
  error?: string;
};

// Un cambio que no entra en este tiempo se guarda en cola (puede completarse después: todos son idempotentes).
const WRITE_TIMEOUT_MS = 15_000;
const ENTRY_TIMEOUT_MS = 20_000;

let entries: OutboxEntry[] = [];
let flushing: Promise<number> | null = null;
const handlers = new Map<string, (payload: never) => Promise<unknown>>();

const mine = (state: OutboxEntry["state"]): OutboxEntry[] => {
  const current = scope();
  return entries.filter((e) => e.scope === current && e.state === state);
};

/** Cada tipo de cambio registra cómo se envía al servidor. */
export function registerOutboxHandler<P>(type: string, handler: (payload: P) => Promise<unknown>): void {
  handlers.set(type, handler as (payload: never) => Promise<unknown>);
}

function applyPatch<T>(value: T, patch: Patch): T {
  if (!Array.isArray(value)) return value;
  const list = value as unknown as Array<Record<string, unknown>>;
  const index = list.findIndex((item) => item.id === patch.id);
  if (patch.op === "remove") return list.filter((item) => item.id !== patch.id) as unknown as T;
  if (patch.op === "merge") return (index < 0 ? list : list.map((item, n) => (n === index ? { ...item, ...patch.changes } : item))) as unknown as T;
  return (index < 0 ? [...list, patch.item ?? {}] : list.map((item, n) => (n === index ? { ...item, ...patch.item } : item))) as unknown as T;
}

function applyPending<T>(name: string, value: T): T {
  let out = value;
  for (const entry of mine("pending")) {
    for (const patch of entry.patches) if (patch.read === name) out = applyPatch(out, patch);
  }
  return out;
}

async function enqueue(spec: WriteSpec): Promise<void> {
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    scope: scope(),
    type: spec.type,
    payload: spec.payload,
    label: spec.label,
    patches: spec.patches ?? [],
    createdAt: Date.now(),
    state: "pending",
  };
  entries = [...entries, entry];
  await idb("readwrite", (s) => s.put(entry, entry.id), OUTBOX);
  recompute();
}

async function removeEntry(id: string): Promise<void> {
  entries = entries.filter((e) => e.id !== id);
  await idb("readwrite", (s) => s.delete(id), OUTBOX);
}

async function markConflict(entry: OutboxEntry, message: string): Promise<void> {
  const updated: OutboxEntry = { ...entry, state: "conflict", error: message };
  entries = entries.map((e) => (e.id === entry.id ? updated : e));
  await idb("readwrite", (s) => s.put(updated, entry.id), OUTBOX);
  recompute();
}

function conflictText(label: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const reason = /ya no admite|ya no se puede|ya no existe|no se pudo (guardar|eliminar)|forbidden|row-level security|permission/i.test(raw)
    ? "no se pudo aplicar: la cita o el servicio cambió mientras estabas sin conexión."
    : `no se pudo aplicar (${raw}).`;
  return `${label || "Un cambio"}: ${reason}`;
}

/** La persona ya leyó los avisos de cambios que no se pudieron aplicar. */
export async function dismissConflicts(): Promise<void> {
  const ids = mine("conflict").map((e) => e.id);
  for (const id of ids) await removeEntry(id);
  recompute();
}

function runFlush(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    await outboxReady;
    recompute();
    let applied = 0;
    try {
      for (const entry of mine("pending")) {
        if (isOfflineNow()) break;
        const handler = handlers.get(entry.type);
        if (!handler) { await markConflict(entry, "Un cambio guardado no se pudo reconocer."); continue; }
        try {
          await Promise.race([
            handler(entry.payload as never),
            sleep(ENTRY_TIMEOUT_MS).then(() => { throw new Error("Failed to fetch"); }),
          ]);
          await removeEntry(entry.id);
          applied++;
        } catch (error) {
          if (isNetworkError(error)) break; // sin red: el resto espera y se conserva el orden
          await markConflict(entry, conflictText(entry.label, error));
        }
      }
    } finally {
      flushing = null;
      recompute();
    }
    return applied;
  })();
  recompute();
  return flushing;
}

/** Envía los cambios pendientes (se hace solo al volver la red). */
export async function flushOutbox(): Promise<number> {
  return runFlush();
}

async function autoFlush(): Promise<void> {
  if (isOfflineNow() || flushing || mine("pending").length === 0) return;
  const applied = await runFlush();
  if (applied > 0) reconnectListeners.forEach((cb) => cb());
}

/**
 * Hace el cambio si hay red; si no (o si hay cambios anteriores esperando, para no saltarse el orden), lo guarda
 * en cola y se enviará solo al volver la conexión. Los errores reales (permisos, datos) sí se muestran.
 */
export async function writeOrQueue<T>(spec: WriteSpec, run: () => Promise<T>): Promise<{ queued: false; result: T } | { queued: true }> {
  await outboxReady;
  const queue = async () => {
    await enqueue(spec);
    void autoFlush();
    return { queued: true as const };
  };
  if (isOfflineNow() || isDegraded() || mine("pending").length > 0) return queue();

  const failure = networkFailureSignal();
  try {
    const attempt = run();
    attempt.catch(() => undefined);
    const first = await Promise.race([attempt, sleep(WRITE_TIMEOUT_MS).then(() => SLOW), failure.promise.then(() => FAILED)]);
    if (first === SLOW || first === FAILED) return queue();
    return { queued: false, result: first as T };
  } catch (error) {
    if (isNetworkError(error)) return queue();
    throw error;
  } finally {
    failure.cancel();
  }
}

/** Texto del aviso de conexión (o null si no hay nada que decir). */
export function offlineBannerText(s: OfflineStatus): string | null {
  if (s.syncing) return "Enviando cambios guardados…";
  const head = !s.online ? "Sin conexión" : s.stale ? (s.slow ? "Conexión lenta" : "Sin conexión con el servidor") : null;
  const parts: string[] = [];
  if (s.pending > 0) parts.push(`${s.pending} ${s.pending === 1 ? "cambio sin enviar" : "cambios sin enviar"}`);
  if (s.stale && s.savedAt) parts.push(`datos guardados ${timeAgo(s.savedAt)}`);
  if (!head && parts.length === 0) return null;
  return [head ?? "Pendiente de enviar", ...parts].join(" · ");
}

async function loadOutbox(): Promise<void> {
  const database = await db();
  if (!database) return;
  entries = await new Promise<OutboxEntry[]>((resolve) => {
    try {
      const request = database.transaction(OUTBOX).objectStore(OUTBOX).getAll();
      request.onsuccess = () => resolve((request.result as OutboxEntry[]).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  recompute();
  // Cambios que quedaron pendientes de una sesión anterior: se envían en cuanto la app esté lista.
  if (mine("pending").length > 0 && !isOfflineNow()) setTimeout(() => void autoFlush(), 1_500);
}

const outboxReady: Promise<void> = typeof window === "undefined" ? Promise.resolve() : loadOutbox();
