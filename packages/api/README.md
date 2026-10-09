# @lumi/api

Cliente compartido para conectar las aplicaciones Luni con Supabase. Usa únicamente la URL del proyecto y la clave pública **anon/publishable** en el cliente; nunca incluyas una clave `service_role`.

## Configuración local

Crea un archivo `.env` dentro de cada app:

- `apps/client/.env`
- `apps/provider/.env`

Con este contenido:

```dotenv
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICA_ANON_O_PUBLISHABLE
```

Reinicia el servidor Vite después de cambiar variables. No subas los archivos `.env` reales al repositorio.

## API disponible

- `signUpWithEmail(email, password, displayName)`
- `signInWithEmail(email, password)`
- `signOut()`
- `getCurrentSession()`
- `onAuthStateChange(callback)`
- `listPublishedProviders()`
- `listPublicServices(providerId?)`
- `createAppointment(input)`: llama a la RPC transaccional `luni_create_appointment`.
- `listMyAppointments()`

Las funciones de catálogo y reservas dependen de las políticas RLS de la migración. Las funciones están preparadas, pero todavía hay que conectarlas a los formularios/pantallas de cada app y probarlas con usuarios reales en el proyecto Supabase.
