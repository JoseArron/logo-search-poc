/**
 * Database Schema Documentation for Decoupled Multi-Table Design
 *
 * This schema separates concerns into three dedicated tables:
 * 1. Photos - stores photo metadata and S3 references
 * 2. PhotoLogos - many-to-many mapping between photos and logos
 * 3. LogoSummaries - aggregated statistics per logo
 */

/**
 * Table 1: Photos
 * Primary Key: photoId (HASH)
 *
 * Purpose: Store photo metadata and S3 location
 *
 * Attributes:
 * - photoId: string (PK) - Unique identifier for the photo
 * - s3Key: string - S3 object key
 * - publicUrl?: string - Public URL for the photo
 * - createdAt: string - ISO timestamp when ingested
 * - updatedAt: string - ISO timestamp of last update
 *
 * Access Patterns:
 * - Get photo by ID
 * - Scan all photos (for gallery)
 */

/**
 * Table 2: PhotoLogos (Mapping Table)
 * Primary Key: logoSlug (HASH), photoId#detectionIndex (RANGE)
 * GSI: photoId-index (photoId as HASH, logoSlug as RANGE)
 *
 * Purpose: Track which logos appear in which photos (many-to-many)
 *
 * Attributes:
 * - logoSlug: string (PK) - Normalized logo identifier
 * - sortKey: string (SK) - Composite: photoId#detectionIndex
 * - photoId: string - ID of the photo (for GSI)
 * - logoName: string - Display name of the logo
 * - confidence: number - Detection confidence score
 * - detectionIndex: number - Index of this detection in the photo
 * - boundingPoly?: array - Bounding box coordinates
 * - createdAt: string - ISO timestamp
 *
 * Access Patterns:
 * - Find all photos with a specific logo (Query by logoSlug)
 * - Find all logos in a specific photo (Query GSI by photoId)
 */

/**
 * Table 3: LogoSummaries
 * Primary Key: logoSlug (HASH)
 *
 * Purpose: Store aggregated statistics for each logo
 *
 * Attributes:
 * - logoSlug: string (PK) - Normalized logo identifier
 * - displayName: string - Human-readable logo name
 * - totalPhotos: number - Count of photos containing this logo
 * - topConfidence: number - Highest confidence score seen
 * - firstDetectedAt: string - ISO timestamp of first detection
 * - lastDetectedAt: string - ISO timestamp of most recent detection
 *
 * Access Patterns:
 * - Get summary for a logo
 * - Scan all logos (for filter UI)
 */

export type PhotoRecord = {
  photoId: string;
  s3Key: string;
  publicUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type PhotoLogoMapping = {
  logoSlug: string;
  sortKey: string; // photoId#detectionIndex
  photoId: string;
  logoName: string;
  confidence: number;
  detectionIndex: number;
  boundingPoly?: Array<{ x: number; y: number }>;
  createdAt: string;
};

export type LogoSummary = {
  logoSlug: string;
  displayName: string;
  totalPhotos: number;
  topConfidence: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
};

/**
 * Environment Variables for Table Names:
 * - DYNAMO_PHOTOS_TABLE - Name of the Photos table
 * - DYNAMO_PHOTO_LOGOS_TABLE - Name of the PhotoLogos mapping table
 * - DYNAMO_LOGO_SUMMARIES_TABLE - Name of the LogoSummaries table
 *
 * Migration Path:
 * 1. Create new tables in DynamoDB
 * 2. Run ingestion script to populate new tables
 * 3. Update API/repository layer to read from new tables
 * 4. Verify functionality
 * 5. Remove old single-table references
 */

/**
 * CloudFormation/Terraform snippet for table creation:
 *
 * Photos Table:
 *   KeySchema:
 *     - AttributeName: photoId
 *       KeyType: HASH
 *
 * PhotoLogos Table:
 *   KeySchema:
 *     - AttributeName: logoSlug
 *       KeyType: HASH
 *     - AttributeName: sortKey
 *       KeyType: RANGE
 *   GlobalSecondaryIndexes:
 *     - IndexName: photoId-index
 *       KeySchema:
 *         - AttributeName: photoId
 *           KeyType: HASH
 *         - AttributeName: logoSlug
 *           KeyType: RANGE
 *       Projection:
 *         ProjectionType: ALL
 *
 * LogoSummaries Table:
 *   KeySchema:
 *     - AttributeName: logoSlug
 *       KeyType: HASH
 */
