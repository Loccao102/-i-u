import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parseRating } from "@/lib/server/input";
import {
  addVisit,
  saveRating
} from "@/lib/server/personal-repository";
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
    const rating = parseRating(placeId, body);
    await saveRating(profile.ownerKey, rating);

    if (body.recordVisit === true) {
      await addVisit(
        profile.ownerKey,
        placeId,
        rating.stars,
        rating.visitedAt
      );
    }

    return profileJson(profile, rating);
  } catch (error) {
    return errorJson(profile, error, "Không thể lưu đánh giá.");
  }
}
