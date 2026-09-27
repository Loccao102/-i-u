import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { listUserPlaceCovers } from "@/lib/server/place-photo-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const raw = request.nextUrl.searchParams.get("ids") ?? "";
    const ids = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);

    const covers = await listUserPlaceCovers(profile.ownerKey, ids);
    return profileJson(profile, { covers });
  } catch (error) {
    return errorJson(profile, error, "Không thể tải ảnh cover địa điểm.");
  }
}
