import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import vision from "@google-cloud/vision";
import { config as loadEnv } from "dotenv";

import { normalizeLogoName } from "../src/lib/dynamo";

loadEnv({ path: ".env.local" });
loadEnv();

const REGION = process.env.AWS_REGION ?? "ap-southeast-2";
const PHOTOS_TABLE = process.env.DYNAMO_PHOTOS_TABLE;
const PHOTO_LOGOS_TABLE = process.env.DYNAMO_PHOTO_LOGOS_TABLE;
const LOGO_SUMMARIES_TABLE = process.env.DYNAMO_LOGO_SUMMARIES_TABLE;
const S3_BUCKET = process.env.S3_BUCKET;
const S3_PREFIX = process.env.S3_PREFIX ?? "photos/";
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL;
const MAX_ITEMS = Number(process.env.INGEST_LIMIT ?? 100);

if (!PHOTOS_TABLE) {
  throw new Error("DYNAMO_PHOTOS_TABLE env var is required");
}

if (!PHOTO_LOGOS_TABLE) {
  throw new Error("DYNAMO_PHOTO_LOGOS_TABLE env var is required");
}

if (!LOGO_SUMMARIES_TABLE) {
  throw new Error("DYNAMO_LOGO_SUMMARIES_TABLE env var is required");
}

if (!S3_BUCKET) {
  throw new Error("S3_BUCKET env var is required");
}

const bucketName = S3_BUCKET;
const publicBaseUrl = S3_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? null;

const s3 = new S3Client({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION }),
  {
    marshallOptions: { removeUndefinedValues: true },
  },
);
const visionClient = new vision.ImageAnnotatorClient();

type LogoDetection = {
  name: string;
  slug: string;
  confidence: number;
  boundingPoly?: Array<{ x: number; y: number }>;
  detectionIndex: number;
};

type MappingRequest = {
  PutRequest: {
    Item: Record<string, unknown>;
  };
};

function chunk<T>(items: T[], size: number): T[][] {
  const buckets: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    buckets.push(items.slice(i, i + size));
  }
  return buckets;
}

function keyToPhotoId(key: string): string {
  const trimmed = key.startsWith(S3_PREFIX) ? key.slice(S3_PREFIX.length) : key;
  const withoutExt = trimmed.replace(/\.[^/.]+$/, "");
  return withoutExt.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildPublicUrl(key: string): string | undefined {
  if (!publicBaseUrl) {
    return undefined;
  }

  return `${publicBaseUrl}/${key}`;
}

async function listPhotos(): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: S3_PREFIX,
        ContinuationToken: continuationToken,
        MaxKeys: Math.min(MAX_ITEMS, 1000),
      }),
    );

    const batchKeys = (response.Contents ?? [])
      .filter((object) => object.Key && !object.Key.endsWith("/"))
      .map((object) => object.Key as string);

    keys.push(...batchKeys);
    continuationToken = response.NextContinuationToken;

    if (keys.length >= MAX_ITEMS) {
      break;
    }
  } while (continuationToken);

  return keys.slice(0, MAX_ITEMS);
}

async function detectLogosForKey(key: string): Promise<LogoDetection[]> {
  const getObjectResponse = await s3.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );

  const body = getObjectResponse.Body;
  if (!body) {
    throw new Error(`S3 object body missing for ${key}`);
  }

  const bytes = await asBuffer(body);
  const [result] = await visionClient.logoDetection({
    image: { content: bytes },
  });
  console.table(result);
  const annotations = result.logoAnnotations ?? [];
  console.log(`Detected ${annotations.length} logos for ${key}`);

  return annotations
    .filter((annotation) => annotation.description)
    .map((annotation, i) => {
      const name = annotation.description ?? "";
      console.log(`${i} detected logo: ${name}`);
      return {
        name,
        slug: normalizeLogoName(name),
        confidence: annotation.score ?? 0,
        boundingPoly: annotation.boundingPoly?.vertices?.map((vertex) => ({
          x: vertex?.x ?? 0,
          y: vertex?.y ?? 0,
        })),
        detectionIndex: i,
      };
    });
}

