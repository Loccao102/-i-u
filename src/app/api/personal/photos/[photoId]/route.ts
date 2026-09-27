import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { deleteUserPlacePhoto } from "@/lib/server/place-photo-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { assertSameOriginMutation } from "@/lib/server/request-security";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ photoId: string }>;
};

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);

  try {
    assertSameOriginMutation(request);
    const { photoId } = await context.params;
    const deleted = await deleteUserPlacePhoto(
      profile.ownerKey,
      photoId
    );

    if (!deleted) {
      return profileJson(
        profile,
        { error: "Ảnh không tồn tại." },
        { status: 404 }
      );
    }

    return profileJson(profile, { deleted: true });
  } catch (error) {
    return errorJson(profile, error, "Không thể xóa ảnh.");
  }
}
