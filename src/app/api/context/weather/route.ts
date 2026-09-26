import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { getWeatherContext } from "@/lib/server/weather-provider";

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

    const weather = await getWeatherContext(latitude, longitude);
    return profileJson(profile, { weather });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tải thời tiết lúc này."
    );
  }
}
