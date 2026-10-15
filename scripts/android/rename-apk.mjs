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
const candidates = buildType === "release"
  ? [path.join(outputDir, "app-release.apk"), path.join(outputDir, "app-release-unsigned.apk")]
  : [path.join(outputDir, "app-debug.apk")];
const destination = path.join(outputDir, `${APPS[app].slug}-${buildType}.apk`);
try {
  let source = null;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      source = candidate;
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (!source) throw new Error("No se encontró ninguno de estos APK: " + candidates.join(", "));
  await copyFile(source, destination);
  console.log("APK listo:", path.relative(ROOT, destination));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
