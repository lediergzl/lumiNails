# Luni — especificación funcional y estado de implementación

> Documento vivo del producto. Distingue lo que se observa en el código de lo que sigue siendo una decisión o una verificación pendiente. Una función presente en el frontend no demuestra por sí sola que esté protegida en Supabase ni que haya pasado pruebas en un APK real.

## 1. Producto y aplicaciones

Luni se compone de dos aplicaciones Android:

- **Luni Cliente**: encontrar y guardar estudios mediante una invitación, consultar identidad visual y catálogo, solicitar/gestionar citas y consultar su estado e historial.
- **Luni Estudio**: administrar agenda, servicios, clientes, perfil del negocio, trabajos publicados, licencia y el módulo diferencial de colorimetría.

El panel de administración es una superficie separada para roles, licencias, planes y validaciones. Una clienta o manicurista no debe poder concederse privilegios administrativos desde la aplicación.

## 2. Luni Estudio: funciones

### 2.1 Colorimetría — módulo diferencial

La colorimetría es una función central del producto, no un extra. El módulo incluye:

- **Inventario de esmaltes**: guardar nombre, color HEX y cantidad disponible para usarlos como ingredientes de recetas.
- **Mezclador RYB**: calcular una mezcla a partir de los esmaltes del inventario.
- **Buscador inverso de recetas**: buscar combinaciones disponibles que se aproximen al color objetivo y ordenar los resultados por diferencia perceptual.
- **Comparación perceptual**: mostrar el valor ΔE asociado a una receta. El objetivo de calidad del producto es ΔE2000 inferior a 2 cuando sea alcanzable con los pigmentos disponibles; no se debe presentar como garantía para cualquier inventario.
- **Recetas guardadas**: conservar objetivo, resultado, ingredientes y proporciones, y mostrar la comparación visual entre objetivo y resultado.
- **Sistema de gotas**: presentar cantidades enteras de gotas calculadas desde las proporciones; permitir cambiar el tamaño del lote (4, 12, 20 o una cantidad personalizada) sin alterar la proporción base. El redondeo debe conservar el total y asignar el residuo de forma consistente.
- **Captura con cámara**: capturar el esmalte, seleccionar/detectar una referencia blanca, corregir el color y enviar el HEX resultante como objetivo del buscador inverso.
- **Alternativa manual**: si no se puede usar la cámara, permitir volver al selector de color clásico de Mis esmaltes sin bloquear la navegación.

**Límites y calidad de medición:** la cámara del teléfono no es un colorímetro calibrado. Iluminación, balance de blancos, exposición, pantalla y pigmentos afectan la lectura. La referencia blanca mejora la estimación, pero no garantiza equivalencia física exacta. El ΔE debe interpretarse como una estimación del modelo de color implementado.

**Estado observado en el código:** existen `ColorMixer.tsx`, `ColorCapture.tsx`, el buscador de recetas y la presentación/redimensionamiento de gotas. La captura utiliza APIs de cámara del navegador/Capacitor, no una implementación nativa CameraX. La ruta de error a selección manual fue añadida, pero debe probarse en Android real/emulador; la compilación y permisos nativos no se dan por verificados.

### 2.2 Agenda y reservas

- Ver citas por estado y gestionar solicitudes desde la agenda.
- Configurar **aprobación manual o automática** en el perfil del estudio. La automática confirma si la reserva pasa las validaciones del servidor; la manual deja la cita pendiente hasta que la manicurista decida.
- Configurar horario semanal, días no laborables y bloqueos de fechas/horas.
- La disponibilidad final, la licencia y las reglas de solapamiento deben validarse en el servidor, no confiar en la vista local.
- Una clienta puede tener como máximo una cita activa (pendiente o confirmada). Debe poder modificar esa cita; tras completarse, cancelarse o rechazarse, puede reservar otra.

### 2.3 Servicios, clientas y perfil

- Crear, editar, pausar y eliminar lógicamente servicios; configurar nombre, descripción, precio, moneda, duración y fotos.
- Consultar clientas e historial de citas.
- Personalizar nombre, descripción, contacto, ubicación, icono y logotipo del estudio.
- Publicar trabajos con descripción y fotos.
- Mostrar un icono predeterminado si no existe logotipo personalizado.

**Imágenes:** el código del perfil acepta JPG, PNG y WebP y limita el archivo original del logotipo a 8 MB; lo procesa localmente antes de subir la variante optimizada. Las fotos de servicios también se procesan localmente y pueden guardarse provisionalmente para trabajar offline. La implementación actual utiliza Supabase Storage para imágenes, pese a que el objetivo de coste del producto es no depender de almacenamiento de pago. No se debe prometer que las imágenes estén almacenadas fuera de Supabase hasta cambiar y probar esa arquitectura.

