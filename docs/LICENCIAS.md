# Licencias comerciales de LumiNails

## Qué queda implementado

- Prueba gratuita configurable con `app_settings.license_trial_days` (14 días por defecto).
- Planes de 30 días (mensual), 90 días (trimestral) y 365 días (anual).
- Solicitudes de renovación registradas en `license_payment_requests`.
- Aprobación/rechazo por un administrador autorizado mediante RPC de Supabase.
- Al aprobar, el servidor extiende desde el vencimiento actual si sigue vigente; de lo contrario, desde la fecha de aprobación.
- La licencia se valida en las funciones de disponibilidad y creación de reservas.

No hay cobro automático integrado. El pago se verifica manualmente por el administrador. La migración crea los planes con importe 0 como marcador; hay que configurar precios reales antes de aceptar solicitudes.

## Instalación en Supabase

1. Abre el proyecto correcto → SQL Editor.
2. Si el proyecto ya tiene LumiNails funcionando y aplicó las migraciones anteriores, ejecuta en este orden las dos migraciones nuevas:\n   - `20261016010000_license_plans_and_admin_workflow.sql`\n   - `20261017010000_admin_provider_license_read_policy.sql`\n\n   Si estás creando un proyecto Supabase desde cero, ejecuta todas las migraciones de `supabase/migrations` en orden por nombre, empezando por `20261009010000_initial_schema.sql`.
3. Obtén el UUID del usuario que administrará las licencias y verifica su identidad. Solo entonces ejecuta, sustituyendo el marcador:

```sql
update public.profiles
set role = 'admin'
where id = '<UUID_VERIFICADO>';
```

No uses el UUID de otra persona y no permitas que un usuario se asigne a sí mismo el rol de administrador desde la app.

## Configurar precios

Los importes se expresan en unidades menores de la moneda: por ejemplo, 1250 CUP se guarda como 125000 centavos. No se han inventado precios comerciales; sustituye los ejemplos por tus importes reales. Ejecuta desde un entorno de administrador de confianza, después de establecer el rol admin:

```sql
select public.luni_admin_set_license_plans(
  '[
    {"code":"monthly","label":"Mensual","duration_days":30,"price_cents":10000,"currency":"CUP","active":true},
    {"code":"quarterly","label":"Trimestral","duration_days":90,"price_cents":25000,"currency":"CUP","active":true},
    {"code":"annual","label":"Anual","duration_days":365,"price_cents":80000,"currency":"CUP","active":true}
  ]'::jsonb
);
```

**Cambia cada `price_cents: 0` por el importe real en centavos antes de habilitar ventas.** La función no acepta precios cero.

Configura solo los métodos de pago que realmente vayas a aceptar. Ejemplo de estructura (sustituye o amplía según tus métodos):

```sql
select public.luni_admin_set_payment_methods(
  '[
    {"code":"transferencia","label":"Transferencia","active":true},
    {"code":"efectivo","label":"Efectivo","active":true}
  ]'::jsonb
);
```

## Flujo operativo

1. La manicurista elige un plan y envía una solicitud con método de pago y referencia opcional.
2. La solicitud queda `pending`; no activa la licencia por sí sola.
3. El administrador verifica el pago fuera de LumiNails.
4. El administrador aprueba con `luni_admin_process_license_request(request_id, true, nota)` o rechaza con `false`.
5. La aprobación activa la licencia durante los días del plan. Las solicitudes aprobadas o rechazadas no pueden procesarse de nuevo.

Las funciones disponibles son:

- `luni_request_license(provider_id, plan_code, payment_method, payment_reference)`
- `luni_admin_set_license_plans(plans_json)`
- `luni_admin_set_payment_methods(methods_json)`
- `luni_admin_process_license_request(request_id, approve, note)`
- `luni_admin_set_provider_license(provider_id, status, expires_at, note)`

## Pendiente antes de producción

- Ejecutar la migración en el proyecto real de Supabase.
- Establecer el administrador y precios/métodos reales.
- Implementar la pantalla de renovación para manicuristas y el panel visual de administración.
- Probar solicitud, aprobación, rechazo, renovación con licencia vigente y vencimiento con la base de datos de pruebas.
- Configurar y verificar cualquier proveedor de pagos por separado si se desea automatizar la confirmación. No introducir claves secretas en la app ni en GitHub.
