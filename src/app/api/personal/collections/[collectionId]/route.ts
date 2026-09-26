import { NextRequest } from "next/server";
import { errorJson, profileJson } from "@/lib/server/http";
import { parseCollection } from "@/lib/server/input";
import {
  deleteCollection,
  updateCollection
} from "@/lib/server/personal-repository";
import { resolveAnonymousProfile } from "@/lib/server/profile";
import {
  assertSameOriginMutation,
  readJsonObject
} from "@/lib/server/request-security";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ collectionId: string }>;
};

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    const { collectionId } = await context.params;
    const body = await readJsonObject(request);
    const input = parseCollection(body);
    const updated = updateCollection(
      profile.ownerKey,
      collectionId,
      input.name,
      input.description
    );
    if (!updated) {
      return profileJson(
        profile,
        { error: "Bộ sưu tập không tồn tại." },
        { status: 404 }
      );
    }
    return profileJson(profile, { updated: true });
  } catch (error) {
    return errorJson(profile, error, "Không thể sửa bộ sưu tập.");
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  const profile = resolveAnonymousProfile(request);
  try {
    assertSameOriginMutation(request);
    const { collectionId } = await context.params;
    const deleted = deleteCollection(
      profile.ownerKey,
      collectionId
    );
    if (!deleted) {
      return profileJson(
        profile,
        { error: "Bộ sưu tập không tồn tại." },
        { status: 404 }
      );
    }
    return profileJson(profile, { deleted: true });
  } catch (error) {
    return errorJson(profile, error, "Không thể xóa bộ sưu tập.");
  }
}
