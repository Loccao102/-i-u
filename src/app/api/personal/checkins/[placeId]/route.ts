import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { addVisit } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ placeId: string }>;
};

export async function POST(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    await readJsonObject(request);
    const { placeId } = await context.params;
    const visit = await addVisit(profile.ownerKey, placeId, null);
    return profileJson(profile, visit, { status: 201 });
  } catch (error) {
    return errorJson(profile, error, "Không thể check-in.");
  }
}
