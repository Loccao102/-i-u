import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import type { PlaceUserPhoto } from "../types";

const BUCKET = "place-user-photos";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif"
]);

type PhotoRow = {
  id: string;
  place_id: string;
  storage_path: string;
  caption: string;
  created_at: string;
};

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function ownerFolder(ownerKey: string) {
  return createHash("sha256").update(ownerKey).digest("hex").slice(0, 24);
}

function extensionFor(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/avif") return "avif";
  return "jpg";
}

async function ensureBucket() {
  const client = getSupabaseAdmin();
  const existing = await client.storage.getBucket(BUCKET);

  if (!existing.error && existing.data) return;

  const created = await client.storage.createBucket(BUCKET, {
    public: false,
    allowedMimeTypes: Array.from(ALLOWED_TYPES),
    fileSizeLimit: MAX_UPLOAD_BYTES
  });

  if (
    created.error &&
    !/already exists|duplicate/i.test(created.error.message)
  ) {
    throw new Error("Create photo bucket: " + created.error.message);
  }
}

export function validatePhotoUpload(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("UNSUPPORTED_IMAGE_TYPE");
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("IMAGE_TOO_LARGE");
  }
}

export async function listUserPlacePhotos(
  ownerKey: string,
  placeId: string
): Promise<PlaceUserPhoto[]> {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("place_user_photos")
    .select("id,place_id,storage_path,caption,created_at")
    .eq("owner_key", ownerKey)
    .eq("place_id", placeId)
    .order("created_at", { ascending: false })
    .limit(12);

  dbError(error, "List place photos");

  const rows = (data ?? []) as PhotoRow[];
  if (rows.length === 0) return [];

  const signed = await Promise.all(
    rows.map(async (row) => {
      const { data: signedData, error: signedError } = await client.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, 60 * 60);

      if (signedError || !signedData?.signedUrl) return null;

      return {
        id: row.id,
        url: signedData.signedUrl,
        caption: row.caption,
        createdAt: row.created_at
      } satisfies PlaceUserPhoto;
    })
  );

  return signed.filter((item): item is PlaceUserPhoto => item !== null);
}

export async function uploadUserPlacePhoto(input: {
  ownerKey: string;
  placeId: string;
  file: File;
  caption: string;
}): Promise<PlaceUserPhoto> {
  validatePhotoUpload(input.file);
  await ensureBucket();

  const client = getSupabaseAdmin();
  const id = randomUUID();
  const storagePath = [
    ownerFolder(input.ownerKey),
    input.placeId,
    id + "." + extensionFor(input.file.type)
  ].join("/");

  const bytes = await input.file.arrayBuffer();
  const upload = await client.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.file.type,
      cacheControl: "3600",
      upsert: false
    });

  if (upload.error) {
    throw new Error("Upload photo: " + upload.error.message);
  }

  const createdAt = new Date().toISOString();
  const { error } = await client.from("place_user_photos").insert({
    owner_key: input.ownerKey,
    id,
    place_id: input.placeId,
    storage_path: storagePath,
    caption: input.caption,
    created_at: createdAt
  });

  if (error) {
    await client.storage.from(BUCKET).remove([storagePath]);
    dbError(error, "Save photo metadata");
  }

  const signed = await client.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  if (signed.error || !signed.data?.signedUrl) {
    throw new Error("Sign uploaded photo URL");
  }

  return {
    id,
    url: signed.data.signedUrl,
    caption: input.caption,
    createdAt
  };
}

export async function deleteUserPlacePhoto(
  ownerKey: string,
  photoId: string
) {
  const client = getSupabaseAdmin();

  const { data, error } = await client
    .from("place_user_photos")
    .select("id,storage_path")
    .eq("owner_key", ownerKey)
    .eq("id", photoId)
    .maybeSingle();

  dbError(error, "Find place photo");
  if (!data) return false;

  const removed = await client.storage
    .from(BUCKET)
    .remove([String(data.storage_path)]);

  if (removed.error) {
    throw new Error("Delete photo object: " + removed.error.message);
  }

  const deleted = await client
    .from("place_user_photos")
    .delete()
    .eq("owner_key", ownerKey)
    .eq("id", photoId);

  dbError(deleted.error, "Delete photo metadata");
  return true;
}

export async function deleteAllUserPlacePhotos(
  ownerKey: string,
  placeId: string
) {
  const client = getSupabaseAdmin();
  const { data, error } = await client
    .from("place_user_photos")
    .select("storage_path")
    .eq("owner_key", ownerKey)
    .eq("place_id", placeId);

  dbError(error, "List photos for delete");

  const paths = (data ?? []).map((row) => String(row.storage_path));
  if (paths.length === 0) return;

  const removed = await client.storage.from(BUCKET).remove(paths);
  if (removed.error) {
    throw new Error("Delete photo objects: " + removed.error.message);
  }
}
