# Base de datos local Luni

La base local nativa usa SQLite mediante `@capacitor-community/sqlite`. `LOCAL_SCHEMA_SQL` define las tablas offline-first; `openLocalDatabase()` crea las tablas de forma idempotente y conserva los datos existentes.

Reglas:
- No guardar fotos como BLOB en SQLite: guardar rutas locales y metadatos.
- Toda reserva creada offline debe iniciar en `pending_confirmation`.
- Cada operación de escritura sincronizable lleva una clave idempotente.
- La validación definitiva de disponibilidad debe hacerse atómicamente en el servidor.
- La migración actual solo crea tablas; cualquier cambio futuro de estructura debe incrementar `LOCAL_DB_VERSION` y añadir migración explícita antes de producción.

La base no está aún conectada a las pantallas ni a Supabase.
