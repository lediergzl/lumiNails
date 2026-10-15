#!/usr/bin/env node
/**
 * Reafirma el nombre visible de la aplicación en el proyecto Android generado.
 * Capacitor no siempre reemplaza strings.xml cuando appName cambia en una app ya creada.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG = {
  client: { name: "Luni Cliente" },
  provider: { name: "Luni Estudio" },
};
const app = process.argv[2];
if (!Object.hasOwn(CONFIG, app)) {
  console.error("Uso: node scripts/android/ensure-app-name.mjs client|provider");
  process.exit(2);
}
const displayName = CONFIG[app].name;
const androidRoot = path.join(ROOT, "apps", app, "android", "app", "src", "main");
const manifestPath = path.join(androidRoot, "AndroidManifest.xml");
const resourcesPath = path.join(androidRoot, "res");
const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function setAndroidLabel(tag, resourceName) {
  const labelAttribute = /\bandroid:label\s*=\s*(["'])[^"']*\1/i;
  const label = `android:label="@string/${resourceName}"`;
  return labelAttribute.test(tag)
    ? tag.replace(labelAttribute, label)
    : tag.replace(/\s*\/?>$/, end => ` ${label}${end}`);
}

function setStringResource(xml, key, value) {
  const openingAndClosing = new RegExp(`(<string\\b(?=[^>]*\\bname=["']${key}["'])[^>]*>)[\\s\\S]*?(</string>)`, "i");
  if (!openingAndClosing.test(xml)) return { xml, found: false };
  return { xml: xml.replace(openingAndClosing, `$1${escapeXml(value)}$2`), found: true };
}

async function main() {
  let manifest = await readFile(manifestPath, "utf8");
  const applicationTag = /<application\b[^>]*>/i;
  if (!applicationTag.test(manifest)) throw new Error("No se encontró <application> en " + manifestPath);
  manifest = manifest.replace(applicationTag, tag => setAndroidLabel(tag, "app_name"));

  let foundMainActivity = false;
  manifest = manifest.replace(/<activity\b[^>]*>/gi, tag => {
    if (!/\bandroid:name\s*=\s*["'][^"']*MainActivity["']/i.test(tag)) return tag;
    foundMainActivity = true;
    return setAndroidLabel(tag, "title_activity_main");
  });
  if (!foundMainActivity) {
    throw new Error("No se encontró la actividad MainActivity para aplicar el nombre visible: " + manifestPath);
  }
  await writeFile(manifestPath, manifest, "utf8");

  const resourceDirs = (await readdir(resourcesPath, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^values(?:-[A-Za-z0-9_-]+)?$/.test(entry.name))
    .map(entry => path.join(resourcesPath, entry.name));
  let updatedDefault = { app_name: false, title_activity_main: false };
  for (const dir of resourceDirs) {
    const stringsPath = path.join(dir, "strings.xml");
    let xml;
    try { xml = await readFile(stringsPath, "utf8"); } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const key of ["app_name", "title_activity_main"]) {
      const updated = setStringResource(xml, key, displayName);
      xml = updated.xml;
      if (dir === path.join(resourcesPath, "values")) updatedDefault[key] = updated.found;
    }
    await writeFile(stringsPath, xml, "utf8");
  }
  if (!resourceDirs.length || !updatedDefault.app_name || !updatedDefault.title_activity_main) {
    throw new Error("No se pudieron actualizar app_name y title_activity_main en res/values/strings.xml. Ejecuta primero 'cap sync android'.");
  }
  console.log(`Nombre Android aplicado: ${displayName} (${app})`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
