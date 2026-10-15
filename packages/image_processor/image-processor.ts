import { encode } from "blurhash";
import { IMAGE_LIMITS, type ProcessedImage, type ProcessedImageSet, type ProcessedImageVariant } from "./image-types";

/**
 * Solo se suben miniatura y tarjeta (~70 KB en total): pensado para conexiones lentas.
 * La foto original del teléfono nunca sale del dispositivo.
 */
const DEFAULT_VARIANTS: ProcessedImageVariant[] = ["thumb", "card"];
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4];
// Por debajo de este tamaño decodificar completa es barato; por encima se reduce al decodificar.
const BIG_FILE_BYTES = 400 * 1024;

async function sha256(blob: Blob): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Contexto sin crypto.subtle: nombre único igualmente válido (no se deduplica por contenido).
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decodifica UNA sola vez, ya reducida y con la orientación EXIF aplicada. */
async function decode(file: File, maxDimension: number): Promise<ImageBitmap> {
  if (file.size > BIG_FILE_BYTES) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: maxDimension, resizeQuality: "medium" });
    } catch { /* navegador sin soporte de resize: se intenta sin él */ }
  }
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la foto. Prueba con otra imagen.");
  }
}

function drawScaled(source: CanvasImageSource & { width: number; height: number }, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo inicializar el procesador de imágenes.");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** WebP si el dispositivo lo soporta (si no, JPEG); baja la calidad hasta entrar en el objetivo. */
async function encodeWithin(canvas: HTMLCanvasElement, targetBytes: number): Promise<Blob> {
  for (const type of ["image/webp", "image/jpeg"]) {
    let last: Blob | null = null;
    for (const quality of QUALITIES) {
      const blob = await toBlob(canvas, type, quality);
      if (!blob || blob.type !== type) { last = null; break; }
      last = blob;
      if (blob.size <= targetBytes) return blob;
    }
    if (last) return last;
  }
  throw new Error("No se pudo comprimir la foto en este dispositivo.");
}

function createBlurhash(canvas: HTMLCanvasElement): string {
  const small = drawScaled(canvas, 32);
  const context = small.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  const pixels = context.getImageData(0, 0, small.width, small.height);
  return encode(new Uint8ClampedArray(pixels.data), small.width, small.height, 4, 3);
}

/**
 * Genera las variantes en el teléfono antes de subir nada.
 * Los tamaños objetivo son metas: la calidad baja progresivamente hasta alcanzarlas.
 */
export async function processImageLocally(
  source: File,
  variants: ProcessedImageVariant[] = DEFAULT_VARIANTS
): Promise<ProcessedImageSet> {
  if (!source.type.startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  const largest = Math.max(...variants.map((v) => IMAGE_LIMITS.variants[v].maxDimension));
  const bitmap = await decode(source, largest);
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close();
    throw new Error("La imagen no tiene dimensiones válidas.");
  }

  let base: HTMLCanvasElement;
  try { base = drawScaled(bitmap, largest); } finally { bitmap.close(); }

  const processed: ProcessedImage[] = [];
  for (const variant of variants) {
    const settings = IMAGE_LIMITS.variants[variant];
    const canvas = drawScaled(base, settings.maxDimension); // todas salen de la misma imagen ya reducida
    const file = await encodeWithin(canvas, settings.targetBytes);
    processed.push({ variant, file, width: canvas.width, height: canvas.height, sizeBytes: file.size, sha256: await sha256(file) });
  }

  return {
    blurhash: createBlurhash(base),
    originalBytes: source.size,
    totalBytes: processed.reduce((sum, p) => sum + p.sizeBytes, 0),
    variants: processed
  };
}
