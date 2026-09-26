import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parseBoolean } from "@/lib/server/input";
import { setCollectionPlace } from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { readJsonObject } from "@/lib/server/request-security";

export const runtime = "nodejs";

type Context = {
  params: Promise<{
    collectionId: string;
    placeId: string;
  }>;
};

export async function PUT(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    const { collectionId, placeId } = await context.params;
    const body = await readJsonObject(request);
    const included = parseBoolean(body.included);
    const ok = setCollectionPlace(
      profile.ownerKey,
      collectionId,
      placeId,
      included
    );
    if (!ok) {
      return profileJson(
        profile,
        { error: "Bộ sưu tập không tồn tại." },
        { status: 404 }
      );
    }
    return profileJson(profile, { included });
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể cập nhật bộ sưu tập."
    );
  }
}