**Moderación:** no se ha verificado un sistema automático de moderación de logotipos o fotos. Antes de publicar contenido a otras usuarias, debe existir al menos una política visible, opción de denunciar contenido y capacidad administrativa de ocultarlo/eliminarlo. No afirmar que hay moderación automática si no se integra un servicio real.

## 3. Luni Cliente: funciones

- Registrarse e iniciar sesión como clienta.
- Añadir estudios mediante la invitación/código compartido por la manicurista y consultar la lista de estudios vinculados.
- Ver marca, icono/logotipo, datos de contacto, catálogo, precios, duración y fotos disponibles.
- Consultar días y turnos disponibles, solicitar citas, revisar estados, modificar o cancelar una cita activa y consultar historial.
- Ver el estado de sincronización y los cambios que no pudieron aplicarse.

La clienta no debe ver opciones administrativas de licencias ni controles de rol de manicurista.

## 4. Seguridad y recuperación de cuenta

### 4.1 Vinculación de estudios

El identificador numérico de seis cifras tiene solo 1.000.000 de combinaciones y **no debe ser la única barrera de autorización**.

Requisitos de seguridad:
- Limitar intentos en el servidor por usuario autenticado y por origen/IP cuando la infraestructura lo permita; introducir demoras progresivas y bloqueo temporal después de varios fallos.
- No revelar si un código existe mediante mensajes o tiempos de respuesta claramente distintos.
- El código debe identificar el estudio, no conceder acceso a su agenda privada. Solo expone información pública del negocio; los datos de clientas/citas requieren autorización independiente.
- La manicurista debe ver las relaciones de clientas vinculadas y poder desvincular una relación no reconocida.
- Definir expiración y rotación si el código es una invitación de un solo uso. Si se conserva un código permanente, tratarlo solo como identificador público y aplicar límites de intentos.
- Registrar intentos fallidos de forma segura, sin almacenar contraseñas ni tokens completos en logs.

**Estado observado:** la aplicación usa RPC de invitación (`luni_create_provider_invite`, `luni_preview_provider_invite`, `luni_accept_provider_invite`) y acciones de desvinculación. Esto no demuestra que haya rate limiting ni que el código de seis cifras sea el mecanismo actual de vinculación. Debe auditarse la implementación SQL y sus políticas antes de declarar estos controles como existentes.

### 4.2 Autenticación, roles y recuperación

- La autenticación la gestiona Supabase Auth; nunca guardar contraseñas propias en tablas de la aplicación.
- Los roles permitidos son `client`, `provider` y `admin`. La persona usuaria no puede elevar su propio rol; los cambios de privilegio se autorizan en servidor y desde administración.
- Al perder el teléfono, la recuperación debe depender de recuperar la cuenta de autenticación en un dispositivo nuevo. No se debe confiar en un PIN local como único mecanismo de recuperación.
- Proteger sesiones y cerrar sesión debe eliminar el acceso a datos locales de esa cuenta. Las colas offline deben estar aisladas por usuario y nunca enviarse usando la sesión de otra persona.

## 5. Sincronización offline y resolución de conflictos

### 5.1 Comportamiento esperado

- Las lecturas muestran la última copia local disponible cuando no hay red.
- Las escrituras offline se guardan en una cola persistente, se muestran como pendientes y se envían en orden al recuperar conectividad.
- Un cambio rechazado no se elimina silenciosamente: debe mostrar la causa, conservar el estado confirmado por servidor y permitir a la usuaria corregir o descartar el cambio.
- La cola se procesa por cuenta autenticada; las operaciones críticas usan claves idempotentes para que un reintento no duplique citas.

### 5.2 Dos reservas offline para el mismo turno

Una reserva creada sin red **no es una cita confirmada**. Debe mostrarse como «Pendiente de sincronizar; horario sujeto a disponibilidad». Cuando vuelve la conexión, Supabase decide de forma atómica qué solicitud puede ocupar el turno.

Si otra clienta ocupó el turno primero:
1. Marcar la solicitud local como conflicto/rechazada, no como confirmada.
2. Explicar que el horario dejó de estar disponible.
3. Actualizar la disponibilidad con los datos del servidor.
4. Ofrecer elegir un nuevo turno. La aplicación no debe reservar automáticamente otro horario sin consentimiento explícito.

Orden recomendado: primero cambios de citas y disponibilidad, luego operaciones dependientes; respetar el orden cronológico dentro de la cola y detener el envío al detectar falta de red. Los conflictos no deben bloquear para siempre los demás cambios independientes.

