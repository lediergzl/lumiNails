import { encode } from "blurhash";
import imageCompression from "browser-image-compression";
import { IMAGE_LIMITS, type ProcessedImage, type ProcessedImageSet, type ProcessedImageVariant } from "./image-types";

const VARIANTS: ProcessedImageVariant[] = ["thumb", "card", "detail", "original"];

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

async function createBlurhash(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  const width = 32;
  const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
  canvas.width = width;
  canvas.height = Math.min(height, 32);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("No se pudo inicializar el procesador de imágenes.");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return encode(new Uint8ClampedArray(pixels.data), canvas.width, canvas.height, 4, 3);
}

/**
 * Creates WebP variants locally before any upload.
 * Target byte sizes are goals, not guarantees; compression quality is lowered
 * progressively when a variant exceeds its target.
 */
export async function processImageLocally(source: File): Promise<ProcessedImageSet> {
  if (!source.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  const sourceBitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  if (sourceBitmap.width < 1 || sourceBitmap.height < 1) {
    sourceBitmap.close();
    throw new Error("La imagen no tiene dimensiones válidas.");
  }
  sourceBitmap.close();

  const variants: ProcessedImage[] = [];
  let blurhash = "";

  for (const variant of VARIANTS) {
    const settings = IMAGE_LIMITS.variants[variant];
    let output: File | Blob | null = null;

    for (const quality of [0.85, 0.8, 0.75, 0.7]) {
      output = await imageCompression(source, {
        maxWidthOrHeight: settings.maxDimension,
        maxSizeMB: settings.targetBytes / (1024 * 1024),
        initialQuality: quality,
        fileType: "image/webp",
        useWebWorker: true,
        preserveExif: false
      });
      if (output.size <= settings.targetBytes || quality === 0.7) break;
    }

    if (!output) throw new Error(`No se pudo generar la variante ${variant}.`);
    const dimensions = await readDimensions(output);
    const processed: ProcessedImage = {
      variant,
      file: output,
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes: output.size,
      sha256: await sha256(output)
    };
    variants.push(processed);
    if (variant === "thumb") blurhash = await createBlurhash(output);
  }

  return { blurhash, variants };
}
