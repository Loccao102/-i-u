import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

declare global {
  // eslint-disable-next-line no-var
  var __diDauSupabaseAdmin: SupabaseClient<Database> | undefined;
}

function required(name: "SUPABASE_URL" | "SUPABASE_SECRET_KEY") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required server env: ${name}`);
  }
  return value;
}

export function getSupabaseAdmin() {
  globalThis.__diDauSupabaseAdmin ??= createClient<Database>(
    required("SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
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