**Estado observado:** existe una cola IndexedDB persistente, orden de envío, indicadores de sincronización y manejo de conflictos. Hay pruebas E2E con servidor simulado, pero no equivalen a validar todos los conflictos con Supabase real y dos dispositivos Android.

## 6. Licencias y trabajo sin conexión

- El período de prueba y los planes de pago se validan en servidor.
- La activación/renovación por transferencia requiere aprobación administrativa salvo que se integre y pruebe un método de pago automático.
- El vencimiento no debe borrar ni bloquear la lectura de los datos locales. Agenda, historial y catálogo deben seguir consultables offline.
- Mientras no se pueda comprobar el estado actual de la licencia, mostrar «Estado de licencia pendiente de verificar» en lugar de inventar que está activa.
- Al recuperar conexión, revalidar licencia. Si venció, bloquear nuevas operaciones que requieren licencia (por ejemplo, aceptar nuevas reservas) conforme a la política del producto, pero conservar lectura/exportación de datos y permitir acceder a las instrucciones de renovación.
- Definir explícitamente si existe período de gracia, cuánto dura y qué operaciones permite. No asumir que una licencia previamente activa seguirá vigente indefinidamente offline.

**Estado observado:** el código contempla estados de licencia como prueba, activa, gracia, vencida y suspendida. La política exacta de acceso offline y la duración de gracia deben verificarse en las funciones SQL y en la UI antes de considerarlas cerradas.

## 7. Protección de fotos y publicaciones

- Validar tipo real de archivo y tamaño en cliente y servidor; el atributo `accept` por sí solo no es una validación de seguridad.
- Procesar y reducir imágenes en el dispositivo antes de subirlas.
- Definir un límite de tamaño y dimensiones para logotipos; actualmente el límite de archivo de entrada es 8 MB.
- No publicar un logotipo/foto si la carga o actualización de su registro falla.
- Proveer denuncia y retirada administrativa de publicaciones inapropiadas. La revisión automática requiere un componente real y no está confirmada en el estado actual.
- La estrategia final de almacenamiento debe respetar la restricción económica del proyecto y no depender de un bucket de pago sin decisión explícita.

## 8. Prioridad de implementación

1. **P0 — Seguridad del servidor:** auditar RPC, RLS, permisos, rate limiting de invitaciones y unicidad/solapamiento de reservas.
2. **P0 — Colorimetría:** mantener el mezclador, buscador inverso, ΔE, gotas, recetas y captura accesibles; probar cámara/permisos y alternativa manual en Android.
3. **P1 — Agenda fiable:** validar modo automático/manual, días no laborables, bloqueos y una sola cita activa por clienta.
4. **P1 — Offline real:** probar cierre/reinicio de app, dos dispositivos reservando el mismo turno, sesión expirada y recuperación de conflictos con Supabase.
5. **P1 — Licencia offline:** formalizar período de gracia, operaciones permitidas y acceso a los datos al vencer.
6. **P2 — Publicaciones seguras:** límites server-side, denuncia y ocultación de contenido.
7. **P2 — Coste de imágenes:** migrar a almacenamiento alternativo solo cuando exista una solución estable, gratuita y probada para Android/offline.

## 9. Matriz de estado a partir de inspección del repositorio

| Área | Estado observado | Qué falta para darla por cerrada |
|---|---|---|
| Mezclador, buscador y recetas | Código presente | Pruebas funcionales y validación del ΔE en dispositivos/datos reales |
| Gotas y tamaño de receta | Código presente; persistencia local | Probar migración de recetas antiguas y persistencia tras reinicio |
| Captura de color | Código presente; fallback manual añadido | Permisos/manifest Android, cámara ausente/ocupada y prueba en APK |
| Aprobación automática/manual | Campo y controles de UI presentes | Confirmar que la RPC de reserva respeta el ajuste atómicamente |
| Cola offline | Código presente | E2E con Supabase real y dos dispositivos |
| Código/invitación de estudio | RPC de invitación presente | Auditar rate limiting, expiración, RLS y desvinculación |
| Licencias | Estados y UI presentes | Verificar política de gracia/offline en servidor |
| Logotipo | Límite 8 MB y procesamiento local presentes | Validación server-side, moderación/reportes y decisión de almacenamiento |
| Android Manifest | No localizado en los archivos consultables de GitHub | Confirmar archivo nativo generado y permisos/features reales |
| Compilación Android tras últimos cambios | No confirmada aquí | Ejecutar build y probar APK en dispositivo/emulador |

