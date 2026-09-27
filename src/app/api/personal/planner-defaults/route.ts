import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";
import { savePlannerDefaults } from "@/lib/server/personal-repository";
import type { PlannerDefaults, RoutingMode } from "@/lib/types";

export const runtime = "nodejs";

function parseRouteMode(value: unknown): RoutingMode {
  if (value === "motorcycle" || value === "drive" || value === "walk") {
    return value;
  }
  throw new Error("INVALID_BODY");
}

function parseBudget(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 100_000 || number > 10_000_000) {
    throw new Error("INVALID_BODY");
  }
  return number;
}

function parseDistance(value: unknown): 3 | 5 | 8 | 12 {
  const number = Number(value);
  if (number === 3 || number === 5 || number === 8 || number === 12) {
    return number;
  }
  throw new Error("INVALID_BODY");
}

function parseDuration(value: unknown): 2 | 3 | 4 {
  const number = Number(value);
  if (number === 2 || number === 3 || number === 4) {
    return number;
  }
  throw new Error("INVALID_BODY");
}

export async function PUT(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const input: Omit<PlannerDefaults, "updatedAt"> = {
      routeMode: parseRouteMode(body.routeMode),
      budgetForTwo: parseBudget(body.budgetForTwo),
      maxDistanceKm: parseDistance(body.maxDistanceKm),
      durationHours: parseDuration(body.durationHours)
    };

    const plannerDefaults = await savePlannerDefaults(
      profile.ownerKey,
      input
    );

    return profileJson(profile, { plannerDefaults });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể lưu thiết lập mặc định của planner."
    );
  }
}
