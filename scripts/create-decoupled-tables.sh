#!/bin/bash

# Script to create DynamoDB tables for the decoupled design
# Usage: ./scripts/create-decoupled-tables.sh [region] [table-prefix]

set -e

REGION=${1:-ap-southeast-2}
PREFIX=${2:-logo-search}

echo "Creating DynamoDB tables in region: $REGION"
echo "Table prefix: $PREFIX"
echo ""

# Photos Table
echo "Creating Photos table: ${PREFIX}-photos..."
aws dynamodb create-table \
  --region "$REGION" \
  --table-name "${PREFIX}-photos" \
  --attribute-definitions \
    AttributeName=photoId,AttributeType=S \
  --key-schema \
    AttributeName=photoId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=LogoSearchPOC Key=TableType,Value=Photos

echo "✓ Photos table created"
echo ""

# PhotoLogos Table (with GSI)
echo "Creating PhotoLogos table: ${PREFIX}-photo-logos..."
aws dynamodb create-table \
  --region "$REGION" \
  --table-name "${PREFIX}-photo-logos" \
  --attribute-definitions \
    AttributeName=logoSlug,AttributeType=S \
    AttributeName=sortKey,AttributeType=S \
    AttributeName=photoId,AttributeType=S \
  --key-schema \
    AttributeName=logoSlug,KeyType=HASH \
    AttributeName=sortKey,KeyType=RANGE \
  --global-secondary-indexes \
    "[{
      \"IndexName\": \"photoId-index\",
      \"KeySchema\": [
        {\"AttributeName\":\"photoId\",\"KeyType\":\"HASH\"},
        {\"AttributeName\":\"logoSlug\",\"KeyType\":\"RANGE\"}
      ],
      \"Projection\": {\"ProjectionType\":\"ALL\"}
    }]" \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=LogoSearchPOC Key=TableType,Value=PhotoLogos

echo "✓ PhotoLogos table created (with photoId-index GSI)"
echo ""

# LogoSummaries Table
echo "Creating LogoSummaries table: ${PREFIX}-logo-summaries..."
aws dynamodb create-table \
  --region "$REGION" \
  --table-name "${PREFIX}-logo-summaries" \
  --attribute-definitions \
    AttributeName=logoSlug,AttributeType=S \
  --key-schema \
    AttributeName=logoSlug,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=LogoSearchPOC Key=TableType,Value=LogoSummaries

echo "✓ LogoSummaries table created"
echo ""

echo "All tables created successfully! 🎉"
echo ""
echo "Update your .env.local with:"
echo "DYNAMO_PHOTOS_TABLE=${PREFIX}-photos"
echo "DYNAMO_PHOTO_LOGOS_TABLE=${PREFIX}-photo-logos"
echo "DYNAMO_LOGO_SUMMARIES_TABLE=${PREFIX}-logo-summaries"
echo ""
echo "Waiting for tables to become active..."
aws dynamodb wait table-exists --region "$REGION" --table-name "${PREFIX}-photos"
aws dynamodb wait table-exists --region "$REGION" --table-name "${PREFIX}-photo-logos"
aws dynamodb wait table-exists --region "$REGION" --table-name "${PREFIX}-logo-summaries"

echo ""
echo "✓ All tables are now active and ready to use!"
echo ""
echo "Next steps:"
echo "1. Configure environment variables in .env.local"
echo "2. Run: npm run ingest:decoupled"
echo "3. Verify data in AWS Console"
