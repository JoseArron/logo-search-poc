import { NextResponse } from "next/server";

import { fetchAllLogos } from "@/app/repositories/logo-index";

export async function GET() {
  try {
    const logos = await fetchAllLogos();

    return NextResponse.json({ logos });
  } catch (error) {
    console.error("Failed to load logos", error);

    return NextResponse.json(
      {
        error: "Unable to load logos",
      },
      { status: 500 },
    );
  }
}
