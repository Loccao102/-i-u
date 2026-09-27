import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { discoverPoi } from "@/lib/server/poi-provider";
import { resolveAnonymousProfile } from "@/lib/server/profile";

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

    const results = await discoverPoi({ bounds });
    return profileJson(profile, { results });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể khám phá địa điểm thật trong khu vực này."
    );
  }
}
