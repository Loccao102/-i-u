import "server-only";

import { randomUUID } from "node:crypto";
import type { Json } from "../database.types";
import type {
  ActivePlanAdvanceResult,
  ActivePersonalPlan,
  ActivePlanSnapshot
} from "../types";
import { parseActivePlanSnapshot } from "./input";
import { addVisit } from "./personal-repository";
import { getSupabaseAdmin } from "./supabase";

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

type ActivePlanRow = {
  id: string;
  plan: Json;
  current_stop_index: number;
  completed_stop_ids: string[] | null;
  skipped_stop_ids: string[] | null;
  started_at: string;
  updated_at: string;
};

function mapActivePlan(row: ActivePlanRow): ActivePersonalPlan {
  return {
    id: row.id,
    plan: parseActivePlanSnapshot(row.plan),
    currentStopIndex: Number(row.current_stop_index),
    completedStopIds: row.completed_stop_ids ?? [],
    skippedStopIds: row.skipped_stop_ids ?? [],
    startedAt: row.started_at,
    updatedAt: row.updated_at
  };
}

export async function getActivePlan(
  ownerKey: string
): Promise<ActivePersonalPlan | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("active_personal_plans")
    .select(
      "id,plan,current_stop_index,completed_stop_ids,skipped_stop_ids,started_at,updated_at"
    )
    .eq("owner_key", ownerKey)
    .maybeSingle();

  dbError(error, "Get active plan");
  return data ? mapActivePlan(data as ActivePlanRow) : null;
}

export async function startActivePlan(
  ownerKey: string,
  plan: ActivePlanSnapshot
): Promise<ActivePersonalPlan> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const { data, error } = await getSupabaseAdmin()
    .from("active_personal_plans")
    .upsert(
      {
        owner_key: ownerKey,
        id,
        plan: plan as unknown as Json,
        current_stop_index: 0,
        completed_stop_ids: [],
        skipped_stop_ids: [],
        started_at: now,
        updated_at: now
      },
      { onConflict: "owner_key" }
    )
    .select(
      "id,plan,current_stop_index,completed_stop_ids,skipped_stop_ids,started_at,updated_at"
    )
    .single();

  dbError(error, "Start active plan");
  return mapActivePlan(data as ActivePlanRow);
}

async function hasRecentVisit(ownerKey: string, placeId: string) {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("visits")
    .select("id")
    .eq("owner_key", ownerKey)
    .eq("place_id", placeId)
    .gte("visited_at", since)
    .limit(1);

  dbError(error, "Check recent plan visit");
  return (data?.length ?? 0) > 0;
}

export async function advanceActivePlan(
  ownerKey: string,
  action: "complete" | "skip"
): Promise<ActivePlanAdvanceResult> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "advance_active_personal_plan",
    {
      p_owner_key: ownerKey,
      p_action: action
    }
  );

  dbError(error, "Advance active plan");

  const result =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (result.notFound === true) {
    return {
      activePlan: null,
      finished: false,
      recordedVisit: false
    };
  }

  const stopId =
    typeof result.stopId === "string" ? result.stopId : null;
  let recordedVisit = false;

  if (action === "complete" && stopId) {
    const alreadyVisited = await hasRecentVisit(ownerKey, stopId);
    if (!alreadyVisited) {
      await addVisit(ownerKey, stopId, null);
      recordedVisit = true;
    }
  }

  const finished = result.finished === true;

  return {
    activePlan: finished ? null : await getActivePlan(ownerKey),
    finished,
    recordedVisit
  };
}

export async function cancelActivePlan(ownerKey: string) {
  const { error } = await getSupabaseAdmin()
    .from("active_personal_plans")
    .delete()
    .eq("owner_key", ownerKey);

  dbError(error, "Cancel active plan");
}
