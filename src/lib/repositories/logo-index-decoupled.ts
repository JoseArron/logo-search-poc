import {
  BatchGetCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  dynamoDocClient,
  normalizeLogoName,
  resolvePublicUrl,
} from "@/lib/dynamo";

/**
 * Repository for decoupled multi-table design
 * Uses three separate tables: Photos, PhotoLogos, LogoSummaries
 */

export type LogoDetection = {
  name: string;
  slug: string;
  confidence: number;
  boundingPoly?: Array<{ x: number; y: number }>;
  detectionIndex?: number;
};

export type PhotoRecord = {
  id: string;
  imageUrl: string | null;
  s3Key?: string;
  logos: LogoDetection[];
  createdAt?: string;
  matchConfidence?: number;
};

export type LogoSummary = {
  slug: string;
  name: string;
  totalPhotos: number;
  topConfidence?: number;
};

type RawItem = Record<string, unknown>;

const PHOTOS_TABLE = process.env.DYNAMO_PHOTOS_TABLE;
const PHOTO_LOGOS_TABLE = process.env.DYNAMO_PHOTO_LOGOS_TABLE;
const LOGO_SUMMARIES_TABLE = process.env.DYNAMO_LOGO_SUMMARIES_TABLE;

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }

  return undefined;
}

function asNumber(value: unknown): number | undefined {
  const num = typeof value === "number" ? value : Number(value);

  if (Number.isFinite(num)) {
    return num;
  }

  return undefined;
}

function mapPhotoItem(item: RawItem): PhotoRecord {
  const photoId = asString(item.photoId) ?? "";
  const s3Key = asString(item.s3Key);
  const publicUrl = asString(item.publicUrl);

  return {
    id: photoId,
    imageUrl: resolvePublicUrl(publicUrl, s3Key),
    s3Key,
    logos: [], // Will be populated separately
    createdAt: asString(item.createdAt),
  };
}

function mapLogoMapping(item: RawItem): LogoDetection {
  const name = asString(item.logoName) ?? "";
  const slug = asString(item.logoSlug) ?? normalizeLogoName(name);

  const detection: LogoDetection = {
    name,
    slug,
    confidence: asNumber(item.confidence) ?? 0,
  };

  const detectionIndex = asNumber(item.detectionIndex);
  if (detectionIndex !== undefined) {
    detection.detectionIndex = detectionIndex;
  }

  if (Array.isArray(item.boundingPoly)) {
    detection.boundingPoly = item.boundingPoly.map((point: RawItem) => ({
      x: asNumber(point.x) ?? 0,
      y: asNumber(point.y) ?? 0,
    }));
  }

  return detection;
}

function mapLogoSummary(item: RawItem): LogoSummary {
  const slug = asString(item.logoSlug) ?? "";
  const name = asString(item.displayName) ?? slug;

  return {
    slug,
    name,
    totalPhotos: Number(item.totalPhotos ?? 0),
    topConfidence: asNumber(item.topConfidence),
  };
}

/**
 * Fetch all photos from the Photos table
 * Then fetch all logos for each photo from the PhotoLogos table
 */
