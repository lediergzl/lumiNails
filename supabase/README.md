# Supabase — backend de Luni

## Estado

La migración inicial crea perfiles, perfiles de profesional, catálogo de servicios, disponibilidad, reservas, control de licencia configurable, RLS y la función transaccional `luni_create_appointment`.

**La migración está en GitHub, pero no se ejecuta automáticamente al hacer `git pull`.** Debe aplicarse a tu proyecto Supabase antes de conectar la aplicación.

## Aplicar la migración

1. Abre el proyecto correcto en Supabase.
2. Entra en **SQL Editor** y crea una consulta nueva.
3. Abre en GitHub el archivo `supabase/migrations/20261009010000_initial_schema.sql`.
4. Copia el archivo completo en el editor SQL y ejecútalo una sola vez.
5. Comprueba en **Table Editor** que aparezcan `profiles`, `provider_profiles`, `services`, `availability`, `appointments`, `app_settings` y `sync_changes`.

La migración usa `IF NOT EXISTS` y recrea algunos triggers/policies; aun así, hazla primero en un proyecto de prueba si ya existen tablas propias con esos nombres. No pegues claves `service_role` en la aplicación ni en el repositorio.

## Registro sin confirmación de correo

Para que una persona cree su cuenta y entre directamente, **sin confirmar el correo**, hay que desactivarlo en tu proyecto de Supabase. Es un ajuste del panel, no de la migración ni del código:

1. Abre tu proyecto en Supabase.
2. Ve a **Authentication → Sign In / Providers → Email** (el nombre exacto puede variar según la versión del panel).
3. Desactiva **Confirm email** y guarda.

Con eso, `signUp` devuelve la sesión de inmediato y las dos apps dejan al usuario dentro (`signUpWithEmail` devuelve `session`). Si el ajuste sigue activado, las apps lo detectan (la sesión llega vacía) y muestran un aviso para confirmar el correo.

Ten en cuenta que sin verificación:

- Una persona puede registrarse con un correo que no es suyo o con un error de escritura, y no podrá recuperar la cuenta por correo. Todavía no existe flujo de «olvidé mi contraseña».
- Es más fácil crear cuentas falsas. Revisa los límites de **Authentication → Rate Limits** y valora activar CAPTCHA.

## Reservas

La aplicación debe invocar la función RPC `luni_create_appointment` con:

- `p_id`: UUID local de la reserva.
- `p_provider_id`: UUID de `provider_profiles.id`, no el UUID de Auth.
- `p_service_id`: UUID del servicio.
- `p_starts_at`: fecha/hora con zona horaria.
- `p_idempotency_key`: clave única estable para reintentos.
- `p_notes`: nota opcional.

La función deriva la identidad del cliente de la sesión autenticada, toma duración/precio del servicio almacenado, valida la licencia y el horario de trabajo, rechaza bloqueos y usa una restricción de exclusión de PostgreSQL para impedir reservas solapadas. Repetir la misma clave de idempotencia devuelve la reserva existente del mismo cliente.

Las reservas que el servidor acepta inicialmente quedan como `pending_confirmation`; el estado `confirmed` solo debe establecerse tras la confirmación real del profesional. La reserva offline en SQLite sigue pendiente hasta que la RPC responda.

## Configuración comercial

`app_settings` contiene `license_trial_days`, `license_prices` y `payment_methods`. Los precios de licencia y métodos de pago no se codifican en la app. El acceso a ajustes es de solo lectura para usuarios autenticados; las modificaciones comerciales deben realizarse desde un entorno administrativo de confianza.

## Límites pendientes

- Conectar autenticación de ambas aplicaciones a Supabase Auth.
- Crear el flujo de alta de profesional y su fila en `provider_profiles`.
- Añadir disponibilidad de forma coherente con las reglas del negocio.
- Implementar el cliente RPC y el proceso de sincronización incremental/offline.
- Definir y probar el proceso administrativo para confirmar/rechazar citas y gestionar licencias.
- Revisar esta migración en un proyecto Supabase de prueba antes de producción; no se ha ejecutado contra tu instancia desde este repositorio.
