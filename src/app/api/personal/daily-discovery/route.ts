import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";
import { upsertDailyDiscovery } from "@/lib/server/personal-repository";
import { cleanPlainText } from "@/lib/validation";
import type {
  DailyDiscoveryKind,
  Scenario
} from "@/lib/types";

export const runtime = "nodejs";

const scenarios = new Set<Scenario>([
  "date",
  "friends",
  "food",
  "coffee",
  "fun",
  "chill"
]);

function parseDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("INVALID_BODY");
  }

  const parsed = new Date(value + "T00:00:00Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("INVALID_BODY");
  }

  return value;
}

function parseKind(value: unknown): DailyDiscoveryKind {
  if (value === "place" || value === "route") return value;
  throw new Error("INVALID_BODY");
}

function parsePlaceKeys(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error("INVALID_BODY");
  }

  const keys = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanPlainText(item, 180))
        .filter(Boolean)
    )
  );

  if (keys.length < 1 || keys.length > 3) {
    throw new Error("INVALID_BODY");
  }

  return keys;
}

function parseScenario(value: unknown): Scenario | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && scenarios.has(value as Scenario)) {
    return value as Scenario;
  }
  throw new Error("INVALID_BODY");
}

export async function PUT(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const record = await upsertDailyDiscovery(profile.ownerKey, {
      day: parseDay(body.day),
      kind: parseKind(body.kind),
      placeKeys: parsePlaceKeys(body.placeKeys),
      scenario: parseScenario(body.scenario)
    });

    return profileJson(profile, record);
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể lưu lịch sử khám phá hôm nay."
    );
  }
}
