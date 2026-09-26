import { NextRequest } from "next/server";
import { getPersonalSnapshot } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { profileJson } from "@/lib/server/http";
import type { PersonalBackup } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);
  const snapshot = await getPersonalSnapshot(profile.ownerKey);

  const backup: PersonalBackup = {
    format: "di-dau-personal-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: snapshot
  };

  return profileJson(profile, backup, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=\"di-dau-backup.json\""
    }
  });
}
