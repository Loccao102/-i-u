import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { addVisitIfNew } from "@/lib/server/personal-repository";
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
    const result = await addVisitIfNew(
      profile.ownerKey,
      placeId,
      null
    );
    return profileJson(profile, result, {
      status: result.created ? 201 : 200
    });
  } catch (error) {
    return errorJson(profile, error, "Không thể check-in.");
  }
}
