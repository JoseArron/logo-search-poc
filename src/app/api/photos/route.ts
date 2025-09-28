import { NextResponse } from "next/server";

import { fetchAllPhotos } from "@/app/repositories/logo-index";

export async function GET() {
  try {
    const photos = await fetchAllPhotos();

    return NextResponse.json({ photos });
  } catch (error) {
    console.error("Failed to load photos", error);

    return NextResponse.json(
      {
        error: "Unable to load photos",
      },
      { status: 500 }
    );
  }
}
