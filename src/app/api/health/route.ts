import { NextResponse } from "next/server";
import {
  getSupabaseAdmin,
  getSupabaseServerKeyKind
} from "@/lib/server/supabase";

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

  if (raw.startsWith("Invalid server env:")) {
    return {
      status: 503,
      code: "SERVER_CONFIG_INVALID",
      message:
        "Supabase server credentials are invalid. Use a secret/service-role key, not a publishable/anon key."
    };
  }

  if (
    /google_place_id|cost_source|cost_confidence|outcome_rating|would_repeat|feedback_note|feedback_at|place_user_photos|active_personal_plans|completed_personal_plans|daily_discoveries|personal_planner_defaults|personal_places/i.test(
      raw
    ) &&
    /column|relation|schema|does not exist|cache/i.test(raw)
  ) {
    return {
      status: 503,
      code: "DATABASE_SCHEMA_MISMATCH",
      message: "Supabase schema is behind the deployed app."
    };
  }

  if (/permission denied|row-level security/i.test(raw)) {
    return {
      status: 503,
      code: "SERVER_KEY_PERMISSION_DENIED",
      message:
        "The configured Supabase key does not have server-level database access."
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
    const client = getSupabaseAdmin();
    const keyKind = getSupabaseServerKeyKind();

    const [places, photos, activePlans, dailyDiscoveries, completedPlans, plannerDefaults] = await Promise.all([
      client
        .from("personal_places")
        .select("id,google_place_id,cost_source,cost_confidence")
        .limit(1),
      client
        .from("place_user_photos")
        .select("id")
        .limit(1),
      client
        .from("active_personal_plans")
        .select("id,current_stop_index")
        .limit(1),
      client
        .from("daily_discoveries")
        .select("day,kind,place_keys")
        .limit(1),
      client
        .from("completed_personal_plans")
        .select("id,completed_at,outcome_rating,would_repeat,feedback_at")
        .limit(1),
      client
        .from("personal_planner_defaults")
        .select("route_mode,budget_for_two,max_distance_km,duration_hours")
        .limit(1)
    ]);

    if (places.error) {
      throw new Error("Health personal_places: " + places.error.message);
    }
    if (photos.error) {
      throw new Error("Health place_user_photos: " + photos.error.message);
    }
    if (activePlans.error) {
      throw new Error(
        "Health active_personal_plans: " + activePlans.error.message
      );
    }
    if (dailyDiscoveries.error) {
      throw new Error(
        "Health daily_discoveries: " + dailyDiscoveries.error.message
      );
    }
    if (completedPlans.error) {
      throw new Error(
        "Health completed_personal_plans: " + completedPlans.error.message
      );
    }
    if (plannerDefaults.error) {
      throw new Error(
        "Health personal_planner_defaults: " + plannerDefaults.error.message
      );
    }

    return NextResponse.json(
      {
        ok: true,
        services: {
          supabase: "ok",
          poiProvider: process.env.GEOAPIFY_API_KEY?.trim()
            ? "geoapify"
            : "openstreetmap-fallback"
        },
        serverKeyKind: keyKind,
        schema: {
          personalPlacesGooglePlaceId: true,
          personalPlaceCostProvenance: true,
          placeUserPhotos: true,
          activePersonalPlans: true,
          dailyDiscoveries: true,
          completedPersonalPlans: true,
          personalPlannerDefaults: true
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
