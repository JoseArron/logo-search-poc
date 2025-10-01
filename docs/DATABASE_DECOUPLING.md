# Database Decoupling Guide

## Overview

This guide documents the migration from a single-table DynamoDB design to a decoupled multi-table design for better separation of concerns and maintainability.

## Why Decouple?

### Current Single-Table Design Issues
- Mixed responsibilities in one table (photos, mappings, summaries)
- Complex partition key patterns (`PHOTO`, `LOGO`, `LOGO#slug`)
- Harder to evolve schemas independently
- Difficult to apply principle of least privilege for IAM
- Aggregates and transactional data mixed together

### Benefits of Decoupled Design
- **Clear separation of concerns**: Photos, mappings, and summaries in separate tables
- **Independent evolution**: Change photo schema without touching mapping logic
- **Better scalability**: Summaries can scale independently or use different capacity modes
- **Cleaner access patterns**: Each table has clear, focused queries
- **Simplified IAM**: Grant access only to specific tables as needed
- **Easier to reason about**: Each table has a single responsibility

## New Table Design

### 1. Photos Table
**Purpose**: Store photo metadata and S3 references

**Primary Key**:
- `photoId` (HASH)

**Attributes**:
```typescript
{
  photoId: string;      // Primary key
  s3Key: string;        // S3 object key
  publicUrl?: string;   // Public URL (if available)
  createdAt: string;    // ISO timestamp
  updatedAt: string;    // ISO timestamp
}
```

**Access Patterns**:
- Get photo by ID
- Scan all photos (for gallery display)

### 2. PhotoLogos Table (Mapping)
**Purpose**: Many-to-many relationship between photos and logos

**Primary Key**:
- `logoSlug` (HASH)
- `sortKey` (RANGE) - Format: `photoId#detectionIndex`

**Global Secondary Index** (Optional for optimization):
- `photoId-index`
  - `photoId` (HASH)
  - `logoSlug` (RANGE)

**Attributes**:
```typescript
{
  logoSlug: string;     // Primary key (HASH)
  sortKey: string;      // Primary key (RANGE) - photoId#detectionIndex
  photoId: string;      // For GSI
  logoName: string;     // Display name
  confidence: number;   // Detection confidence (0-1)
  detectionIndex: number; // Index within photo
  boundingPoly?: Array<{ x: number; y: number }>; // Bounding box
  createdAt: string;    // ISO timestamp
}
```

**Access Patterns**:
- Query all photos with a specific logo (by `logoSlug`)
- Query all logos in a photo (via GSI on `photoId`)

### 3. LogoSummaries Table
**Purpose**: Aggregated statistics per logo

**Primary Key**:
- `logoSlug` (HASH)

**Attributes**:
```typescript
{
  logoSlug: string;        // Primary key
  displayName: string;     // Human-readable name
  totalPhotos: number;     // Count of photos
  topConfidence: number;   // Highest confidence score
  firstDetectedAt: string; // ISO timestamp
  lastDetectedAt: string;  // ISO timestamp
}
```

**Access Patterns**:
- Get summary for a logo
- Scan all logos (for filter UI)

## Migration Steps

### Phase 1: Create New Tables

Create three DynamoDB tables with the following settings:

```bash
# Photos Table
aws dynamodb create-table \
  --table-name logo-search-photos \
  --attribute-definitions \
    AttributeName=photoId,AttributeType=S \
  --key-schema \
    AttributeName=photoId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# PhotoLogos Table
aws dynamodb create-table \
  --table-name logo-search-photo-logos \
  --attribute-definitions \
    AttributeName=logoSlug,AttributeType=S \
    AttributeName=sortKey,AttributeType=S \
    AttributeName=photoId,AttributeType=S \
  --key-schema \
    AttributeName=logoSlug,KeyType=HASH \
    AttributeName=sortKey,KeyType=RANGE \
  --global-secondary-indexes \
    '[{
      "IndexName": "photoId-index",
      "KeySchema": [
        {"AttributeName":"photoId","KeyType":"HASH"},
        {"AttributeName":"logoSlug","KeyType":"RANGE"}
      ],
      "Projection": {"ProjectionType":"ALL"}
    }]' \
  --billing-mode PAY_PER_REQUEST

# LogoSummaries Table
aws dynamodb create-table \
  --table-name logo-search-logo-summaries \
  --attribute-definitions \
    AttributeName=logoSlug,AttributeType=S \
  --key-schema \
    AttributeName=logoSlug,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

### Phase 2: Update Environment Variables

Add new table names to your `.env.local` file:

```bash
# New decoupled tables
DYNAMO_PHOTOS_TABLE=logo-search-photos
DYNAMO_PHOTO_LOGOS_TABLE=logo-search-photo-logos
DYNAMO_LOGO_SUMMARIES_TABLE=logo-search-logo-summaries

