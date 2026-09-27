import { NextRequest } from "next/server";
import {
  createItineraryShare,
  listOwnedItineraryShares,
  revokeItineraryShare
} from "@/lib/server/itinerary-share";
import { errorJson, profileJson } from "@/lib/server/http";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";
import { parseActivePlanSnapshot } from "@/lib/server/input";
import type { ItineraryShareSource } from "@/lib/types";

export const runtime = "nodejs";

function parseSourceKind(value: unknown): ItineraryShareSource {
  if (
    value === "generated" ||
    value === "active" ||
    value === "completed"
  ) {
    return value;
  }
  throw new Error("INVALID_BODY");
}

function parseSourcePlanId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return value;
  }
  throw new Error("INVALID_BODY");
}

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const shares = await listOwnedItineraryShares(profile.ownerKey);
    return profileJson(profile, { shares });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tải các link itinerary đã chia sẻ."
    );
  }
}

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const share = await createItineraryShare(profile.ownerKey, {
      plan: parseActivePlanSnapshot(body.plan),
      sourceKind: parseSourceKind(body.sourceKind),
      sourcePlanId: parseSourcePlanId(body.sourcePlanId)
    });

    return profileJson(profile, { share });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể tạo link chia sẻ itinerary."
    );
  }
}

export async function DELETE(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const slug = typeof body.slug === "string" ? body.slug : "";
    await revokeItineraryShare(profile.ownerKey, slug);
    return profileJson(profile, { revoked: true });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể thu hồi link chia sẻ."
    );
  }
}