async function asBuffer(stream: unknown): Promise<Buffer> {
  if (!stream) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(stream)) {
    return stream;
  }

  if (stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }

  const candidate = stream as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof candidate.transformToByteArray === "function") {
    return Buffer.from(await candidate.transformToByteArray());
  }

  return new Promise((resolve, reject) => {
    const readable = stream as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    readable.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("error", reject);
  });
}

async function writeMappingBatch(batch: MappingRequest[], tableName: string) {
  if (batch.length === 0) {
    return;
  }

  let requestItems: Record<string, MappingRequest[]> | undefined = {
    [tableName]: batch,
  };

  do {
    const response = await dynamo.send(
      new BatchWriteCommand({
        RequestItems: requestItems,
      }),
    );

    const unprocessed = (response.UnprocessedItems?.[tableName] ??
      []) as MappingRequest[];
    if (unprocessed.length === 0) {
      return;
    }

    console.warn(
      `Retrying ${unprocessed.length} unprocessed mapping writes...`,
    );
    requestItems = { [tableName]: unprocessed };
  } while (requestItems && requestItems[tableName].length > 0);
}

async function savePhotoDecoupled(key: string, logos: LogoDetection[]) {
  const photoId = keyToPhotoId(key);
  const publicUrl = buildPublicUrl(key);
  const now = new Date().toISOString();

  // 1. Write to Photos table
  await dynamo.send(
    new PutCommand({
      TableName: PHOTOS_TABLE,
      Item: {
        photoId,
        s3Key: key,
        publicUrl,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );

  if (logos.length === 0) {
    return;
  }

  // 2. Write to PhotoLogos mapping table
  const mappingWrites: MappingRequest[] = logos.map((logo) => {
    const sortKey = `${photoId}#${logo.detectionIndex
      .toString()
      .padStart(4, "0")}`;
    const item: Record<string, unknown> = {
      logoSlug: logo.slug,
      sortKey,
      photoId,
      logoName: logo.name,
      confidence: logo.confidence,
      detectionIndex: logo.detectionIndex,
      createdAt: now,
    };

    if (logo.boundingPoly) {
      item.boundingPoly = logo.boundingPoly;
    }

    return {
      PutRequest: {
        Item: item,
      },
    };
  });

  for (const batch of chunk(mappingWrites, 25)) {
    await writeMappingBatch(batch, PHOTO_LOGOS_TABLE);
  }

  // 3. Update LogoSummaries table with aggregates
  const slugSummaries = new Map<
    string,
    { maxConfidence: number; name: string }
  >();

  for (const logo of logos) {
    const current = slugSummaries.get(logo.slug);
    if (!current || logo.confidence > current.maxConfidence) {
      slugSummaries.set(logo.slug, {
        maxConfidence: logo.confidence,
        name: logo.name,
      });
    }
  }

  for (const [slug, summary] of slugSummaries) {
    await dynamo.send(
      new UpdateCommand({
        TableName: LOGO_SUMMARIES_TABLE,
        Key: {
          logoSlug: slug,
        },
        UpdateExpression:
          "SET displayName = if_not_exists(displayName, :name), topConfidence = if_not_exists(topConfidence, :confidence), firstDetectedAt = if_not_exists(firstDetectedAt, :now), lastDetectedAt = :now ADD totalPhotos :inc",
        ExpressionAttributeValues: {
          ":name": summary.name,
          ":confidence": summary.maxConfidence,
          ":now": now,
          ":inc": 1,
        },
      }),
    );
  }
}

async function main() {
  console.info("Listing photos from S3...");
  const keys = await listPhotos();
  console.info(`Found ${keys.length} objects to process.`);

  for (const key of keys) {
    console.info(`Processing ${key}...`);

    try {
      const logos = await detectLogosForKey(key);
      await savePhotoDecoupled(key, logos);
      console.info(`Stored ${logos.length} logos for ${key}`);
    } catch (error) {
      console.error(`Failed to process ${key}`, error);
    }
  }

  console.info("Ingestion complete.");
}

main().catch((error) => {
  console.error("Fatal ingestion error", error);
  process.exit(1);
});
