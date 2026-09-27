import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { discoverPoi } from "@/lib/server/poi-provider";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import type {
  PoiDiscoveryAmenity,
  PoiDiscoveryCategory
} from "@/lib/types";

export const runtime = "nodejs";

function coordinate(
  value: string | null,
  min: number,
  max: number
) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error("INVALID_BODY");
  }
  return number;
}

function discoveryCategory(value: string | null): PoiDiscoveryCategory {
  if (
    value === "food" ||
    value === "cafe" ||
    value === "drink" ||
    value === "activity"
  ) {
    return value;
  }
  return "all";
}

function discoveryAmenity(value: string | null): PoiDiscoveryAmenity {
  if (value === "wifi" || value === "wheelchair") {
    return value;
  }
  return "any";
}

function radiusKm(value: string | null): 0 | 1 | 3 | 5 | 10 {
  const parsed = Number(value ?? 0);
  if (
    parsed === 1 ||
    parsed === 3 ||
    parsed === 5 ||
    parsed === 10
  ) {
    return parsed;
  }
  return 0;
}


function discoveryOffset(value: string | null) {
  const parsed = Number(value ?? 0);
  if (
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > 80 ||
    parsed % 20 !== 0
  ) {
    throw new Error("INVALID_BODY");
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const bounds = {
      west: coordinate(
        request.nextUrl.searchParams.get("west"),
        -180,
        180
      ),
      south: coordinate(
        request.nextUrl.searchParams.get("south"),
        -90,
        90
      ),
      east: coordinate(
        request.nextUrl.searchParams.get("east"),
        -180,
        180
      ),
      north: coordinate(
        request.nextUrl.searchParams.get("north"),
        -90,
        90
      )
    };

    const category = discoveryCategory(
      request.nextUrl.searchParams.get("category")
    );
    const amenity = discoveryAmenity(
      request.nextUrl.searchParams.get("amenity")
    );
    const radius = radiusKm(
      request.nextUrl.searchParams.get("radiusKm")
    );
    const offset = discoveryOffset(
      request.nextUrl.searchParams.get("offset")
    );

    const page = await discoverPoi({
      bounds,
      category,
      amenity,
      radiusKm: radius,
      offset
    });

    return profileJson(profile, page);
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể khám phá địa điểm thật trong khu vực này."
    );
  }
}
