import "server-only";

import { getSupabaseAdmin } from "./supabase";

const PHOTO_BUCKET = "place-user-photos";
const REMOVE_BATCH_SIZE = 100;

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

export async function resetPersonalProfile(ownerKey: string) {
  const client = getSupabaseAdmin();

  const photos = await client
    .from("place_user_photos")
    .select("storage_path")
    .eq("owner_key", ownerKey);

  dbError(photos.error, "List profile photo objects");

  const paths = Array.from(
    new Set(
      (photos.data ?? [])
        .map((row) => String(row.storage_path))
        .filter(Boolean)
    )
  );

  for (let index = 0; index < paths.length; index += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(index, index + REMOVE_BATCH_SIZE);
    const removed = await client.storage
      .from(PHOTO_BUCKET)
      .remove(batch);

    if (removed.error) {
      throw new Error(
        "Delete profile photo objects: " + removed.error.message
      );
    }
  }

  const reset = await client.rpc("delete_personal_profile", {
    p_owner_key: ownerKey
  });
  dbError(reset.error, "Delete personal profile");

  return {
    removedPhotoObjects: paths.length
  };
}
