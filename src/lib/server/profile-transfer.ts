import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_TTL_MS = 10 * 60 * 1000;

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function rawCode() {
  const bytes = randomBytes(12);
  let result = "";
  for (const byte of bytes) {
    result += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return result;
}

export function formatTransferCode(value: string) {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

  return normalized.match(/.{1,4}/g)?.join("-") ?? normalized;
}

export function normalizeTransferCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function codeHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createProfileTransferCode(input: {
  ownerKey: string;
  profileToken: string;
}) {
  const client = getSupabaseAdmin();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  await client
    .from("profile_transfer_codes")
    .delete()
    .eq("owner_key", input.ownerKey)
    .is("used_at", null);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = rawCode();
    const { error } = await client
      .from("profile_transfer_codes")
      .insert({
        code_hash: codeHash(code),
        owner_key: input.ownerKey,
        profile_token: input.profileToken,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        used_at: null
      });

    if (!error) {
      return {
        code: formatTransferCode(code),
        expiresAt: expiresAt.toISOString()
      };
    }

    if (!/duplicate|unique/i.test(error.message ?? "")) {
      dbError(error, "Create profile transfer code");
    }
  }

  throw new Error("PROFILE_TRANSFER_UNAVAILABLE");
}

export async function redeemProfileTransferCode(codeInput: string) {
  const code = normalizeTransferCode(codeInput);
  if (!/^[A-Z2-9]{12}$/.test(code)) {
    throw new Error("INVALID_TRANSFER_CODE");
  }

  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("profile_transfer_codes")
    .update({ used_at: now })
    .eq("code_hash", codeHash(code))
    .is("used_at", null)
    .gt("expires_at", now)
    .select("profile_token")
    .maybeSingle();

  dbError(error, "Redeem profile transfer code");

  const token = data?.profile_token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("TRANSFER_CODE_EXPIRED");
  }

  return token;
}
