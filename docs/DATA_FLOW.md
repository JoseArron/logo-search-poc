# Data Flow: Single Table vs Decoupled Design

## Ingestion Flow Comparison

### Single Table Ingestion

```
┌─────────────────────────────────────────────────────────────┐
│                    S3 Bucket                                 │
│              photos/image1.jpg                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ 1. GetObject
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Ingestion Script                                │
│         lambda/ingest-logos.ts                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ 2. Send image bytes
                   ▼
┌─────────────────────────────────────────────────────────────┐
│         Google Cloud Vision API                              │
│         Logo Detection                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ 3. Returns detections
                   │    [{name: "Nike", confidence: 0.95}, ...]
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Ingestion Script                                │
│         Process and write to DynamoDB                        │
└─────────┬───────────┬────────────┬──────────────────────────┘
          │           │            │
          │ 4a.       │ 4b.        │ 4c.
          │ PutItem   │ BatchWrite │ UpdateItem
          │           │            │
          ▼           ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│             DynamoDB: logo-search-index                      │
│                                                              │
│  [PHOTO#photo-001]                                          │
│  ├─ s3Key, publicUrl                                        │
│  └─ detectedLogos: [inline array]                           │
│                                                              │
│  [LOGO#slug mappings]                                       │
│  ├─ LOGO#nike → photo-001#0000                             │
│  └─ LOGO#nike → photo-002#0000                             │
│                                                              │
│  [LOGO summary]                                             │
│  └─ LOGO → nike (totalPhotos: 42)                          │
└─────────────────────────────────────────────────────────────┘
```

**Characteristics:**
- ✅ Single transaction scope
- ❌ Complex item structure
- ❌ Data duplication (logos inline + mappings)
- ⚠️ Hard to evolve schemas

---

### Decoupled Ingestion

```
┌─────────────────────────────────────────────────────────────┐
│                    S3 Bucket                                 │
│              photos/image1.jpg                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ 1. GetObject
                   ▼
┌─────────────────────────────────────────────────────────────┐
│           Ingestion Script (Decoupled)                       │
│      lambda/ingest-logos-decoupled.ts                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ 2. Send image bytes
                   ▼
┌─────────────────────────────────────────────────────────────┐
│         Google Cloud Vision API                              │
│         Logo Detection                                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ 3. Returns detections
                   │    [{name: "Nike", confidence: 0.95}, ...]
                   ▼
┌─────────────────────────────────────────────────────────────┐
│           Ingestion Script (Decoupled)                       │
│      Process and write to 3 tables                           │
└─────────┬───────────┬────────────┬──────────────────────────┘
          │           │            │
          │ 4a.       │ 4b.        │ 4c.
          │ PutItem   │ BatchWrite │ UpdateItem
          │           │            │
          ▼           ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────────┐
│   Photos     │ │ PhotoLogos   │ │  LogoSummaries     │
│              │ │              │ │                    │
│ photoId:     │ │ logoSlug:    │ │ logoSlug: nike     │
│   photo-001  │ │   nike       │ │                    │
│              │ │ sortKey:     │ │ displayName:       │
│ s3Key:       │ │   photo-001  │ │   Nike             │
│   photos/... │ │   #0000      │ │                    │
│              │ │              │ │ totalPhotos: 42    │
│ publicUrl:   │ │ photoId:     │ │                    │
│   https://.. │ │   photo-001  │ │ topConfidence:     │
│              │ │              │ │   0.98             │
│ createdAt    │ │ logoName:    │ │                    │
│ updatedAt    │ │   Nike       │ │ firstDetectedAt    │
│              │ │              │ │ lastDetectedAt     │
│              │ │ confidence:  │ │                    │
│              │ │   0.95       │ │                    │
└──────────────┘ └──────────────┘ └────────────────────┘
```

**Characteristics:**
- ✅ Clean separation of concerns
- ✅ No data duplication
- ✅ Each table optimized for its purpose
- ✅ Easy to evolve independently

---

## Read Flow Comparison

### Gallery Page Load (All Photos)

**Single Table:**
```
Client Request
    │
    ├─ GET /api/photos
    │
    ▼
┌──────────────────────────────────────┐
│  API Route                           │
│  fetchAllPhotos()                    │
└────────────┬─────────────────────────┘
             │
             │ Query(PK="PHOTO")
             ▼
┌──────────────────────────────────────┐
│  DynamoDB: logo-search-index         │
└────────────┬─────────────────────────┘
             │
             │ Returns photos with
             │ inline logo arrays
             ▼
┌──────────────────────────────────────┐
│  Client receives photos              │
│  [{                                  │
│    id: "photo-001",                  │
│    logos: [                          │
│      {name: "Nike", conf: 0.95},     │
│      {name: "Adidas", conf: 0.87}    │
│    ]                                 │
│  }]                                  │
└──────────────────────────────────────┘
```
**Operations:** 1 Query
**Latency:** ~50ms

