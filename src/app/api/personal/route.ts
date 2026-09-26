import { NextRequest } from "next/server";
import { getPersonalSnapshot } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { profileJson } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  return profileJson(profile, await getPersonalSnapshot(profile.ownerKey));
}
