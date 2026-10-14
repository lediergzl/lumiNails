#!/usr/bin/env node
/**
 * Mantiene CAMERA declarado en el manifest nativo que Capacitor genera.
 * Esto permite que BridgeWebChromeClient solicite el permiso runtime para getUserMedia().
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = process.argv[2];
if (!["client", "provider"].includes(app)) {
  console.error("Uso: node scripts/android/ensure-camera-permission.mjs client|provider");
  process.exit(2);
}

const manifestPath = path.join(ROOT, "apps", app, "android", "app", "src", "main", "AndroidManifest.xml");

async function main() {
  const xml = await readFile(manifestPath, "utf8");
  if (!/<manifest\b/i.test(xml) || !/<application\b/i.test(xml)) {
    throw new Error("AndroidManifest.xml no tiene la estructura esperada: " + manifestPath);
  }

  const cameraPermission = /<uses-permission\b(?=[^>]*\bandroid:name\s*=\s*["']android\.permission\.CAMERA["'])[^>]*\/?\s*>/i;
  if (cameraPermission.test(xml)) {
    console.log("Permiso de cámara ya declarado:", app);
    return;
  }

  const applicationTag = /^[ \t]*<application\b/m.exec(xml);
  if (!applicationTag || applicationTag.index === undefined) {
    throw new Error("No se encontró la etiqueta <application> en " + manifestPath);
  }

  const permissionLine = '    <uses-permission android:name="android.permission.CAMERA" />\n';
  const updated = xml.slice(0, applicationTag.index) + permissionLine + xml.slice(applicationTag.index);
  await writeFile(manifestPath, updated, "utf8");
  console.log("Permiso CAMERA añadido al manifest de", app);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
