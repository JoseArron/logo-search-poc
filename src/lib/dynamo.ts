import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION;

const initClient = new DynamoDBClient({
  region: REGION,
});

// remove undefined values from objects
export const dynamoDocClient = DynamoDBDocumentClient.from(initClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export function getTableName(): string {
  const table = process.env.DYNAMO_TABLE;

  if (!table) {
    throw new Error("DYNAMO_TABLE env var is required.");
  }

  return table;
}

export function normalizeLogoName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolvePublicUrl(
  publicUrl: string | undefined,
  s3Key: string | undefined,
): string | null {
  if (publicUrl) {
    return publicUrl;
  }

  if (!s3Key) {
    return null;
  }

  const base = process.env.S3_PUBLIC_BASE_URL;

  if (!base) {
    return null;
  }

  return `${base.replace(/\/$/, "")}/${s3Key}`;
}
