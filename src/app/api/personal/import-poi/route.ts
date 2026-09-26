import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parsePlace } from "@/lib/server/input";
import { importProviderPlace } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const place = parsePlace(body);

    if (place.source !== "provider" || !place.providerId) {
      return profileJson(
        profile,
        { error: "Nguồn POI không hợp lệ." },
        { status: 400 }
      );
    }

    const result = await importProviderPlace(profile.ownerKey, place);
    return profileJson(profile, result, {
      status: result.duplicate ? 200 : 201
    });
  } catch (error) {
    return errorJson(profile, error, "Không thể nhập địa điểm.");
  }
}