export async function fetchAllPhotos(): Promise<PhotoRecord[]> {
  if (!PHOTOS_TABLE) {
    throw new Error("DYNAMO_PHOTOS_TABLE not configured");
  }

  if (!PHOTO_LOGOS_TABLE) {
    throw new Error("DYNAMO_PHOTO_LOGOS_TABLE not configured");
  }

  // Scan Photos table
  const { Items: photoItems } = await dynamoDocClient.send(
    new ScanCommand({
      TableName: PHOTOS_TABLE,
    }),
  );

  if (!photoItems || photoItems.length === 0) {
    return [];
  }

  const photos = photoItems.map(mapPhotoItem);
  const photoMap = new Map(photos.map((photo) => [photo.id, photo]));

  // Scan PhotoLogos table to get all logo detections
  const { Items: mappingItems } = await dynamoDocClient.send(
    new ScanCommand({
      TableName: PHOTO_LOGOS_TABLE,
    }),
  );

  // Group logos by photoId
  for (const item of mappingItems ?? []) {
    const photoId = asString(item.photoId);
    if (!photoId) {
      continue;
    }

    const photo = photoMap.get(photoId);
    if (!photo) {
      continue;
    }

    const detection = mapLogoMapping(item);
    photo.logos.push(detection);
  }

  // Sort photos by creation time (newest first)
  return photos.sort((a, b) => {
    if (a.createdAt && b.createdAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    return a.id.localeCompare(b.id);
  });
}

/**
 * Fetch all logo summaries from the LogoSummaries table
 */
export async function fetchAllLogos(): Promise<LogoSummary[]> {
  if (!LOGO_SUMMARIES_TABLE) {
    throw new Error("DYNAMO_LOGO_SUMMARIES_TABLE not configured");
  }

  const { Items } = await dynamoDocClient.send(
    new ScanCommand({
      TableName: LOGO_SUMMARIES_TABLE,
    }),
  );

  const logos = (Items ?? []).map(mapLogoSummary);

  return logos.sort(
    (a, b) => b.totalPhotos - a.totalPhotos || a.name.localeCompare(b.name),
  );
}

/**
 * Fetch all photos that contain a specific logo
 * Query PhotoLogos table by logoSlug, then batch get photos
 */
export async function fetchPhotosByLogo(
  logoNameOrSlug: string,
): Promise<PhotoRecord[]> {
  if (!PHOTOS_TABLE) {
    throw new Error("DYNAMO_PHOTOS_TABLE not configured");
  }

  if (!PHOTO_LOGOS_TABLE) {
    throw new Error("DYNAMO_PHOTO_LOGOS_TABLE not configured");
  }

  const slug = normalizeLogoName(logoNameOrSlug);

  // Query PhotoLogos table for all mappings with this logo
  const { Items: mappingItems } = await dynamoDocClient.send(
    new QueryCommand({
      TableName: PHOTO_LOGOS_TABLE,
      KeyConditionExpression: "logoSlug = :slug",
      ExpressionAttributeValues: {
        ":slug": slug,
      },
    }),
  );

  if (!mappingItems || mappingItems.length === 0) {
    return [];
  }

  // Extract unique photoIds and track confidence
  const photoIdConfidences = new Map<string, number>();
  const uniquePhotoIds: string[] = [];

  for (const item of mappingItems) {
    const photoId = asString(item.photoId);
    if (!photoId) {
      continue;
    }

    if (!uniquePhotoIds.includes(photoId)) {
      uniquePhotoIds.push(photoId);
    }

    const confidence = asNumber(item.confidence);
    if (confidence !== undefined) {
      const existing = photoIdConfidences.get(photoId);
      if (existing === undefined || confidence > existing) {
        photoIdConfidences.set(photoId, confidence);
      }
    }
  }

  if (uniquePhotoIds.length === 0) {
    return [];
  }

  // Batch get photos from Photos table
  const batchResponse = await dynamoDocClient.send(
    new BatchGetCommand({
      RequestItems: {
        [PHOTOS_TABLE]: {
          Keys: uniquePhotoIds.map((photoId) => ({ photoId })),
        },
      },
    }),
  );

  const photoItems = batchResponse.Responses?.[PHOTOS_TABLE] ?? [];
  const photoMap = new Map(
    photoItems
      .map((item) => {
        const photoId = asString(item.photoId);
        if (!photoId) {
          return null;
        }

        return [photoId, mapPhotoItem(item)] as [string, PhotoRecord];
      })
      .filter((entry): entry is [string, PhotoRecord] => Boolean(entry)),
  );

  // Query PhotoLogos again to get all detections for each photo
  // (This could be optimized with a GSI on photoId)
  const photoLogosMap = new Map<string, LogoDetection[]>();

  for (const photoId of uniquePhotoIds) {
    // For now, collect from the mappings we already have
    const logosForPhoto = mappingItems
      .filter((item) => asString(item.photoId) === photoId)
      .map(mapLogoMapping);

    photoLogosMap.set(photoId, logosForPhoto);
  }

  // Build final photo records with logos
  return uniquePhotoIds
    .map((photoId) => {
      const photo = photoMap.get(photoId);
      if (!photo) {
        return null;
      }

      const cloned: PhotoRecord = {
        ...photo,
        logos: photoLogosMap.get(photoId) ?? [],
      };

      const confidence = photoIdConfidences.get(photoId);
      if (confidence !== undefined) {
        cloned.matchConfidence = confidence;
      }

      return cloned;
    })
    .filter((photo): photo is PhotoRecord => Boolean(photo));
}
