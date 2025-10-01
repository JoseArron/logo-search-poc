# Logo Search Proof of Concept

A Next.js application for detecting and searching logos in photos using Google Cloud Vision API, AWS S3, and DynamoDB.

## Features

- 📸 Logo detection using Google Cloud Vision API
- 🔍 Filter photos by detected logos
- 🎨 Clean UI with shadcn components
- 📊 Multiple detections of the same logo per photo
- 🗄️ Decoupled database design for maintainability

## 🎯 Database Decoupling

This project now supports a **decoupled multi-table design** for better separation of concerns. See:
- **[README_DECOUPLING.md](README_DECOUPLING.md)** - Quick start guide
- **[docs/DATABASE_DECOUPLING.md](docs/DATABASE_DECOUPLING.md)** - Complete migration guide
- **[docs/ARCHITECTURE_COMPARISON.md](docs/ARCHITECTURE_COMPARISON.md)** - Design comparison & analysis

### Quick Start with Decoupled Tables

```bash
# 1. Create DynamoDB tables
./scripts/create-decoupled-tables.sh ap-southeast-2 logo-search

# 2. Configure environment variables
cp .env.example.decoupled .env.local
# Edit .env.local with your credentials

# 3. Run ingestion
npm run ingest:decoupled
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
