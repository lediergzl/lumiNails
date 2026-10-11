# Modo sin conexión

## Qué hace hoy (Fase 1: leer sin conexión)
- Cada lectura (citas, servicios, clientas, agenda, horarios, perfil…) guarda su último resultado en el
  dispositivo (IndexedDB, `packages/api/src/offline.ts`). Si no hay red o va muy lenta, se muestra lo guardado.
- Sin red (`navigator.onLine === false`) se muestra lo guardado al instante. Con «señal sin internet» se
  detecta el fallo en la primera petición. Si la red solo va lenta, se espera 4 s como máximo.
- Un aviso arriba indica «datos guardados hace…». Al volver la red todo se vuelve a pedir solo.
- La sesión no se pierde sin red aunque haya caducado el token (se renueva al reconectar).
- **Reservar o modificar una cita exige conexión** (los horarios libres los decide el servidor).
- Cerrar sesión borra la copia local.
- Sin copia previa y sin red, la manicurista ve «Aún no hay datos guardados», nunca «Registra tu estudio».

## Qué no hace todavía
- Escribir sin conexión (confirmar/rechazar citas, editar servicios, cancelar): da un error claro.
- Fotos sin conexión: dependen de la caché del navegador.

## Prueba
`scripts/e2e-offline/` corta la red en un navegador real y comprueba todo lo anterior (ver su README).
