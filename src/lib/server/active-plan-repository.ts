import "server-only";

import { randomUUID } from "node:crypto";
import type { Json } from "../database.types";
import type {
  ActivePlanAdvanceResult,
  ActivePlanStartResult,
  ActivePersonalPlan,
  ActivePlanSnapshot
} from "../types";
import { parseActivePlanSnapshot } from "./input";
import { addVisitIfNew } from "./personal-repository";
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
): Promise<ActivePlanStartResult> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "start_active_personal_plan",
    {
      p_owner_key: ownerKey,
      p_id: randomUUID(),
      p_plan: plan as unknown as Json
    }
  );

  dbError(error, "Start active plan");

  const result =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const rawActivePlan =
    result.activePlan &&
    typeof result.activePlan === "object" &&
    !Array.isArray(result.activePlan)
      ? (result.activePlan as Record<string, unknown>)
      : null;

  if (!rawActivePlan) {
    throw new Error("Start active plan: invalid database response");
  }

  const activePlan: ActivePersonalPlan = {
    id: String(rawActivePlan.id ?? ""),
    plan: parseActivePlanSnapshot(rawActivePlan.plan),
    currentStopIndex: Number(rawActivePlan.currentStopIndex ?? 0),
    completedStopIds: Array.isArray(rawActivePlan.completedStopIds)
      ? rawActivePlan.completedStopIds.map(String)
      : [],
    skippedStopIds: Array.isArray(rawActivePlan.skippedStopIds)
      ? rawActivePlan.skippedStopIds.map(String)
      : [],
    startedAt: String(rawActivePlan.startedAt ?? ""),
    updatedAt: String(rawActivePlan.updatedAt ?? "")
  };

  if (!activePlan.id || !activePlan.startedAt || !activePlan.updatedAt) {
    throw new Error("Start active plan: incomplete database response");
  }

  return {
    activePlan,
    created: result.created === true
  };
}

export async function advanceActivePlan(
  ownerKey: string,
  action: "complete" | "skip",
  expectedIndex: number
): Promise<ActivePlanAdvanceResult> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "advance_active_personal_plan",
    {
      p_owner_key: ownerKey,
      p_action: action,
      p_expected_index: expectedIndex
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
      recordedVisit: false,
      stale: false
    };
  }

  if (result.stale === true) {
    return {
      activePlan: await getActivePlan(ownerKey),
      finished: false,
      recordedVisit: false,
      stale: true
    };
  }

  const stopId =
    typeof result.stopId === "string" ? result.stopId : null;
  let recordedVisit = false;

  if (action === "complete" && stopId) {
    const visitResult = await addVisitIfNew(
      ownerKey,
      stopId,
      null
    );
    recordedVisit = visitResult.created;
  }

  const finished = result.finished === true;

  return {
    activePlan: finished ? null : await getActivePlan(ownerKey),
    finished,
    recordedVisit,
    stale: false
  };
}

export async function cancelActivePlan(ownerKey: string) {
  const { error } = await getSupabaseAdmin()
    .from("active_personal_plans")
    .delete()
    .eq("owner_key", ownerKey);

  dbError(error, "Cancel active plan");
}
