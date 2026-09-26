import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parsePersonalBackup } from "@/lib/server/input";
import { mergePersonalBackup } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    const snapshot = parsePersonalBackup(body);
    const result = await mergePersonalBackup(profile.ownerKey, snapshot);

    return profileJson(profile, {
      ...result,
      mode: "merge"
    });
  } catch (error) {
    return errorJson(profile, error, "Không thể nhập bản sao lưu.");
  }
}
