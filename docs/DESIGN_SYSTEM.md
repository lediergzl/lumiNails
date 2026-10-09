# Sistema visual de Luni

## Dirección visual
- Estilo: elegante y premium, cálido, editorial y fácil de usar.
- Paleta: rosa empolvado, blanco marfil y dorado suave.
- Tipografías: Playfair Display para titulares y DM Sans para controles, etiquetas y texto funcional.
- Fondo base: marfil cálido (#fffdf9).
- Tinta principal: marrón ciruela (#443637).
- Rosa principal: rosa empolvado (#e9c8c8); acento más oscuro (#b8797e).
- Dorado suave: (#b59a68), solo para detalles.
- Bordes: cálidos y discretos (#eee5e0).
- Botones principales: marrón ciruela, alto contraste y radios pequeños.

## Cliente
- Descubrimiento de servicios con catálogo visual.
- Precio y duración visibles antes de iniciar reserva.
- Navegación: Descubrir, Mis citas, Mi perfil.
- Reserva debe diferenciar solicitud pendiente de confirmación real.
- Los datos mostrados actualmente son demostrativos; aún no están conectados a Supabase ni SQLite.

## Manicurista
- Agenda como pantalla principal.
- Navegación: Agenda, Mis servicios, Clientas, Mi negocio.
- Métricas y estados visuales con etiquetas diferenciadas.
- Añadir cita actualmente modifica solo la pantalla; no persiste ni sincroniza.

## Accesibilidad y responsive
- Controles con estados visibles y estilos focus-visible.
- Diseños adaptables a móviles pequeños y escritorio.
- Los controles interactivos actuales son prototipos de interfaz.

## Próxima integración
1. Sustituir datos de muestra por repositorios tipados.
2. Persistir catálogo y agenda en SQLite.
3. Conectar autenticación, catálogo y disponibilidad con Supabase.
4. Añadir cola de sincronización y conflictos de reservas.
5. Sustituir ilustraciones de muestra por imágenes optimizadas WebP.
