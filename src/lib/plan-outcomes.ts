import type {
  CompletedPersonalPlan,
  Place,
  PlanOutcomeProfile,
  Scenario
} from "./types";

const scenarios: Scenario[] = [
  "date",
  "friends",
  "food",
  "coffee",
  "fun",
  "chill"
];

function recencyWeight(completedAt: string, nowMs: number) {
  const time = new Date(completedAt).getTime();
  if (!Number.isFinite(time)) return 0.35;

  const ageDays = Math.max(
    0,
    (nowMs - time) / (24 * 60 * 60 * 1000)
  );

  return Math.max(0.35, 1 - ageDays / 180);
}

function enjoymentWeight(plan: CompletedPersonalPlan) {
  const ratingWeight =
    plan.outcomeRating === 5
      ? 1.15
      : plan.outcomeRating === 4
        ? 1
        : plan.outcomeRating === 3
          ? 0.55
          : plan.outcomeRating === 2
            ? 0.15
            : plan.outcomeRating === 1
              ? 0
              : 0.72;

  if (plan.wouldRepeat === true) {
    return Math.min(1.2, ratingWeight + 0.1);
  }
  if (plan.wouldRepeat === false) {
    return ratingWeight * 0.35;
  }
  return ratingWeight;
}

export function derivePlanOutcomeProfile(
  completedPlans: ReadonlyArray<CompletedPersonalPlan>,
  nowMs = Date.now()
): PlanOutcomeProfile {
  const scenarioTotals = new Map<
    Scenario,
    { weightedSuccess: number; weight: number }
  >();
  const placeTotals = new Map<
    string,
    { completed: number; weight: number }
  >();

  let successfulPlanCount = 0;
  const plans = completedPlans.slice(0, 30);

  for (const item of plans) {
    const totalStops = item.plan.stops.length;
    if (totalStops === 0) continue;

    const completed = new Set(item.completedStopIds);
    const completedCount = item.plan.stops.filter((stop) =>
      completed.has(stop.placeId)
    ).length;
    const completionRatio = completedCount / totalStops;
    const recency = recencyWeight(item.completedAt, nowMs);
    const enjoyment = enjoymentWeight(item);
    const weight = recency * enjoyment;
    const effectiveSuccess = completionRatio * enjoyment;

    // Skips stay neutral. Explicit post-plan feedback can reduce or remove
    // a positive completion signal without inventing a dislike signal.
    if (
      completionRatio >= 0.67 &&
      (item.outcomeRating === null || item.outcomeRating >= 4) &&
      item.wouldRepeat !== false
    ) {
      successfulPlanCount += 1;
    }

    if (item.plan.scenario && effectiveSuccess > 0) {
      const current = scenarioTotals.get(item.plan.scenario) ?? {
        weightedSuccess: 0,
        weight: 0
      };
      current.weightedSuccess += effectiveSuccess * recency;
      current.weight += recency;
      scenarioTotals.set(item.plan.scenario, current);
    }

    for (const stop of item.plan.stops) {
      if (!completed.has(stop.placeId) || weight <= 0) continue;

      const current = placeTotals.get(stop.placeId) ?? {
        completed: 0,
        weight: 0
      };
      current.completed += weight;
      current.weight += recency;
      placeTotals.set(stop.placeId, current);
    }
  }

  const scenarioScores: Partial<Record<Scenario, number>> = {};
  for (const scenario of scenarios) {
    const value = scenarioTotals.get(scenario);
    if (!value || value.weight <= 0) continue;
    scenarioScores[scenario] = Math.max(
      0,
      Math.min(1, value.weightedSuccess / value.weight)
    );
  }

  const maxPlaceWeight = Math.max(
    1,
    ...Array.from(placeTotals.values()).map((item) => item.completed)
  );
  const placeScores: Record<string, number> = {};
  for (const [placeId, value] of placeTotals) {
    placeScores[placeId] = Math.max(
      0,
      Math.min(1, value.completed / maxPlaceWeight)
    );
  }

  return {
    sampleSize: plans.length,
    successfulPlanCount,
    scenarioScores,
    placeScores
  };
}

export function scorePlanOutcomeMatch(
  place: Pick<Place, "id" | "scenarios">,
  profile: PlanOutcomeProfile,
  selectedScenario: Scenario | "all" = "all"
) {
  if (profile.sampleSize === 0) {
    return { score: 0, reasons: [] as string[] };
  }

  const exactPlace = profile.placeScores[place.id] ?? 0;
  const relevantScenarios =
    selectedScenario !== "all"
      ? [selectedScenario]
      : place.scenarios;

  const scenarioValues = relevantScenarios
    .map((scenario) => profile.scenarioScores[scenario] ?? 0)
    .filter((value) => value > 0);

  const scenarioFit =
    scenarioValues.length > 0
      ? Math.max(...scenarioValues)
      : 0;

  // Deliberately weak compared with explicit rating/feedback and
  // current-context signals. Exact repeats are capped lower than patterns
  // so successful history does not destroy novelty.
  const score = Math.min(
    5,
    exactPlace * 1.5 + scenarioFit * 3.5
  );

  const reasons: string[] = [];
  if (scenarioFit >= 0.7) {
    reasons.push("Kiểu outing này từng đi khá trọn");
  }
  if (exactPlace >= 0.55) {
    reasons.push("Từng là chặng bạn đã hoàn thành");
  }

  return {
    score,
    reasons: reasons.slice(0, 1)
  };
}
