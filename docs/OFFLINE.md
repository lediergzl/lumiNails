# Modo sin conexión

## Leer sin conexión (Fase 1)
- Cada lectura (citas, servicios, clientas, agenda, horarios, perfil…) guarda su último resultado en el
  dispositivo (IndexedDB, `packages/api/src/offline.ts`). Si no hay red o va muy lenta, se muestra lo guardado.
- Sin red (`navigator.onLine === false`) se muestra lo guardado al instante. Con «señal sin internet» se
  detecta el fallo en la primera petición. Si la red solo va lenta, se espera 4 s como máximo.
- Un aviso arriba indica «datos guardados hace…». Al volver la red todo se vuelve a pedir solo.
- La sesión no se pierde sin red aunque haya caducado el token (se renueva al reconectar).
- **Reservar o modificar una cita exige conexión** (los horarios libres los decide el servidor).
- Cerrar sesión borra la copia local.
- Sin copia previa y sin red, la manicurista ve «Aún no hay datos guardados», nunca «Registra tu estudio».

## Escribir sin conexión (Fase 2)
Estos cambios se guardan en una cola en el teléfono (IndexedDB) y se envían solos, en orden, al volver la red:
- Manicurista: confirmar, rechazar, completar y cancelar citas; crear, editar y eliminar servicios; añadir,
  cambiar o quitar la foto de un servicio (se guardan las dos versiones ya optimizadas, ~70 KB, y la foto se
  ve en pantalla desde el teléfono hasta que se suba).
- Clienta: cancelar su cita.

Cómo funciona (`packages/api/src/offline.ts`):
- Cada cambio pendiente se **superpone** a los datos guardados, así la pantalla ya lo muestra (y sigue
  mostrándolo tras cerrar y abrir la app). Los datos guardados siguen siendo la copia fiel del servidor.
- El aviso de arriba dice «N cambios sin enviar». Al volver la red se envían (primero) y luego se vuelve a pedir todo.
- Si ya hay cambios esperando, uno nuevo va detrás aunque haya red: se respeta el orden.
- Si el servidor rechaza un cambio (p. ej. la clienta ya había cancelado), no se reintenta: aparece un aviso
  con el motivo y un botón «Entendido», y los datos vuelven a lo que dice el servidor.
- Todos los cambios son idempotentes: reenviar uno que sí llegó no duplica ni falla (servicios nuevos usan
  un id generado en el teléfono).
- Cerrar sesión borra la cola; por eso la app pide confirmación si hay cambios sin enviar.

## Fotos sin conexión (Fase 3)
- Toda imagen que se ve (fotos de servicios, logotipos, trabajos) se guarda en el teléfono la primera vez
  que se muestra, sin descargas extra (`packages/api/src/imageCache.ts`, componente `CachedImage` en `@lumi/ui`).
  Los nombres de archivo llevan el hash del contenido, así que una copia guardada nunca queda desactualizada.
- Tope de 200 imágenes / 25 MB: al pasarlo se descartan las más antiguas.
- Cerrar sesión borra también las imágenes guardadas.

## Qué no hace todavía
- Reservar o modificar una cita (los horarios libres los decide el servidor): exige conexión.
- Sin cola: horarios y turnos, bloqueos de día, portafolio, invitaciones, teléfono del perfil, logotipo.
- Las fotos que nunca se vieron con conexión no se pueden ver sin ella (no se descargan por adelantado
  para no gastar datos).
- Logotipo del estudio y fotos del portafolio: subirlos exige conexión.

## Prueba
`scripts/e2e-offline/` corta la red en un navegador real y comprueba todo lo anterior (ver su README).
