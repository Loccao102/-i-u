import { NextRequest } from "next/server";
import { getPersonalSnapshot } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import {
  internalErrorJson,
  profileJson
} from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const snapshot = await getPersonalSnapshot(profile.ownerKey);
    return profileJson(profile, snapshot);
  } catch (error) {
    return internalErrorJson(
      profile,
      error,
      "Không thể tải dữ liệu cá nhân."
    );
  }
}
