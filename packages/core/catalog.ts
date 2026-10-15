export type ImageVariant = "thumb" | "card" | "detail" | "original";

export interface ServiceImage {
  hash: string;
  version: string;
  blurhash: string | null;
  thumbUrl: string;
  cardUrl: string;
  detailUrl: string;
  originalUrl: string;
}

export interface CatalogService {
  id: string;
  providerId: string;
  name: string;
  priceCents: number;
  currency: "CUP";
  durationMinutes: number;
  image: ServiceImage | null;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
}
