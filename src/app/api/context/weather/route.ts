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

    const at = request.nextUrl.searchParams.get("at");
    let targetAt: Date | undefined;

    if (at) {
      const parsed = new Date(at);
      const now = Date.now();
      const time = parsed.getTime();

      if (
        !Number.isFinite(time) ||
        time < now - 30 * 60 * 1000 ||
        time > now + 36 * 60 * 60 * 1000
      ) {
        throw new Error("INVALID_BODY");
      }

      targetAt = parsed;
    }

    const weather = await getWeatherContext(
      latitude,
      longitude,
      targetAt
    );
    return profileJson(profile, { weather });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tải thời tiết lúc này."
    );
  }
}
