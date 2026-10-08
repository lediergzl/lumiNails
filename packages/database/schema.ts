export const LOCAL_DB_VERSION = 1;

export const LOCAL_TABLES = [
  "providers",
  "services",
  "availability",
  "clients",
  "appointments",
  "sync_queue",
  "sync_state",
  "image_cache"
] as const;

export type LocalTable = (typeof LOCAL_TABLES)[number];
