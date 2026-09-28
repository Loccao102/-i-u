import { NextRequest } from "next/server";
import { createGroupPoll } from "@/lib/server/group-poll";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";
import type { Place } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const candidates = Array.isArray(body.candidates)
      ? (body.candidates as Place[])
      : [];

    const poll = await createGroupPoll(profile.ownerKey, {
      title: typeof body.title === "string" ? body.title : undefined,
      candidates
    });

    return profileJson(profile, { poll }, { status: 201 });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tạo phiên bình chọn nhóm."
    );
  }
}
