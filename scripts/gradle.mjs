#!/usr/bin/env node
// Ejecuta una tarea de Gradle en ./android (cwd = carpeta de la app) en Windows, macOS y Linux.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const task = process.argv[2];
if (!task) {
  console.error("Uso: node scripts/gradle.mjs <tarea>  (por ejemplo assembleDebug)");
  process.exit(1);
}

const androidDir = join(process.cwd(), "android");
if (!existsSync(androidDir)) {
  console.error("No existe la carpeta ./android. Genérala una vez con: npm run cap:add:client  (o cap:add:provider)");
  process.exit(1);
}

const win = process.platform === "win32";
const result = win
  ? spawnSync("gradlew.bat", [task], { cwd: androidDir, stdio: "inherit", shell: true })
  : spawnSync("sh", ["./gradlew", task], { cwd: androidDir, stdio: "inherit" });

process.exit(result.status ?? 1);
