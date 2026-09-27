import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

declare global {
  // eslint-disable-next-line no-var
  var __diDauSupabaseAdmin: SupabaseClient<Database> | undefined;
}

function requiredUrl() {
  const value = process.env.SUPABASE_URL?.trim();
  if (!value) {
    throw new Error("Missing required server env: SUPABASE_URL");
  }
  return value;
}

function requiredSecretKey() {
  const modern = process.env.SUPABASE_SECRET_KEY?.trim();
  if (modern) return modern;

  // Backward-compatible Vercel deployments may still use the legacy name.
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (legacy) return legacy;

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
