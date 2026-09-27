import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";
import {
  getRoadRouteMatrix,
  isRoutingConfigured
} from "@/lib/server/routing-provider";
import { cleanPlainText } from "@/lib/validation";
import type {
  RoutingMatrixPoint,
  RoutingMode
} from "@/lib/types";

export const runtime = "nodejs";

function coordinate(
  value: unknown,
  min: number,
  max: number
) {
  const number =
    typeof value === "number" ? value : Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max
  ) {
    throw new Error("INVALID_BODY");
  }
  return number;
}

function parseRoutingMode(value: unknown): RoutingMode {
  if (
    value === "motorcycle" ||
    value === "drive" ||
    value === "walk"
  ) {
    return value;
  }

  return "motorcycle";
}

function parsePoints(value: unknown): RoutingMatrixPoint[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 7) {
    throw new Error("INVALID_BODY");
  }

  const seen = new Set<string>();
  const points = value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("INVALID_BODY");
    }

    const row = item as Record<string, unknown>;
    const key = cleanPlainText(
      typeof row.key === "string" ? row.key : "",
      180
    );

    if (!key || seen.has(key)) {
      throw new Error("INVALID_BODY");
    }
    seen.add(key);

    return {
      key,
      latitude: coordinate(row.latitude, -90, 90),
      longitude: coordinate(row.longitude, -180, 180)
    };
  });

  return points;
}

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const points = parsePoints(body.points);
    const mode = parseRoutingMode(body.mode);

    if (!isRoutingConfigured()) {
      return profileJson(profile, {
        matrix: null,
        provider: null,
        mode,
        configured: false
      });
    }

    const result = await getRoadRouteMatrix(points, mode);

    return profileJson(profile, result, {
      headers: {
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tính thời gian di chuyển theo đường thực tế."
    );
  }
}
