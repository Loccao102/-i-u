import { NextRequest } from "next/server";
import {
  errorJson,
  internalErrorJson,
  profileJson
} from "@/lib/server/http";
import { parseActivePlanSnapshot } from "@/lib/server/input";
import {
  advanceActivePlan,
  cancelActivePlan,
  getActivePlan,
  startActivePlan
} from "@/lib/server/active-plan-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { recordPlannerMetric } from "@/lib/server/planner-metrics";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const activePlan = await getActivePlan(profile.ownerKey);
    return profileJson(profile, { activePlan });
  } catch (error) {
    return internalErrorJson(
      profile,
      error,
      "Không thể tải kế hoạch đang đi."
    );
  }
}

export async function PUT(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const plan = parseActivePlanSnapshot(body.plan);
    const replayed = body.replayed === true;
    const activePlan = await startActivePlan(profile.ownerKey, plan);

    await Promise.allSettled([
      recordPlannerMetric(profile.ownerKey, "started"),
      ...(replayed
        ? [recordPlannerMetric(profile.ownerKey, "replayed")]
        : [])
    ]);

    return profileJson(profile, { activePlan });
  } catch (error) {
    return errorJson(profile, error, "Không thể bắt đầu kế hoạch.");
  }
}

export async function PATCH(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const action =
      body.action === "complete" || body.action === "skip"
        ? body.action
        : null;
    const expectedIndex = Number(body.expectedIndex);

    if (
      !action ||
      !Number.isInteger(expectedIndex) ||
      expectedIndex < 0 ||
      expectedIndex > 2
    ) {
      throw new Error("INVALID_BODY");
    }

    const result = await advanceActivePlan(
      profile.ownerKey,
      action,
      expectedIndex
    );

    if (result.finished) {
      await Promise.allSettled([
        recordPlannerMetric(profile.ownerKey, "completed")
      ]);
    }

    return profileJson(profile, result);
  } catch (error) {
    return errorJson(profile, error, "Không thể cập nhật kế hoạch.");
  }
}

export async function DELETE(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const activePlan = await getActivePlan(profile.ownerKey);
    await cancelActivePlan(profile.ownerKey);
    if (activePlan) {
      await Promise.allSettled([
        recordPlannerMetric(profile.ownerKey, "canceled")
      ]);
    }
    return profileJson(profile, { canceled: true });
  } catch (error) {
    return errorJson(profile, error, "Không thể hủy kế hoạch.");
  }
}
