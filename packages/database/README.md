# Base de datos local Luni

La base local nativa usa SQLite mediante `@capacitor-community/sqlite`. `LOCAL_SCHEMA_SQL` define las tablas offline-first; `openLocalDatabase()` crea las tablas de forma idempotente y conserva los datos existentes.

## Operaciones locales disponibles

Importa las funciones desde `@lumi/database`:

- `saveLocalProvider()` / `listLocalProviders()`: guardar y leer profesionales en el dispositivo.
- `saveLocalService()` / `listLocalServices()`: guardar y leer el catálogo local. Las imágenes se representan mediante rutas y metadatos, nunca BLOBs.
- `createLocalAppointment()`: guardar una reserva como `pending_confirmation` y añadir su operación `CREATE_APPOINTMENT` a `sync_queue` en una transacción SQLite.
- `listLocalAppointments()`: leer reservas locales, con filtro opcional por profesional o cliente.

Ejemplo de reserva local:

```ts
import { createLocalAppointment } from "@lumi/database";

await createLocalAppointment({
  id: crypto.randomUUID(),
  providerId: "provider-id",
  clientId: "client-id",
  serviceId: "service-id",
  startsAt: "2026-10-10T15:00:00.000Z",
  endsAt: "2026-10-10T15:45:00.000Z",
  notes: "",
  idempotencyKey: crypto.randomUUID()
});
```

La reserva permanece pendiente hasta que el backend valide la disponibilidad y confirme el resultado. Esta capa local no reserva horarios en el servidor ni se conecta todavía a Supabase.

## Reglas de integridad

- No guardar fotos como BLOB en SQLite: guardar rutas locales y metadatos.
- Toda reserva creada localmente inicia en `pending_confirmation`.
- Las operaciones sincronizables llevan una clave idempotente.
- La validación definitiva de disponibilidad debe hacerse atómicamente en el servidor.
- La migración actual solo crea tablas; cualquier cambio futuro de estructura debe incrementar `LOCAL_DB_VERSION` y añadir migración explícita antes de producción.
- La base local aún debe conectarse a las pantallas y a la sincronización con Supabase.