---

**Decoupled:**
```
Client Request
    │
    ├─ GET /api/photos
    │
    ▼
┌──────────────────────────────────────┐
│  API Route                           │
│  fetchAllPhotos()                    │
└─────────┬──────────┬─────────────────┘
          │          │
          │ Scan     │ Scan
          ▼          ▼
    ┌─────────┐ ┌──────────┐
    │ Photos  │ │PhotoLogos│
    └────┬────┘ └────┬─────┘
         │           │
         │           │ Returns mappings
         │           │ grouped by photoId
         │           │
         └───────┬───┘
                 │ Join in application
                 ▼
┌──────────────────────────────────────┐
│  Client receives photos              │
│  [{                                  │
│    id: "photo-001",                  │
│    logos: [                          │
│      {name: "Nike", conf: 0.95},     │
│      {name: "Adidas", conf: 0.87}    │
│    ]                                 │
│  }]                                  │
└──────────────────────────────────────┘
```
**Operations:** 2 Scans + Join
**Latency:** ~80ms

---

### Filter by Logo

**Single Table:**
```
Client Request (filter: Nike)
    │
    ├─ GET /api/logos/nike
    │
    ▼
┌──────────────────────────────────────┐
│  API Route                           │
│  fetchPhotosByLogo("nike")           │
└─────────┬──────────┬─────────────────┘
          │          │
          │ Query    │ BatchGet
          ▼          ▼
┌───────────────┐ ┌────────────────┐
│ LOGO#nike     │ │ PHOTO records  │
│ mappings      │ │                │
└───────────────┘ └────────────────┘
```
**Operations:** 1 Query + 1 BatchGet
**Latency:** ~60ms

---

**Decoupled:**
```
Client Request (filter: Nike)
    │
    ├─ GET /api/logos/nike
    │
    ▼
┌──────────────────────────────────────┐
│  API Route                           │
│  fetchPhotosByLogo("nike")           │
└─────────┬──────────┬─────────────────┘
          │          │
          │ Query    │ BatchGet
          ▼          ▼
┌───────────────┐ ┌────────────────┐
│ PhotoLogos    │ │ Photos table   │
│ logoSlug=nike │ │                │
└───────────────┘ └────────────────┘
```
**Operations:** 1 Query + 1 BatchGet
**Latency:** ~60ms

---

## Update Flow Comparison

### Update Logo Statistics

**Single Table:**
```
New detection of Nike
    │
    ▼
┌──────────────────────────────────────┐
│  UpdateItem                          │
│  PK="LOGO", SK="nike"                │
│  ADD totalPhotos :1                  │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│  DynamoDB: logo-search-index         │
│  (Mixed with photo data)             │
└──────────────────────────────────────┘
```
**Issue:** Update contention with photo reads

---

**Decoupled:**
```
New detection of Nike
    │
    ▼
┌──────────────────────────────────────┐
│  UpdateItem                          │
│  logoSlug="nike"                     │
│  ADD totalPhotos :1                  │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│  DynamoDB: logo-summaries            │
│  (Isolated from photo data)          │
└──────────────────────────────────────┘
```
**Benefit:** No contention, isolated updates

---

## Summary

### Performance Comparison

| Operation | Single Table | Decoupled | Difference |
|-----------|--------------|-----------|------------|
| Gallery load | 1 Query (~50ms) | 2 Scans + Join (~80ms) | +30ms |
| Filter by logo | Query + BatchGet (~60ms) | Query + BatchGet (~60ms) | Same |
| Logo list | 1 Query (~20ms) | 1 Scan (~20ms) | Same |
| Update summary | UpdateItem (~30ms) | UpdateItem (~25ms) | -5ms (less contention) |

### Design Trade-offs

| Aspect | Single Table | Decoupled |
|--------|--------------|-----------|
| **Read Simplicity** | ✅ Simple (1 query) | ⚠️ Requires join |
| **Write Simplicity** | ⚠️ Complex items | ✅ Simple items |
| **Maintainability** | ❌ Hard to evolve | ✅ Easy to evolve |
| **Data Duplication** | ❌ Logos stored twice | ✅ No duplication |
| **Schema Evolution** | ❌ Complex | ✅ Simple |
| **IAM Policies** | ❌ All-or-nothing | ✅ Granular |
| **Contention** | ⚠️ Possible | ✅ Isolated |
| **Cost** | ✅ $0.50/mo | ⚠️ $0.75/mo |

### Recommendation

For a **maintainability-focused PoC**, the decoupled design wins despite slightly higher latency (+30ms) and cost (+50% but <$1/mo).

**Choose Decoupled If:**
- You value code clarity and maintainability
- Schema will evolve over time
- Team needs to reason about data easily
- Want flexible IAM and access control

**Choose Single Table If:**
- Every millisecond of latency matters
- Schema is stable and won't change
- Cost optimization is critical
- Need ACID transactions across entities
