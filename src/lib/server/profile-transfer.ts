import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
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

function transferKey(code: string) {
  return createHash("sha256").update(code).digest();
}

function encryptProfileToken(token: string, code: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", transferKey(code), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptProfileToken(payload: string, code: string) {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("TRANSFER_CODE_EXPIRED");

  try {
    const iv = Buffer.from(parts[0]!, "base64url");
    const tag = Buffer.from(parts[1]!, "base64url");
    const encrypted = Buffer.from(parts[2]!, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      transferKey(code),
      iv
    );
    decipher.setAuthTag(tag);

    const token = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString("utf8");

    if (!/^[a-f0-9]{64}$/.test(token)) {
      throw new Error("TRANSFER_CODE_EXPIRED");
    }

    return token;
  } catch {
    throw new Error("TRANSFER_CODE_EXPIRED");
  }
}

export async function createProfileTransferCode(input: {
  ownerKey: string;
  profileToken: string;
}) {
  const client = getSupabaseAdmin();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  const expired = await client
    .from("profile_transfer_codes")
    .delete()
    .lt("expires_at", now.toISOString());
  dbError(expired.error, "Cleanup expired profile transfer codes");

  const previous = await client
    .from("profile_transfer_codes")
    .delete()
    .eq("owner_key", input.ownerKey);
  dbError(previous.error, "Replace profile transfer code");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = rawCode();
    const { error } = await client
      .from("profile_transfer_codes")
      .insert({
        code_hash: codeHash(code),
        owner_key: input.ownerKey,
        token_ciphertext: encryptProfileToken(input.profileToken, code),
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString()
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
    .delete()
    .eq("code_hash", codeHash(code))
    .gt("expires_at", now)
    .select("token_ciphertext")
    .maybeSingle();

  dbError(error, "Redeem profile transfer code");

  const payload = data?.token_ciphertext;
  if (typeof payload !== "string" || !payload) {
    throw new Error("TRANSFER_CODE_EXPIRED");
  }

  return decryptProfileToken(payload, code);
}