# Keep existing single table for backward compatibility during migration
DYNAMO_TABLE=logo-search-index
```

### Phase 3: Run Decoupled Ingestion

Populate the new tables using the decoupled ingestion script:

```bash
npm run ingest:decoupled
```

This will:
1. List photos from S3
2. Run Google Vision API logo detection
3. Write to Photos table
4. Write mappings to PhotoLogos table
5. Update aggregates in LogoSummaries table

### Phase 4: Update Application Code

The decoupled repository layer is available at:
- `src/lib/repositories/logo-index-decoupled.ts`

To switch your application to use the decoupled tables:

1. Update API routes to import from the decoupled repository:
```typescript
// Before
import { fetchAllPhotos } from "@/app/repositories/logo-index";

// After
import { fetchAllPhotos } from "@/lib/repositories/logo-index-decoupled";
```

2. Ensure environment variables are set correctly
3. Test all API endpoints
4. Verify the gallery UI works correctly

### Phase 5: Validation

Test the following scenarios:
- [ ] Gallery page loads all photos
- [ ] Logo filter buttons appear
- [ ] Clicking a logo filters photos correctly
- [ ] Photo confidence scores display
- [ ] All logo detections show on each photo

### Phase 6: Cleanup (Optional)

Once the new tables are working:
1. Keep the old single table for backup
2. Update documentation
3. Remove old repository code when confident

## Cost Comparison

### Single Table Design
- **1 table** with mixed access patterns
- Read capacity: Depends on mixed queries
- Write capacity: Depends on mixed writes

### Decoupled Design
- **3 tables** with focused access patterns
- **Photos**: Low read/write (mostly reads for gallery)
- **PhotoLogos**: Medium read (for filtering), write during ingestion
- **LogoSummaries**: Low read/write (small dataset)

**Recommendation**: Use PAY_PER_REQUEST billing mode for PoC to minimize costs without traffic predictions.

## Performance Considerations

### Single Table
- ✅ Single query for photos with inline detections
- ❌ Complex queries with multiple partition keys
- ❌ Mixed hot/cold data in same table

### Decoupled Design
- ✅ Focused queries per table
- ✅ Can optimize each table independently
- ⚠️ May require batch operations for comprehensive views
- ✅ Can add GSI on PhotoLogos for reverse lookups

**For this PoC**: The slight overhead of batch operations is acceptable for the maintainability benefits.

## Rollback Plan

If issues arise:
1. Switch environment variables back to single table
2. Revert API imports to original repository
3. Keep new tables for future attempts

The old ingestion script and repository code remain unchanged.

## FAQ

**Q: Do I need to delete the old table?**
A: No, keep it as backup during transition.

**Q: What if I add new photos?**
A: Use `npm run ingest:decoupled` to process new S3 uploads.

**Q: Can I migrate existing data?**
A: Yes, write a migration script that reads from the old table and writes to new tables.

**Q: What about costs?**
A: For 100 photos with ~300 detections, costs are minimal (<$1/month with PAY_PER_REQUEST).

## Next Steps

After successful migration:
- Consider adding a GSI on PhotoLogos for photo → logos queries
- Set up DynamoDB Streams for real-time summary updates
- Implement TTL for temporary data if needed
- Add more sophisticated caching strategies
