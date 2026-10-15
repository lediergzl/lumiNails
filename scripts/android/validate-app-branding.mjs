#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = relative => readFile(path.join(ROOT, relative), "utf8");
const [clientConfig, providerConfig, clientHtml, providerHtml, clientPkgRaw, providerPkgRaw] = await Promise.all([
  read("apps/client/capacitor.config.ts"),
  read("apps/provider/capacitor.config.ts"),
  read("apps/client/index.html"),
  read("apps/provider/index.html"),
  read("apps/client/package.json"),
  read("apps/provider/package.json"),
]);
const clientPkg = JSON.parse(clientPkgRaw);
const providerPkg = JSON.parse(providerPkgRaw);
const checks = [
  ["Capacitor Cliente", /appName\s*:\s*["']Luni Cliente["']/.test(clientConfig)],
  ["Título Cliente", /<title>Luni Cliente<\/title>/.test(clientHtml)],
  ["Sync Cliente aplica nombre Android", clientPkg.scripts["cap:sync"].includes("ensure-app-name.mjs client")],
  ["APK Cliente usa nombre propio", clientPkg.scripts["android:debug"].includes("rename-apk.mjs client debug") && clientPkg.scripts["android:release"].includes("rename-apk.mjs client release")],
  ["Capacitor Studio", /appName\s*:\s*["']Luni Estudio["']/.test(providerConfig)],
  ["Título Studio", /<title>Luni Estudio<\/title>/.test(providerHtml)],
  ["Sync Studio aplica nombre Android", providerPkg.scripts["cap:sync"].includes("ensure-app-name.mjs provider")],
  ["APK Studio usa nombre propio", providerPkg.scripts["android:debug"].includes("rename-apk.mjs provider debug") && providerPkg.scripts["android:release"].includes("rename-apk.mjs provider release")],
];
let fail = false;
for (const [label, ok] of checks) {
  console.log((ok ? "PASS " : "FAIL ") + label);
  if (!ok) fail = true;
}
if (fail) process.exitCode = 1;
