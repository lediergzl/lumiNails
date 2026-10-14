#!/usr/bin/env node
/**
 * Aplica los iconos extraídos de la lámina de diseño de las dos APK Luni.
 * Convierte la fuente JPG compacta a recursos de 1024x1024 que lee @capacitor/assets.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APPS = {
  client: { background: "#FCF8EC", title: "Luni Cliente" },
  provider: { background: "#443637", title: "Luni Studio" },
};

async function main() {
  const app = process.argv[2];
  if (!Object.hasOwn(APPS, app)) {
    throw new Error("Indica la app: client o provider");
  }
  const cfg = APPS[app];
  const assetsDir = path.join(ROOT, "apps", app, "assets");
  const sourcePath = path.join(ROOT, "scripts", "brand", "sources", app + ".jpg.base64");
  await mkdir(assetsDir, { recursive: true });
  const encoded = (await readFile(sourcePath, "utf8")).trim();
  const source = Buffer.from(encoded, "base64");
  if (source.length < 1000) throw new Error("La fuente del icono parece incompleta: " + sourcePath);

  const iconPng = await sharp(source)
    .resize(1024, 1024, { fit: "fill", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const bgPng = await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: cfg.background,
    },
  }).png({ compressionLevel: 9 }).toBuffer();

  // Sustituye los iconos antiguos conservando los nombres esperados por Capacitor.
  await Promise.all([
    writeFile(path.join(assetsDir, "icon-only.png"), iconPng),
    writeFile(path.join(assetsDir, "icon-foreground.png"), iconPng),
    writeFile(path.join(assetsDir, "icon-background.png"), bgPng),
  ]);
  console.log("Iconos Luni aplicados:", cfg.title, "1024x1024");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
