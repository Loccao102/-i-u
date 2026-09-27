import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parsePlannerDefaults } from "@/lib/server/input";
import { upsertPlannerDefaults } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const defaults = parsePlannerDefaults(body);
    const saved = await upsertPlannerDefaults(
      profile.ownerKey,
      defaults
    );

    return profileJson(profile, saved);
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể lưu mặc định planner."
    );
  }
}
