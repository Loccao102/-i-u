import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { listNearbyPersonalPlaceDistances } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";

export const runtime = "nodejs";

function coordinate(value: string | null, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error("INVALID_BODY");
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const latitude = coordinate(
      request.nextUrl.searchParams.get("lat"),
      -90,
      90
    );
    const longitude = coordinate(
      request.nextUrl.searchParams.get("lon"),
      -180,
      180
    );
    const requestedLimit = Number(
      request.nextUrl.searchParams.get("limit") ?? 100
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.round(requestedLimit), 500))
      : 100;

    const results = await listNearbyPersonalPlaceDistances(
      profile.ownerKey,
      latitude,
      longitude,
      limit
    );

    return profileJson(profile, { results });
  } catch (error) {
    return errorJson(profile, error, "Không thể tìm địa điểm gần bạn.");
  }
}
