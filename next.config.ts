import type { NextConfig } from "next";
import type { RemotePattern } from "next/dist/shared/lib/image-config";

const baseImageUrl = process.env.S3_PUBLIC_BASE_URL;

const remotePatterns: RemotePattern[] = baseImageUrl
  ? [
      {
        protocol: "https",
        hostname: new URL(baseImageUrl).hostname,
      },
    ]
  : [];

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
