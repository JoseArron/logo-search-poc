import {
  BatchGetCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  dynamoDocClient,
  getTableName,
  normalizeLogoName,
  resolvePublicUrl,
} from "@/lib/dynamo";

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
  firstPhotoId?: string;
  firstPhotoUrl?: string | null;
  firstDetectionBounds?: Array<{ x: number; y: number }>;
};

type RawItem = Record<string, unknown>;

type DynamoKey = {
  PK: string;
  SK: string;
};

const PHOTO_PARTITION_KEY = "PHOTO";
const LOGO_PARTITION_KEY = "LOGO";

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
  const detectedLogos: LogoDetection[] = Array.isArray(item.detections)
    ? (item.detections as RawItem[])
        .map((logo) => {
          const name = asString(logo.name) ?? asString(logo.displayName) ?? "";
          if (!name) {
            return null;
          }

          const detection: LogoDetection = {
            name,
            slug: normalizeLogoName(name),
            confidence: asNumber(logo.confidence ?? logo.score) ?? 0,
          };

          const detectionIndex = asNumber(logo.detectionIndex);
          if (detectionIndex !== undefined) {
            detection.detectionIndex = detectionIndex;
          }

          if (Array.isArray(logo.boundingPoly)) {
            detection.boundingPoly = logo.boundingPoly.map(
              (point: RawItem) => ({
                x: asNumber(point.x ?? point[0]) ?? 0,
                y: asNumber(point.y ?? point[1]) ?? 0,
              })
            );
          }

          return detection;
        })
        .filter((logo): logo is LogoDetection => Boolean(logo))
    : [];

  const s3Key = asString(item.s3Key);
  const publicUrl = asString(item.publicUrl);

  return {
    id: asString(item.SK) ?? asString(item.photoId) ?? "",
    imageUrl: resolvePublicUrl(publicUrl, s3Key),
    s3Key,
    logos: detectedLogos,
    createdAt: asString(item.createdAt),
  };
}

function mapLogoSummary(item: RawItem): LogoSummary {
  const fallbackName = asString(item.SK) ?? "";
  const name = asString(item.displayName) ?? fallbackName;
  const slug = normalizeLogoName(asString(item.SK) ?? name);
  const firstPhotoId = asString(item.firstPhotoId);
  const firstPhotoUrl = asString(item.firstPhotoUrl) ?? null;

  const firstDetectionBounds = Array.isArray(item.firstDetectionBounds)
    ? (item.firstDetectionBounds as RawItem[]).map((point: RawItem) => ({
        x: asNumber(point.x) ?? 0,
        y: asNumber(point.y) ?? 0,
      }))
    : undefined;

  return {
    slug,
    name,
    totalPhotos: Number(item.totalPhotos ?? item.count ?? 0),
    topConfidence: asNumber(item.topConfidence),
    firstPhotoId,
    firstPhotoUrl,
    firstDetectionBounds,
  };
}

export async function fetchAllPhotos(): Promise<PhotoRecord[]> {
  const tableName = getTableName("photos");

  const { Items } = await dynamoDocClient.send(
    new ScanCommand({
      TableName: tableName,
    })
  );

  const photos = (Items ?? []).map(mapPhotoItem);

  return photos.sort((a, b) => {
    if (a.createdAt && b.createdAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    return a.id.localeCompare(b.id);
  });
}

export async function fetchAllLogos(): Promise<LogoSummary[]> {
  const tableName = getTableName("logos");

  const { Items } = await dynamoDocClient.send(
    new ScanCommand({
      TableName: tableName,
    })
  );

  const logos = (Items ?? []).map(mapLogoSummary);

  return logos.sort(
    (a, b) => b.totalPhotos - a.totalPhotos || a.name.localeCompare(b.name)
  );
}

export async function fetchPhotosByLogo(
  logoNameOrSlug: string
): Promise<PhotoRecord[]> {
  const mappingTableName = getTableName("photo-logos");
  const slug = normalizeLogoName(logoNameOrSlug);
  const partitionKey = `LOGO#${slug}`;

  const { Items } = await dynamoDocClient.send(
    new QueryCommand({
      TableName: mappingTableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": partitionKey,
      },
    })
  );

  const mappings = Items ?? [];

  if (mappings.length === 0) {
    return [];
  }

  const photoIdConfidences = new Map<string, number>();

  const uniquePhotoIds: string[] = [];
  for (const item of mappings) {
    const sortKey = asString(item.SK);
    const photoId =
      asString(item.photoId) ?? (sortKey ? sortKey.split("#")[0] : undefined);
    if (!photoId) {
      continue;
    }

    if (!uniquePhotoIds.includes(photoId)) {
      uniquePhotoIds.push(photoId);
    }

    const confidence = asNumber(item.confidence);
    if (confidence === undefined) {
      continue;
    }

    const existing = photoIdConfidences.get(photoId);
    if (existing === undefined || confidence > existing) {
      photoIdConfidences.set(photoId, confidence);
    }
  }

  if (uniquePhotoIds.length === 0) {
    return [];
  }

  const photoTableName = getTableName("photos");

  const batchResponse = await dynamoDocClient.send(
    new BatchGetCommand({
      RequestItems: {
        [photoTableName]: {
          Keys: uniquePhotoIds.map(
            (photoId): DynamoKey => ({
              PK: PHOTO_PARTITION_KEY,
              SK: photoId,
            })
          ),
        },
      },
    })
  );

  const photoItems = batchResponse.Responses?.[photoTableName] ?? [];
  const photoMap = new Map(
    photoItems
      .map((item) => {
        const sortKey = asString(item.SK);
        if (!sortKey) {
          return null;
        }

        return [sortKey, mapPhotoItem(item)] as [string, PhotoRecord];
      })
      .filter((entry): entry is [string, PhotoRecord] => Boolean(entry))
  );

  return uniquePhotoIds
    .map((photoId) => {
      const photo = photoMap.get(photoId);
      if (!photo) {
        return null;
      }

      const cloned: PhotoRecord = {
        ...photo,
        logos: [...photo.logos],
      };

      const confidence = photoIdConfidences.get(photoId);
      if (confidence !== undefined) {
        cloned.matchConfidence = confidence;
      }

      return cloned;
    })
    .filter((photo): photo is PhotoRecord => Boolean(photo));
}
