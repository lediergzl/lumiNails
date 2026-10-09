import { openLocalDatabase } from "./index";

export interface LocalProvider {
  id: string;
  slug: string;
  displayName: string;
  avatarPath?: string | null;
  version?: number;
  updatedAt?: string;
}

export interface LocalService {
  id: string;
  providerId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency?: string;
  durationMinutes: number;
  thumbPath?: string | null;
  cardPath?: string | null;
  detailPath?: string | null;
  blurhash?: string | null;
  imageVersion?: string | null;
  version?: number;
  updatedAt?: string;
}

export interface LocalAppointmentDraft {
  id: string;
  providerId: string;
  clientId?: string | null;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  idempotencyKey: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new Error(`El campo "${field}" es obligatorio.`);
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `luni-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Guarda o actualiza un profesional en SQLite sin depender de Internet. */
export async function saveLocalProvider(input: LocalProvider): Promise<void> {
  requireText(input.id, "id");
  requireText(input.slug, "slug");
  requireText(input.displayName, "displayName");
  const db = await openLocalDatabase();
  await db.run(
    `INSERT INTO providers (id, slug, display_name, avatar_path, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       slug = excluded.slug,
       display_name = excluded.display_name,
       avatar_path = excluded.avatar_path,
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [input.id, input.slug, input.displayName, input.avatarPath ?? null, input.version ?? 1, input.updatedAt ?? nowIso()]
  );
}

/** Lee profesionales ya almacenados localmente; no realiza peticiones de red. */
export async function listLocalProviders(): Promise<LocalProvider[]> {
  const db = await openLocalDatabase();
  const result = await db.query(
    `SELECT id, slug, display_name AS displayName, avatar_path AS avatarPath,
            version, updated_at AS updatedAt
     FROM providers WHERE deleted_at IS NULL ORDER BY display_name COLLATE NOCASE`
  );
  return (result.values ?? []) as LocalProvider[];
}

/** Guarda o actualiza un servicio y conserva únicamente rutas/metadatos de imagen. */
export async function saveLocalService(input: LocalService): Promise<void> {
  requireText(input.id, "id");
  requireText(input.providerId, "providerId");
  requireText(input.name, "name");
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) {
    throw new Error("priceCents debe ser un entero mayor o igual que cero.");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new Error("durationMinutes debe ser un entero mayor que cero.");
  }
  const db = await openLocalDatabase();
  await db.run(
    `INSERT INTO services (
       id, provider_id, name, description, price_cents, currency, duration_minutes,
       thumb_path, card_path, detail_path, blurhash, image_version, version, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       name = excluded.name,
       description = excluded.description,
       price_cents = excluded.price_cents,
       currency = excluded.currency,
       duration_minutes = excluded.duration_minutes,
       thumb_path = excluded.thumb_path,
       card_path = excluded.card_path,
       detail_path = excluded.detail_path,
       blurhash = excluded.blurhash,
       image_version = excluded.image_version,
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [
      input.id, input.providerId, input.name, input.description ?? "", input.priceCents,
      input.currency ?? "CUP", input.durationMinutes, input.thumbPath ?? null,
      input.cardPath ?? null, input.detailPath ?? null, input.blurhash ?? null,
      input.imageVersion ?? null, input.version ?? 1, input.updatedAt ?? nowIso()
    ]
  );
}

/** Devuelve los servicios locales de un profesional; los borrados lógicos se omiten. */
export async function listLocalServices(providerId?: string): Promise<LocalService[]> {
  const db = await openLocalDatabase();
  const result = providerId
    ? await db.query(
        `SELECT id, provider_id AS providerId, name, description, price_cents AS priceCents,
                currency, duration_minutes AS durationMinutes, thumb_path AS thumbPath,
                card_path AS cardPath, detail_path AS detailPath, blurhash,
                image_version AS imageVersion, version, updated_at AS updatedAt
         FROM services WHERE deleted_at IS NULL AND provider_id = ?
         ORDER BY name COLLATE NOCASE`,
        [providerId]
      )
    : await db.query(
        `SELECT id, provider_id AS providerId, name, description, price_cents AS priceCents,
                currency, duration_minutes AS durationMinutes, thumb_path AS thumbPath,
                card_path AS cardPath, detail_path AS detailPath, blurhash,
                image_version AS imageVersion, version, updated_at AS updatedAt
         FROM services WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`
      );
  return (result.values ?? []) as LocalService[];
}

/**
 * Guarda una reserva local como pending_confirmation y encola la operación en la
 * misma transacción. Nunca afirma que una hora está confirmada sin validación del servidor.
 */
export async function createLocalAppointment(draft: LocalAppointmentDraft): Promise<void> {
  for (const [field, value] of Object.entries({
    id: draft.id,
    providerId: draft.providerId,
    serviceId: draft.serviceId,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    idempotencyKey: draft.idempotencyKey
  })) requireText(value, field);

  const start = Date.parse(draft.startsAt);
  const end = Date.parse(draft.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("El intervalo de la reserva no es válido.");
  }

  const db = await openLocalDatabase();
  const createdAt = nowIso();
  const queueId = createId();
  const payload = JSON.stringify({
    id: draft.id,
    providerId: draft.providerId,
    clientId: draft.clientId ?? null,
    serviceId: draft.serviceId,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    status: "pending_confirmation",
    notes: draft.notes ?? "",
    idempotencyKey: draft.idempotencyKey
  });

  await db.executeSet([
    {
      statement: `INSERT INTO appointments (
        id, provider_id, client_id, service_id, starts_at, ends_at, status,
        notes, version, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_confirmation', ?, 1, ?, ?)`,
      values: [
        draft.id, draft.providerId, draft.clientId ?? null, draft.serviceId,
        draft.startsAt, draft.endsAt, draft.notes ?? "", draft.idempotencyKey, createdAt
      ]
    },
    {
      statement: `INSERT INTO sync_queue (
        id, operation, entity, entity_id, payload_json, idempotency_key,
        created_at, retries, status
      ) VALUES (?, 'CREATE_APPOINTMENT', 'appointment', ?, ?, ?, ?, 0, 'pending')`,
      values: [queueId, draft.id, payload, draft.idempotencyKey, createdAt]
    }
  ]);
}

/** Lista reservas locales, opcionalmente filtradas por cliente o profesional. */
export async function listLocalAppointments(filter: {
  providerId?: string;
  clientId?: string;
} = {}): Promise<Record<string, unknown>[]> {
  const db = await openLocalDatabase();
  const conditions: string[] = ["deleted_at IS NULL"];
  const values: string[] = [];
  if (filter.providerId) {
    conditions.push("provider_id = ?");
    values.push(filter.providerId);
  }
  if (filter.clientId) {
    conditions.push("client_id = ?");
    values.push(filter.clientId);
  }
  const result = await db.query(
    `SELECT id, provider_id AS providerId, client_id AS clientId,
            service_id AS serviceId, starts_at AS startsAt, ends_at AS endsAt,
            status, notes, version, idempotency_key AS idempotencyKey,
            updated_at AS updatedAt
     FROM appointments WHERE ${conditions.join(" AND ")}
     ORDER BY starts_at`,
    values
  );
  return (result.values ?? []) as Record<string, unknown>[];
}
