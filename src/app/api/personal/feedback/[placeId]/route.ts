import { NextRequest } from "next/server";
import {
  deleteRecommendationFeedback,
  saveRecommendationFeedback
} from "@/lib/server/personal-repository";
import { parseRecommendationFeedback } from "@/lib/server/input";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import {
  assertSameOriginMutation,
  readJsonObject
} from "@/lib/server/request-security";

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
    const feedback = parseRecommendationFeedback(placeId, body);
    const saved = await saveRecommendationFeedback(
      profile.ownerKey,
      feedback
    );

    return profileJson(profile, saved);
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể lưu phản hồi gợi ý."
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);

  try {
    assertSameOriginMutation(request);
    const { placeId } = await context.params;
    await deleteRecommendationFeedback(profile.ownerKey, placeId);
    return profileJson(profile, { deleted: true });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể xóa phản hồi gợi ý."
    );
  }
}
