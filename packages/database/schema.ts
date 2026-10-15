export const LOCAL_DB_VERSION = 1;

export const LOCAL_TABLES = [
  "providers",
  "services",
  "availability",
  "clients",
  "appointments",
  "sync_queue",
  "sync_state",
  "image_cache",
  "image_uploads",
  "image_variants"
] as const;

export type LocalTable = (typeof LOCAL_TABLES)[number];

export const LOCAL_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_path TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'CUP',
    duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
    thumb_path TEXT,
    card_path TEXT,
    detail_path TEXT,
    blurhash TEXT,
    image_version TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS availability (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('working_hours','exception','block')),
    status TEXT NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL,
    client_id TEXT,
    service_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending_confirmation','confirmed','cancelled','rejected','completed')),
    notes TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    idempotency_key TEXT NOT NULL UNIQUE,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    operation TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    retries INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','syncing','failed','conflict','done')),
    last_error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sync_queue_ready ON sync_queue(status, next_retry_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    scope TEXT PRIMARY KEY NOT NULL,
    last_server_cursor TEXT,
    last_successful_sync_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS image_cache (
    path TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    content_version TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_image_cache_lru ON image_cache(last_accessed_at)`,
  `CREATE TABLE IF NOT EXISTS image_uploads (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    blurhash TEXT,
    created_at TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    last_error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS image_variants (
    id TEXT PRIMARY KEY NOT NULL,
    upload_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    hash TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    local_path TEXT NOT NULL,
    remote_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    uploaded_at TEXT,
    FOREIGN KEY(upload_id) REFERENCES image_uploads(id) ON DELETE CASCADE
  )`
] as const;
