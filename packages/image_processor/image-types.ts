export const IMAGE_LIMITS = {
  maxDimension: 2048,
  variants: {
    thumb: { maxDimension: 200, targetBytes: 8_000 },
    card: { maxDimension: 600, targetBytes: 40_000 },
    detail: { maxDimension: 1080, targetBytes: 120_000 },
    original: { maxDimension: 2048, targetBytes: 400_000 }
  },
  cacheMaxBytes: 100 * 1024 * 1024
} as const;

export type ProcessedImageVariant =
  keyof typeof IMAGE_LIMITS.variants;

export interface ProcessedImage {
  variant: ProcessedImageVariant;
  file: Blob;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
}

export interface ProcessedImageSet {
  blurhash: string;
  variants: ProcessedImage[];
}
