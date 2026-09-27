import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { getPlaceMedia } from "@/lib/server/place-media-service";
import { getPersonalPlace } from "@/lib/server/personal-repository";
import { uploadUserPlacePhoto } from "@/lib/server/place-photo-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import { assertSameOriginRequest } from "@/lib/server/request-security";
import { cleanPlainText } from "@/lib/validation";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ placeId: string }>;
};

export async function GET(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);

  try {
    const { placeId } = await context.params;
    const media = await getPlaceMedia(profile.ownerKey, placeId);

    if (!media) {
      return profileJson(
        profile,
        { error: "Địa điểm cá nhân không tồn tại." },
        { status: 404 }
      );
    }

    return profileJson(profile, media, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return errorJson(profile, error, "Không thể tải ảnh địa điểm.");
  }
}

export async function POST(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);

  try {
    assertSameOriginRequest(request);
    const { placeId } = await context.params;

    const place = await getPersonalPlace(profile.ownerKey, placeId);
    if (!place) {
      return profileJson(
        profile,
        { error: "Địa điểm cá nhân không tồn tại." },
        { status: 404 }
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("INVALID_BODY");
    }

    const caption = cleanPlainText(
      typeof form.get("caption") === "string"
        ? String(form.get("caption"))
        : "",
      180
    );

    const photo = await uploadUserPlacePhoto({
      ownerKey: profile.ownerKey,
      placeId,
      file,
      caption
    });

    return profileJson(profile, photo, { status: 201 });
  } catch (error) {
    return errorJson(profile, error, "Không thể tải ảnh lên.");
  }
}
