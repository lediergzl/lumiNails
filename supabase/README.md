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

## Recuperar contraseña (código por correo)

Como las apps son Capacitor, el enlace de un correo no puede devolver a la persona a la app sin configurar enlaces profundos nativos. Por eso la recuperación usa un **código numérico**: la persona pide el código, lo escribe en la app y elige su contraseña nueva (`requestPasswordReset` + `resetPasswordWithCode` en `@lumi/api`).

Para que funcione hay que cambiar la plantilla del correo en Supabase:

1. Ve a **Authentication → Email Templates → Reset Password**.
2. Sustituye el enlace por el código. Por ejemplo:

   ```html
   <h2>Recupera tu contraseña de Luni</h2>
   <p>Escribe este código en la app:</p>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   <p>Si no lo pediste tú, ignora este mensaje.</p>
   ```

3. Guarda. El código es de un solo uso y caduca (por defecto, en una hora).

Importante: el servicio de correo integrado de Supabase tiene límites estrictos y está pensado para pruebas. Para producción configura tu propio SMTP en **Authentication → Emails → SMTP Settings**, o los códigos no llegarán de forma fiable.

## Horario y disponibilidad real

La segunda migración (`20261010000000_weekly_availability.sql`) añade el horario semanal y el cálculo de horas libres. **Aplícala antes de publicar las apps nuevas**: el cliente llama a funciones que no existen en la primera migración y, sin ella, no se podrá reservar.

1. En el SQL Editor de Supabase (o con `supabase db push`), ejecuta las migraciones en orden. Es seguro repetirla.
2. Cada manicurista define su horario en la app **Studio → Mi negocio → Horario de atención**. Sin horario guardado, nadie puede reservar con ella.

Cómo funciona:

- El horario son tramos por día de la semana en la **hora local del estudio** (`provider_profiles.timezone`, por defecto `America/Havana`).
- Las horas de inicio salen **cada 30 minutos** dentro de cada tramo, y se descartan las que se solapan con una cita pendiente o confirmada, las que caen en un día bloqueado y las que empiezan en menos de 1 hora. Se puede reservar hasta 90 días hacia adelante.
- `luni_available_days` y `luni_available_slots` calculan esto en el servidor y `luni_create_appointment` valida con las mismas reglas, así que lo que se muestra es lo que se acepta. Una cita cancelada o rechazada libera la hora.
- Bloquear un día no cancela las citas ya reservadas ese día; la app avisa para que las revises.
- Las filas antiguas `availability.kind = 'working_hours'` se siguen aceptando al reservar, pero la interfaz usa el horario semanal.

### Probar la base de datos

`supabase/tests/run.sh` aplica las migraciones sobre un PostgreSQL local (con `btree_gist` y `pgcrypto`) y ejecuta 58 comprobaciones: validación del horario, horas libres, solapes, bloqueos, licencia, huso horario y privacidad entre cuentas (RLS). Falla si algo no pasa.

```bash
supabase/tests/run.sh          # usa la base luni_test y las variables PG* habituales
```

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


## Asignación de roles desde el panel de administración

La migración `20261018010000_admin_role_management.sql` añade el bloque **Roles de usuarios** al panel exclusivo del administrador en Luni Studio. Permite buscar las cuentas registradas y asignar uno de estos roles:

- `client`: Clienta.
- `provider`: Manicurista.
- `admin`: Administrador.

**Importante:** guardar los archivos en GitHub no ejecuta SQL en Supabase. Abre **Supabase → SQL Editor**, copia el contenido completo de [la migración de roles](https://github.com/lediergzl/lumiNails/blob/main/supabase/migrations/20261018010000_admin_role_management.sql) y ejecútalo después de las migraciones anteriores, especialmente la de licencias y administración.

La operación usa funciones RPC protegidas por `luni_is_admin()`; no expone la tabla interna de autenticación a la APK. El panel no permite cambiar el rol de la propia cuenta ni quitar el rol al último administrador. Hasta aplicar esta migración, el nuevo bloque no podrá cargar ni guardar roles.


### Corrección del listado de cuentas

La migración adicional `20261018020000_admin_role_management_robustness.sql` hace que el panel liste todas las cuentas de Supabase Auth, incluso si alguna cuenta antigua no tiene todavía una fila en `profiles`. Al guardar su rol, repara ese perfil de forma controlada.

Si el panel de roles muestra «No se encontraron cuentas» o el mensaje de error, aplica primero `20261018010000_admin_role_management.sql` y después `20261018020000_admin_role_management_robustness.sql` desde **Supabase → SQL Editor**. La APK por sí sola no puede ejecutar migraciones de base de datos.
