import { NextRequest } from "next/server";
import { profileJson, errorJson } from "@/lib/server/http";
import { parsePlace } from "@/lib/server/input";
import {
  deletePlace,
  upsertPlace
} from "@/lib/server/personal-repository";
import { deleteAllUserPlacePhotos } from "@/lib/server/place-photo-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import {
  assertSameOriginMutation,
  readJsonObject
} from "@/lib/server/request-security";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ placeId: string }>;
};

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    const { placeId } = await context.params;
    const body = await readJsonObject(request);
    const place = parsePlace(body, placeId);
    await upsertPlace(profile.ownerKey, place);
    return profileJson(profile, place);
  } catch (error) {
    return errorJson(profile, error, "Không thể sửa địa điểm.");
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    assertSameOriginMutation(request);
    const { placeId } = await context.params;
    await deleteAllUserPlacePhotos(profile.ownerKey, placeId);
    const deleted = await deletePlace(profile.ownerKey, placeId);
    if (!deleted) {
      return profileJson(
        profile,
        { error: "Địa điểm cá nhân không tồn tại." },
        { status: 404 }
      );
    }
    return profileJson(profile, { deleted: true });
  } catch (error) {
    return errorJson(profile, error, "Không thể xóa địa điểm.");
  }
}
