import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";
import { saveCompletedPlanFeedback } from "@/lib/server/personal-repository";
import { cleanPlainText } from "@/lib/validation";

export const runtime = "nodejs";

function planId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new Error("INVALID_BODY");
  }
  return value;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const profile = resolveAnonymousProfile(request);

  try {
    const params = await context.params;
    const id = planId(params.planId);
    const body = await readJsonObject(request);
    const rating = Number(body.outcomeRating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error("INVALID_BODY");
    }

    const wouldRepeat =
      body.wouldRepeat === true || body.wouldRepeat === false
        ? body.wouldRepeat
        : null;

    const feedbackNote = cleanPlainText(
      typeof body.feedbackNote === "string" ? body.feedbackNote : "",
      300
    );

    const completedPlan = await saveCompletedPlanFeedback(
      profile.ownerKey,
      id,
      {
        outcomeRating: rating,
        wouldRepeat,
        feedbackNote
      }
    );

    return profileJson(profile, { completedPlan });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể lưu đánh giá buổi đi."
    );
  }
}
