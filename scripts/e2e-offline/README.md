# Prueba del modo sin conexión

Corta la red de verdad en un navegador y comprueba, para cada app: datos guardados visibles, aviso
«datos guardados hace…», sesión que no se pierde con el token caducado, red lenta (muestra lo guardado en ~5 s),
reconexión automática, reserva bloqueada sin conexión (cliente), borrado de la copia al cerrar sesión
y que sin copia previa nunca se ofrezca «Registra tu estudio» (manicurista).

No necesita Supabase: simula las respuestas del servidor.

```bash
# 1) compilar las apps apuntando a un Supabase simulado
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=anon npm run build
# 2) instalar y ejecutar
cd scripts/e2e-offline && npm install
node run.mjs client
node run.mjs provider
```
