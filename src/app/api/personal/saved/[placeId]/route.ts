import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parseBoolean } from "@/lib/server/input";
import { setSaved } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ placeId: string }>;
};

export async function PUT(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    const { placeId } = await context.params;
    const body = await readJsonObject(request);
    const saved = parseBoolean(body.saved);
    setSaved(profile.ownerKey, placeId, saved);
    return profileJson(profile, { saved });
  } catch (error) {
    return errorJson(profile, error, "Không thể cập nhật Saved.");
  }
}
