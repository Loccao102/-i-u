import "server-only";

import { getSupabaseAdmin } from "./supabase";
import type {
  PlannerMetric,
  PlannerMetricsSummary
} from "../types";

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function vietnamDateKey(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return values.year + "-" + values.month + "-" + values.day;
}

function rate(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

export async function recordPlannerMetric(
  ownerKey: string,
  metric: PlannerMetric
) {
  const { error } = await getSupabaseAdmin().rpc(
    "increment_personal_planner_metric",
    {
      p_owner_key: ownerKey,
      p_metric: metric
    }
  );
  dbError(error, "Increment planner metric");
}

export async function getPlannerMetrics(
  ownerKey: string
): Promise<PlannerMetricsSummary> {
  const startDay = vietnamDateKey(-29);

  const { data, error } = await getSupabaseAdmin()
    .from("personal_planner_metrics")
    .select(
      "day,generated_count,initial_generated_count,rerolled_count,generation_failed_count,started_count,completed_count,replayed_count,canceled_count"
    )
    .eq("owner_key", ownerKey)
    .gte("day", startDay)
    .order("day", { ascending: false })
    .limit(30);

  dbError(error, "Get planner metrics");

  let generated = 0;
  let initialGenerated = 0;
  let rerolled = 0;
  let generationFailed = 0;
  let started = 0;
  let completed = 0;
  let replayed = 0;
  let canceled = 0;

  for (const row of data ?? []) {
    generated += Number(row.generated_count) || 0;
    initialGenerated += Number(row.initial_generated_count) || 0;
    rerolled += Number(row.rerolled_count) || 0;
    generationFailed += Number(row.generation_failed_count) || 0;
    started += Number(row.started_count) || 0;
    completed += Number(row.completed_count) || 0;
    replayed += Number(row.replayed_count) || 0;
    canceled += Number(row.canceled_count) || 0;
  }

  return {
    windowDays: 30,
    activeDays: data?.length ?? 0,
    generated,
    initialGenerated,
    rerolled,
    generationFailed,
    started,
    completed,
    replayed,
    canceled,
    generationSuccessRate: rate(
      generated,
      generated + generationFailed
    ),
    startRate: rate(started, initialGenerated),
    completionRate: rate(completed, started),
    replayRate: rate(replayed, started),
    rerollRate: rate(rerolled, initialGenerated),
    cancelRate: rate(canceled, started)
  };
}
