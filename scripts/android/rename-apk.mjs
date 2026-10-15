#!/usr/bin/env node
/**
 * Copia el APK compilado a un nombre de archivo claro y propio de cada producto.
 */
import { copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APPS = {
  client: { slug: "luni-cliente" },
  provider: { slug: "luni-estudio" },
};
const app = process.argv[2];
const buildType = process.argv[3];
if (!Object.hasOwn(APPS, app) || !["debug", "release"].includes(buildType)) {
  console.error("Uso: node scripts/android/rename-apk.mjs client|provider debug|release");
  process.exit(2);
}
const outputDir = path.join(ROOT, "apps", app, "android", "app", "build", "outputs", "apk", buildType);
const source = path.join(outputDir, `app-${buildType}.apk`);
const destination = path.join(outputDir, `${APPS[app].slug}-${buildType}.apk`);
try {
  await access(source);
  await copyFile(source, destination);
  console.log("APK listo:", path.relative(ROOT, destination));
} catch (error) {
  console.error(`No se encontró el APK ${source}. La compilación de Gradle debe terminar correctamente antes de renombrarlo.`);
  process.exitCode = 1;
}
