import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

declare global {
  // eslint-disable-next-line no-var
  var __diDauSupabaseAdmin: SupabaseClient<Database> | undefined;
}

export type SupabaseServerKeyKind =
  | "modern-secret"
  | "legacy-service-role";

function requiredUrl() {
  const value = process.env.SUPABASE_URL?.trim();
  if (!value) {
    throw new Error("Missing required server env: SUPABASE_URL");
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("Invalid server env: SUPABASE_URL");
  }

  return value;
}

function jwtRole(value: string) {
  if (!value.startsWith("eyJ")) return null;

  try {
    const payload = value.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded =
      normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8")
    ) as { role?: unknown };

    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function classifyServerKey(value: string): SupabaseServerKeyKind {
  if (value.startsWith("sb_secret_")) {
    return "modern-secret";
  }

  if (value.startsWith("sb_publishable_")) {
    throw new Error("Invalid server env: publishable Supabase key");
  }

  const role = jwtRole(value);
  if (role === "service_role") {
    return "legacy-service-role";
  }

  if (role === "anon" || role === "authenticated") {
    throw new Error("Invalid server env: non-service Supabase JWT");
  }

  throw new Error("Invalid server env: unsupported Supabase server key");
}

function requiredSecretKey() {
  const modern = process.env.SUPABASE_SECRET_KEY?.trim();
  if (modern) {
    classifyServerKey(modern);
    return modern;
  }

  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy) {
    classifyServerKey(legacy);
    return legacy;
  }

  throw new Error(
    "Missing required server env: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"
  );
}

export function getSupabaseServerKeyKind(): SupabaseServerKeyKind {
  const modern = process.env.SUPABASE_SECRET_KEY?.trim();
  if (modern) return classifyServerKey(modern);

  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy) return classifyServerKey(legacy);

  throw new Error(
    "Missing required server env: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"
  );
}

export function getSupabaseAdmin() {
  globalThis.__diDauSupabaseAdmin ??= createClient<Database>(
    requiredUrl(),
    requiredSecretKey(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          "X-Client-Info": "di-dau-server"
        }
      }
    }
  );

  return globalThis.__diDauSupabaseAdmin;
}
