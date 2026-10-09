# lumiNails

Luni es una plataforma SaaS para manicuristas y clientes.

## Apps
- Luni Cliente
- Luni Manicurista

## Stack
React + TypeScript + Vite + Capacitor + Zustand.

La app de manicurista tendrá 14 días de prueba y posteriormente requerirá una licencia activa.

## Android: flujo 100% por consola

No es necesario abrir Android Studio.

Desde la raíz del repositorio:

```powershell
npm install
npm run build
```

La primera vez, genera el proyecto Android de cada app. Esto crea `apps/<app>/android` y también el **ícono y el splash** a partir de `apps/<app>/assets/` (con `@capacitor/assets`):

```powershell
npm run cap:add:client
npm run cap:add:provider
```

Cliente usa rosa empolvado y Studio ciruela con dorado, para distinguirlas de un vistazo. Si cambias la marca, regenera las imágenes y vuelve a ejecutar `npm run assets:android` dentro de la app:

```powershell
pip install pillow fonttools
npm run brand:generate
```

Los scripts de Gradle funcionan en Windows, macOS y Linux (`scripts/gradle.mjs`).

### Cliente

```powershell
npm run android:debug:client
```

APK debug:

```text
apps/client/android/app/build/outputs/apk/debug/app-debug.apk
```

### Manicurista

```powershell
npm run android:debug:provider
```

APK debug:

```text
apps/provider/android/app/build/outputs/apk/debug/app-debug.apk
```

Los comandos anteriores ejecutan automáticamente:

1. Build React/Vite.
2. `npx cap sync android`.
3. Gradle `assembleDebug`.

Para release:

```powershell
npm run android:release:client
npm run android:release:provider
```

La firma de producción con keystore se configurará antes de generar el APK/AAB definitivo de distribución. No se deben guardar contraseñas ni keystores en Git.

## Desarrollo local

Cliente:

```powershell
npm run dev:client
```

Manicurista:

```powershell
npm run dev:provider
```
