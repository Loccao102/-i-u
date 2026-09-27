import { NextRequest, NextResponse } from "next/server";
import {
  attachProfileToken,
  createAnonymousProfileToken,
  resolveAnonymousProfile
} from "@/lib/server/profile";
import { errorJson } from "@/lib/server/http";
import { readJsonObject } from "@/lib/server/request-security";
import { resetPersonalProfile } from "@/lib/server/profile-reset";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const profile = resolveAnonymousProfile(request);

  try {
    const body = await readJsonObject(request);
    if (body.confirm !== "XOA") {
      throw new Error("PROFILE_RESET_CONFIRMATION_REQUIRED");
    }

    const result = await resetPersonalProfile(profile.ownerKey);
    const response = NextResponse.json({
      reset: true,
      removedPhotoObjects: result.removedPhotoObjects
    });

    return attachProfileToken(
      response,
      createAnonymousProfileToken()
    );
  } catch (error) {
    return errorJson(
      profile,
      error,
      "Không thể xóa toàn bộ dữ liệu profile."
    );
  }
}
