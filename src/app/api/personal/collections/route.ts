import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parseCollection } from "@/lib/server/input";
import {
  createCollection,
  getPersonalSnapshot
} from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  return profileJson(
    profile,
    { collections: await getPersonalSnapshot(profile.ownerKey).collections }
  );
}

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  try {
    const body = await readJsonObject(request);
    const input = parseCollection(body);
    const item = await createCollection(
      profile.ownerKey,
      input.name,
      input.description
    );
    return profileJson(profile, item, { status: 201 });
  } catch (error) {
    return errorJson(profile, error, "Không thể tạo bộ sưu tập.");
  }
}
