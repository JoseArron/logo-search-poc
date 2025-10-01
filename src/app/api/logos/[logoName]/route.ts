import { NextResponse } from "next/server";

import { normalizeLogoName } from "@/lib/dynamo";
import { fetchPhotosByLogo } from "@/lib/repositories/logo-index";

export async function GET(
  _: Request,
  context: { params: Promise<{ logoName: string }> },
) {
  try {
    const params = await context.params;
    const logoParam = params.logoName;

    if (!logoParam) {
      return NextResponse.json(
        { error: "Logo name is required" },
        { status: 400 },
      );
    }

    const normalized = normalizeLogoName(logoParam);
    const photos = await fetchPhotosByLogo(normalized);

    return NextResponse.json({
      logo: normalized,
      photos,
    });
  } catch (error) {
    console.error("Failed to load photos by logo", error);

    return NextResponse.json(
      {
        error: "Unable to load photos for logo",
      },
      { status: 500 },
    );
  }
}
