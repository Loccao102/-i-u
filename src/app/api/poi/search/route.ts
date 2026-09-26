import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { searchPoi } from "@/lib/server/poi-provider";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { cleanPlainText } from "@/lib/validation";

export const runtime = "nodejs";

function optionalCoordinate(
  value: string | null,
  min: number,
  max: number
) {
  if (value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : undefined;
}

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const query = cleanPlainText(
      request.nextUrl.searchParams.get("q") ?? "",
      120
    );
    if (query.length < 2) {
      return profileJson(profile, { results: [] });
    }

    const latitude = optionalCoordinate(
      request.nextUrl.searchParams.get("lat"),
      -90,
      90
    );
    const longitude = optionalCoordinate(
      request.nextUrl.searchParams.get("lon"),
      -180,
      180
    );

    const west = optionalCoordinate(
      request.nextUrl.searchParams.get("west"),
      -180,
      180
    );
    const south = optionalCoordinate(
      request.nextUrl.searchParams.get("south"),
      -90,
      90
    );
    const east = optionalCoordinate(
      request.nextUrl.searchParams.get("east"),
      -180,
      180
    );
    const north = optionalCoordinate(
      request.nextUrl.searchParams.get("north"),
      -90,
      90
    );

    const bounds =
      west !== undefined &&
      south !== undefined &&
      east !== undefined &&
      north !== undefined &&
      south < north
        ? { west, south, east, north }
        : undefined;

    const results = await searchPoi({
      query,
      latitude,
      longitude,
      bounds
    });

    return profileJson(profile, { results });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tìm địa điểm lúc này."
    );
  }
}
