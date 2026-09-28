import { NextRequest } from "next/server";
import {
  castGroupPollVote,
  getGroupPoll
} from "@/lib/server/group-poll";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const profile = resolveAnonymousProfile(request);

  try {
    const { slug } = await context.params;
    const poll = await getGroupPoll(slug, profile.ownerKey);

    if (!poll) {
      return profileJson(
        profile,
        { error: "Phiên bình chọn không tồn tại hoặc link không hợp lệ." },
        { status: 404 }
      );
    }

    return profileJson(profile, { poll });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tải phiên bình chọn."
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const { slug } = await context.params;
    const poll = await castGroupPollVote(
      slug,
      profile.ownerKey,
      body.placeId
    );

    return profileJson(profile, { poll });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể ghi nhận lựa chọn."
    );
  }
}
