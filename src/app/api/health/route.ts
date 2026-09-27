import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/server/supabase";

export const runtime = "nodejs";

function classify(error: unknown) {
  const raw =
    error instanceof Error ? error.message : String(error ?? "UNKNOWN_ERROR");

  if (raw.startsWith("Missing required server env:")) {
    return {
      status: 503,
      code: "SERVER_CONFIG_MISSING",
      message: "Supabase environment variables are missing."
    };
  }

  if (
    /google_place_id|personal_places/i.test(raw) &&
    /column|relation|schema|does not exist|cache/i.test(raw)
  ) {
    return {
      status: 503,
      code: "DATABASE_SCHEMA_MISMATCH",
      message: "Supabase schema is behind the deployed app."
    };
  }

  return {
    status: 503,
    code: "DATABASE_UNAVAILABLE",
    message: "Supabase is not reachable from this deployment."
  };
}

export async function GET() {
  try {
    const { error } = await getSupabaseAdmin()
      .from("personal_places")
      .select("id,google_place_id")
      .limit(1);

    if (error) {
      throw new Error("Health personal_places: " + error.message);
    }

    return NextResponse.json(
      {
        ok: true,
        services: {
          supabase: "ok"
        },
        schema: {
          personalPlacesGooglePlaceId: true
        }
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    const mapped = classify(error);
    console.error(
      "[di-dau][health]",
      error instanceof Error ? error.message : error
    );

    return NextResponse.json(
      {
        ok: false,
        code: mapped.code,
        error: mapped.message
      },
      {
        status: mapped.status,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
