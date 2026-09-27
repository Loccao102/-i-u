import { NextRequest } from "next/server";
import {
  getPlannerMetrics,
  recordPlannerMetric
} from "@/lib/server/planner-metrics";
import {
  errorJson,
  internalErrorJson,
  profileJson
} from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const metrics = await getPlannerMetrics(profile.ownerKey);
    return profileJson(profile, { metrics });
  } catch (error) {
    return internalErrorJson(
      profile,
      error,
      "Không thể tải thống kê planner."
    );
  }
}

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    if (body.metric !== "generated") {
      throw new Error("INVALID_BODY");
    }

    await recordPlannerMetric(profile.ownerKey, "generated");
    const metrics = await getPlannerMetrics(profile.ownerKey);
    return profileJson(profile, { metrics });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể ghi thống kê planner."
    );
  }
}
