# Database Decoupling Implementation

This document provides a quick overview of the database decoupling implementation. For detailed migration instructions, see [DATABASE_DECOUPLING.md](docs/DATABASE_DECOUPLING.md).

## What Changed?

The single-table DynamoDB design has been decoupled into **three separate tables** for better maintainability:

1. **Photos Table** - Photo metadata and S3 references
2. **PhotoLogos Table** - Many-to-many mappings between photos and logos
3. **LogoSummaries Table** - Aggregated statistics per logo

## Why Decouple?

- ✅ **Clear separation of concerns** - Each table has a single responsibility
- ✅ **Independent evolution** - Change schemas without affecting other tables
- ✅ **Better scalability** - Optimize each table separately
- ✅ **Cleaner access patterns** - Focused queries per table
- ✅ **Easier maintenance** - Simple to reason about and debug

## Files Added

### Schema Documentation
- `lambda/db-schema.ts` - Type definitions and schema documentation
- `docs/DATABASE_DECOUPLING.md` - Complete migration guide

### Decoupled Implementation
- `lambda/ingest-logos-decoupled.ts` - Ingestion script for new tables
- `src/lib/repositories/logo-index-decoupled.ts` - Repository layer for new tables

### Configuration
- `package.json` - Added `ingest:decoupled` npm script

## Quick Start

### 1. Create DynamoDB Tables

Create three tables in AWS Console or CLI:
- `logo-search-photos` (PK: photoId)
- `logo-search-photo-logos` (PK: logoSlug, SK: sortKey)
- `logo-search-logo-summaries` (PK: logoSlug)

See [DATABASE_DECOUPLING.md](docs/DATABASE_DECOUPLING.md) for AWS CLI commands.

### 2. Configure Environment

Add to `.env.local`:
```bash
DYNAMO_PHOTOS_TABLE=logo-search-photos
DYNAMO_PHOTO_LOGOS_TABLE=logo-search-photo-logos
DYNAMO_LOGO_SUMMARIES_TABLE=logo-search-logo-summaries
```

### 3. Run Ingestion

```bash
npm run ingest:decoupled
```

### 4. Update Application (Optional)

To use the new tables in your app:

```typescript
// In API routes, change:
import { fetchAllPhotos } from "@/app/repositories/logo-index";

// To:
import { fetchAllPhotos } from "@/lib/repositories/logo-index-decoupled";
```

## Comparison

### Before (Single Table)
```
logo-search-index
├─ PK=PHOTO, SK=photoId     (photo records with inline detections)
├─ PK=LOGO, SK=slug          (logo summaries)
└─ PK=LOGO#slug, SK=photoId#index (photo-logo mappings)
```

### After (Three Tables)
```
logo-search-photos
└─ PK=photoId (photo metadata only)

logo-search-photo-logos
└─ PK=logoSlug, SK=photoId#index (mappings)

logo-search-logo-summaries
└─ PK=logoSlug (aggregates)
```

## Migration Strategy

The decoupled implementation is **opt-in** and **non-breaking**:

- ✅ Old single-table code still works
- ✅ New tables are independent
- ✅ Gradual migration possible
- ✅ Easy rollback if needed

## Next Steps

1. **Create tables** - Use AWS Console or CLI
2. **Test ingestion** - Run `npm run ingest:decoupled` with test photos
3. **Validate data** - Check tables in AWS Console
4. **Update app** - Switch to decoupled repository when ready
5. **Monitor** - Verify costs and performance

## Documentation

- [Complete Migration Guide](docs/DATABASE_DECOUPLING.md) - Step-by-step instructions
- [Schema Documentation](lambda/db-schema.ts) - Type definitions and table specs

## Cost Impact

For a 100-photo PoC with ~300 logo detections:
- **Before**: ~$0.50/month (1 table)
- **After**: ~$0.75/month (3 tables)
- **Impact**: Minimal (~50% increase, still <$1/month)

Use PAY_PER_REQUEST billing mode to minimize costs.

## Questions?

See the [FAQ section](docs/DATABASE_DECOUPLING.md#faq) in the migration guide.
