import { NextRequest } from "next/server";
import { profileJson, errorJson } from "@/lib/server/http";
import { parsePlace } from "@/lib/server/input";
import { upsertPlace } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  try {
    const body = await readJsonObject(request);
    const place = parsePlace(body);
    await upsertPlace(profile.ownerKey, place);
    return profileJson(profile, place, { status: 201 });
  } catch (error) {
    return errorJson(profile, error, "Không thể thêm địa điểm.");
  }
}
