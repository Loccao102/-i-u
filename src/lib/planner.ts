import type {
  ActivePlanSnapshot,
  EveningPlan,
  EveningPlanPreferences,
  EveningPlanStop,
  NextPlaceSuggestion,
  PersonalRating,
  Place,
  PlannerCostProfile,
  PlannerTravelMatrix,
  RecommendationFeedback,
  PlanStage,
  Scenario,
  UserLocation,
  VisitRecord
} from "./types";
import { openingStatus } from "./opening-hours";
import { haversineKm } from "./search";

type PlannerSignals = {
  savedIds: ReadonlySet<string>;
  ratings: Readonly<Record<string, PersonalRating>>;
  feedbacks?: Readonly<Record<string, RecommendationFeedback>>;
  visits: ReadonlyArray<VisitRecord>;
  costProfile?: PlannerCostProfile;
};

const stageLabels: Record<PlanStage, string> = {
  food: "Ăn uống",
  activity: "Vui chơi",
  coffee: "Cafe / chill"
};

const fallbackCost: Record<Place["priceLabel"], number> = {
  $: 150_000,
  $$: 350_000,
  $$$: 650_000
};

function normalize(value: string) {
  return value.toLocaleLowerCase("vi-VN");
}

function parseMoney(value: string) {
  const plain = /^\s*([\d.,]+)\s*(?:₫|đ|vnd)?\s*$/i.exec(value);
  if (plain) {
    const digits = plain[1]!.replace(/[.,]/g, "");
    const number = Number(digits);
    if (Number.isFinite(number) && number >= 10_000) {
      return Math.round(number);
    }
  }

  const range = /(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|triệu|tr)\b/i.exec(
    value
  );

  if (range) {
    const low = Number(range[1]!.replace(",", "."));
    const high = Number(range[2]!.replace(",", "."));
    const unit = normalize(range[3]!);
    if (Number.isFinite(low) && Number.isFinite(high)) {
      const multiplier =
        unit === "triệu" || unit === "tr" ? 1_000_000 : 1_000;
      return Math.round(((low + high) / 2) * multiplier);
    }
  }

  const matches = Array.from(
    value.matchAll(/(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|triệu|tr)\b/gi)
  );

  if (matches.length === 0) return null;

  const values = matches
    .map((match) => {
      const raw = Number(match[1]!.replace(",", "."));
      if (!Number.isFinite(raw)) return null;
      const unit = normalize(match[2]!);
      return unit === "triệu" || unit === "tr"
        ? raw * 1_000_000
        : raw * 1_000;
    })
    .filter((item): item is number => item !== null);

  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, item) => sum + item, 0) / values.length
  );
}

function costStage(place: Place): PlanStage {
  const kind = normalize(place.kind);
  if (place.scenarios.includes("food") || kind.includes("restaurant")) {
    return "food";
  }
  if (place.scenarios.includes("fun") || kind.includes("activity")) {
    return "activity";
  }
  return "coffee";
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? Math.round((ordered[middle - 1]! + ordered[middle]!) / 2)
    : ordered[middle]!;
}

export function derivePlannerCostProfile(
  places: ReadonlyArray<Place>
): PlannerCostProfile {
  const all: number[] = [];
  const grouped: Record<PlanStage, number[]> = {
    food: [],
    activity: [],
    coffee: []
  };

  for (const place of places) {
    const explicit = parseMoney(place.averageForTwo);
    if (explicit === null) continue;

    // Only real user-entered/legacy costs train the personal spending profile.
    // Provider category estimates are intentionally excluded.
    if (place.costSource === "provider_estimate") continue;

    all.push(explicit);
    grouped[costStage(place)].push(explicit);
  }

  const byStage: PlannerCostProfile["byStage"] = {};
  for (const stage of ["food", "activity", "coffee"] as PlanStage[]) {
    const value = median(grouped[stage]);
    if (value !== null) byStage[stage] = value;
  }

  return {
    sampleSize: all.length,
    overallMedian: median(all),
    byStage
  };
}

export function estimateCostForTwo(
  place: Place,
  costProfile?: PlannerCostProfile
) {
  const explicit = parseMoney(place.averageForTwo);
  const learned =
    costProfile?.byStage[costStage(place)] ??
    costProfile?.overallMedian;

  if (explicit !== null && place.costSource === "provider_estimate") {
    if (learned === null || learned === undefined) return explicit;

    const confidence = Math.max(
      20,
      Math.min(70, place.costConfidence ?? 40)
    );
    const providerWeight = confidence / 100;
    const blended =
      explicit * providerWeight + learned * (1 - providerWeight);

    return Math.round(blended / 10_000) * 10_000;
  }

  if (explicit !== null) return explicit;

  return learned ?? fallbackCost[place.priceLabel];
}

function stagesFor(
  scenario: Scenario,
  durationHours: EveningPlanPreferences["durationHours"]
): PlanStage[] {
  if (scenario === "date") {
    return durationHours >= 4
      ? ["food", "activity", "coffee"]
      : ["food", "coffee"];
  }

  if (scenario === "friends") {
    return durationHours >= 4
      ? ["food", "activity", "coffee"]
      : ["activity", "food"];
  }

  if (scenario === "fun") {
    return durationHours >= 4
      ? ["food", "activity", "coffee"]
      : durationHours === 3
        ? ["activity", "food"]
        : ["activity"];
  }

  if (scenario === "food") {
    return durationHours >= 3 ? ["food", "coffee"] : ["food"];
  }

  if (scenario === "chill") {
    return durationHours >= 3 ? ["food", "coffee"] : ["coffee"];
  }

  return durationHours >= 3 ? ["coffee", "food"] : ["coffee"];
}

function matchesStage(place: Place, stage: PlanStage) {
  const kind = normalize(place.kind);

  if (stage === "food") {
    return place.scenarios.includes("food") || kind.includes("restaurant");
  }

  if (stage === "activity") {
    return place.scenarios.includes("fun") || kind.includes("activity");
  }

  return (
    place.scenarios.includes("coffee") ||
    place.scenarios.includes("chill") ||
    kind.includes("cafe") ||
    kind.includes("bar")
  );
}

function stageDurationMinutes(stage: PlanStage) {
  if (stage === "activity") return 75;
  if (stage === "food") return 65;
  return 50;
}

function minimumFutureMinutes(stages: PlanStage[]) {
  if (stages.length === 0) return 0;
  return (
    stages.reduce((sum, stage) => sum + stageDurationMinutes(stage), 0) +
    Math.max(0, stages.length - 1) * 8
  );
}

function travelMinutes(distanceKm: number) {
  return Math.max(8, Math.min(30, Math.round(6 + distanceKm * 4.5)));
}

function travelMetric(input: {
  origin: UserLocation;
  previous: Place | null;
  place: Place;
  matrix?: PlannerTravelMatrix;
}) {
  const fromKey = input.previous?.id ?? "__origin__";
  const metric = input.matrix?.[fromKey]?.[input.place.id];

  if (
    metric &&
    Number.isFinite(metric.distanceKm) &&
    Number.isFinite(metric.durationMinutes)
  ) {
    return {
      distanceKm: metric.distanceKm,
      durationMinutes: metric.durationMinutes,
      source: "road" as const
    };
  }

  const from = input.previous
    ? {
        latitude: input.previous.latitude,
        longitude: input.previous.longitude
      }
    : input.origin;
  const distanceKm = haversineKm(from, {
    latitude: input.place.latitude,
    longitude: input.place.longitude
  });

  return {
    distanceKm,
    durationMinutes: travelMinutes(distanceKm),
    source: "heuristic" as const
  };
}

export function plannerRoutingCandidates(
  places: Place[],
  preferences: EveningPlanPreferences,
  limit = 6
) {
  const chosen: Place[] = [];
  const used = new Set<string>();
  const stages = stagesFor(
    preferences.scenario,
    preferences.durationHours
  );

  for (const stage of stages) {
    for (const place of places) {
      if (chosen.length >= limit) break;
      if (used.has(place.id) || !matchesStage(place, stage)) continue;

      chosen.push(place);
      used.add(place.id);

      const stageCount = chosen.filter((item) =>
        matchesStage(item, stage)
      ).length;
      if (stageCount >= 2) break;
    }
  }

  for (const place of places) {
    if (chosen.length >= limit) break;
    if (used.has(place.id)) continue;
    chosen.push(place);
    used.add(place.id);
  }

  return chosen;
}

function parseClock(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return 19 * 60;

  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return hour * 60 + minute;
}

function formatClock(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}


function planStartDate(preferences: EveningPlanPreferences) {
  if (preferences.startAt) {
    const parsed = new Date(preferences.startAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date();
  const minutes = parseClock(preferences.startTime);
  fallback.setHours(
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0
  );
  return fallback;
}

function openingAvailability(
  place: Place,
  startAt: Date,
  durationMinutes: number
): "confirmed" | "unknown" | "closed" {
  const endCheck = new Date(
    startAt.getTime() +
      Math.max(1, durationMinutes - 1) * 60 * 1000
  );
  const start = openingStatus(place.openUntil, startAt);
  const end = openingStatus(place.openUntil, endCheck);

  if (start.state === "closed" || end.state === "closed") {
    return "closed";
  }

  if (start.state === "open" && end.state === "open") {
    return "confirmed";
  }

  return "unknown";
}

function variantBias(placeId: string, variant: number) {
  let hash = 2166136261;
  const value = placeId + ":" + variant;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function visitCount(visits: ReadonlyArray<VisitRecord>, placeId: string) {
  let count = 0;
  for (const visit of visits) {
    if (visit.placeId === placeId) count += 1;
  }
  return count;
}

function stageReason(
  place: Place,
  stage: PlanStage,
  scenario: Scenario,
  signals: PlannerSignals
) {
  const reasons = [stageLabels[stage]];

  if (place.scenarios.includes(scenario)) {
    reasons.push("hợp mood");
  }

  const rating = signals.ratings[place.id];
  if (rating?.stars && rating.stars >= 4) {
    reasons.push("bạn từng chấm " + rating.stars + "/5");
  } else if (place.recommendationReasons?.[0]) {
    reasons.push(place.recommendationReasons[0].toLocaleLowerCase("vi-VN"));
  }

  return reasons.join(" · ");
}

function candidateScore(input: {
  place: Place;
  stage: PlanStage;
  scenario: Scenario;
  signals: PlannerSignals;
  origin: UserLocation;
  previous: Place | null;
  maxDistanceKm: number;
  stageBudget: number;
  variant: number;
  originDistanceKm: number;
  legDistanceKm: number;
}) {
  const {
    place,
    stage,
    scenario,
    signals,
    origin,
    previous,
    maxDistanceKm,
    stageBudget,
    variant,
    originDistanceKm,
    legDistanceKm
  } = input;

  const rating = signals.ratings[place.id];
  if (rating?.revisit === "no") return null;

  const feedback = signals.feedbacks?.[place.id];
  if (feedback?.reason === "not_taste") return null;

  if (feedback?.reason === "not_now") {
    const time = new Date(feedback.updatedAt).getTime();
    const stillFresh =
      Number.isFinite(time) &&
      Date.now() - time <= 24 * 60 * 60 * 1000;
    const sameContext =
      !feedback.scenario || feedback.scenario === scenario;

    if (stillFresh && sameContext) return null;
  }

  if (originDistanceKm > maxDistanceKm) return null;

  if (
    previous &&
    legDistanceKm > Math.max(3.5, maxDistanceKm * 0.7)
  ) {
    return null;
  }

  const cost = estimateCostForTwo(place, signals.costProfile);
  if (cost > stageBudget) return null;

  const routePenalty = legDistanceKm * (previous ? 6.5 : 3.2);
  const novelty = visitCount(signals.visits, place.id) === 0 ? 5 : 0;
  const variantScore = variantBias(place.id, input.variant) * 14;
  const feedbackPenalty =
    feedback?.reason === "too_expensive"
      ? 10
      : feedback?.reason === "too_far" && originDistanceKm > 2
        ? 12
        : 0;

  return (
    place.match +
    (matchesStage(place, stage) ? 28 : 0) +
    (place.scenarios.includes(scenario) ? 10 : 0) +
    novelty +
    variantScore -
    routePenalty -
    feedbackPenalty
  );
}

function buildWithGuardrails(input: {
  places: Place[];
  preferences: EveningPlanPreferences;
  signals: PlannerSignals;
  origin: UserLocation;
  variant: number;
  relaxedBudget: boolean;
  travelMatrix?: PlannerTravelMatrix;
}) {
  const {
    places,
    preferences,
    signals,
    origin,
    variant,
    relaxedBudget,
    travelMatrix
  } = input;
  const stages = stagesFor(preferences.scenario, preferences.durationHours);
  const maxDurationMinutes = preferences.durationHours * 60;
  const planStart = planStartDate(preferences);

  const selected: Array<{
    place: Place;
    stage: PlanStage;
    cost: number;
    travelKm: number;
    travelMinutes: number;
    openingHoursStatus: "confirmed" | "unknown";
    travelSource: "road" | "heuristic";
  }> = [];

  const missingStages: PlanStage[] = [];
  const used = new Set<string>();
  let previous: Place | null = null;
  let remainingBudget = preferences.budgetForTwo;
  let usedMinutes = 0;

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]!;
    const futureStages = stages.slice(index + 1);
    const reserveMinutes = minimumFutureMinutes(futureStages);
    const remainingStages = stages.length - index;

    const rawStageBudget = remainingBudget / remainingStages;
    const stageBudget = relaxedBudget
      ? Math.max(180_000, rawStageBudget * 1.2)
      : Math.max(120_000, rawStageBudget);

    const stageCandidates = places
      .filter((place) => !used.has(place.id))
      .filter((place) => matchesStage(place, stage))
      .map((place) => {
        const cost = estimateCostForTwo(place, signals.costProfile);
        const metric = travelMetric({
          origin,
          previous,
          place,
          matrix: travelMatrix
        });
        const originMetric = travelMetric({
          origin,
          previous: null,
          place,
          matrix: travelMatrix
        });
        const travelKm = metric.distanceKm;
        const travelMin =
          selected.length > 0 ? metric.durationMinutes : 0;
        const stageMin = stageDurationMinutes(stage);
        const scheduledStart = new Date(
          planStart.getTime() +
            (usedMinutes + travelMin) * 60 * 1000
        );
        const availability = openingAvailability(
          place,
          scheduledStart,
          stageMin
        );

        if (availability === "closed") {
          return null;
        }

        if (
          usedMinutes + travelMin + stageMin + reserveMinutes >
          maxDurationMinutes
        ) {
          return null;
        }

        if (!relaxedBudget && cost > remainingBudget) {
          return null;
        }

        const score = candidateScore({
          place,
          stage,
          scenario: preferences.scenario,
          signals,
          origin,
          previous,
          maxDistanceKm: preferences.maxDistanceKm,
          stageBudget,
          variant,
          originDistanceKm: originMetric.distanceKm,
          legDistanceKm: metric.distanceKm
        });

        if (score === null) return null;

        return {
          place,
          cost,
          score: score + (availability === "confirmed" ? 4 : 0),
          travelKm,
          travelMin,
          stageMin,
          openingHoursStatus: availability,
          travelSource: metric.source
        };
      })
      .filter(
        (
          item
        ): item is {
          place: Place;
          cost: number;
          score: number;
          travelKm: number;
          travelMin: number;
          stageMin: number;
          openingHoursStatus: "confirmed" | "unknown";
          travelSource: "road" | "heuristic";
        } => item !== null
      )
      .sort((a, b) => b.score - a.score);

    const chosen = stageCandidates[0];
    if (!chosen) {
      missingStages.push(stage);
      continue;
    }

    selected.push({
      place: chosen.place,
      stage,
      cost: chosen.cost,
      travelKm: chosen.travelKm,
      travelMinutes: chosen.travelMin,
      openingHoursStatus: chosen.openingHoursStatus,
      travelSource: chosen.travelSource
    });
    used.add(chosen.place.id);
    remainingBudget -= chosen.cost;
    usedMinutes += chosen.travelMin + chosen.stageMin;
    previous = chosen.place;
  }

  return {
    selected,
    missingStages,
    usedMinutes
  };
}

export function buildEveningPlan(input: {
  places: Place[];
  preferences: EveningPlanPreferences;
  signals: PlannerSignals;
  origin: UserLocation;
  variant?: number;
  travelMatrix?: PlannerTravelMatrix;
}): EveningPlan | null {
  const { places, preferences, signals, origin } = input;
  const variant = input.variant ?? 0;

  let generated = buildWithGuardrails({
    places,
    preferences,
    signals,
    origin,
    variant,
    relaxedBudget: false,
    travelMatrix: input.travelMatrix
  });

  if (generated.selected.length === 0) {
    generated = buildWithGuardrails({
      places,
      preferences,
      signals,
      origin,
      variant,
      relaxedBudget: true,
      travelMatrix: input.travelMatrix
    });
  }

  if (generated.selected.length === 0) return null;

  let clock = parseClock(preferences.startTime);

  const stops: EveningPlanStop[] = generated.selected.map((item, index) => {
    if (index > 0) {
      clock += item.travelMinutes;
    }

    const startTime = formatClock(clock);
    const durationMinutes = stageDurationMinutes(item.stage);
    clock += durationMinutes;
    const endTime = formatClock(clock);

    return {
      place: item.place,
      stage: item.stage,
      stageLabel: stageLabels[item.stage],
      startTime,
      endTime,
      durationMinutes,
      estimatedCostForTwo: item.cost,
      travelKmFromPrevious: item.travelKm,
      travelMinutesFromPrevious: item.travelMinutes,
      travelSource: item.travelSource,
      openingHoursStatus: item.openingHoursStatus,
      reason: stageReason(
        item.place,
        item.stage,
        preferences.scenario,
        signals
      )
    };
  });

  const totalEstimatedCostForTwo = stops.reduce(
    (sum, stop) => sum + stop.estimatedCostForTwo,
    0
  );
  const routeKm = stops.reduce(
    (sum, stop) => sum + stop.travelKmFromPrevious,
    0
  );
  const maxLegKm = stops.reduce(
    (max, stop) => Math.max(max, stop.travelKmFromPrevious),
    0
  );
  const totalDurationMinutes = stops.reduce(
    (sum, stop) =>
      sum + stop.durationMinutes + stop.travelMinutesFromPrevious,
    0
  );
  const averageMatch = Math.round(
    stops.reduce((sum, stop) => sum + stop.place.match, 0) /
      stops.length
  );
  const withinBudget =
    totalEstimatedCostForTwo <= preferences.budgetForTwo;
  const withinDuration =
    totalDurationMinutes <= preferences.durationHours * 60;
  const complete = generated.missingStages.length === 0;
  const unknownOpeningHoursCount = stops.filter(
    (stop) => stop.openingHoursStatus === "unknown"
  ).length;
  const roadRoutedLegs = stops.filter(
    (stop) => stop.travelSource === "road"
  ).length;

  return {
    stops,
    totalEstimatedCostForTwo,
    budgetRemainingForTwo:
      preferences.budgetForTwo - totalEstimatedCostForTwo,
    routeKm,
    maxLegKm,
    totalDurationMinutes,
    averageMatch,
    withinBudget,
    withinDuration,
    complete,
    missingStages: generated.missingStages,
    unknownOpeningHoursCount,
    roadRoutedLegs,
    summary:
      stops.length +
      " chặng · " +
      Math.round(totalEstimatedCostForTwo / 1000) +
      "k/2 người · " +
      Math.round(totalDurationMinutes / 10) * 10 +
      " phút"
  };
}

function inferStage(place: Place): PlanStage {
  return costStage(place);
}

function nextStageOrder(current: Place, localHour?: number): PlanStage[] {
  const currentStage = inferStage(current);

  if (typeof localHour === "number" && localHour >= 21) {
    if (currentStage === "food") return ["coffee", "activity"];
    if (currentStage === "activity") return ["coffee", "food"];
    return ["food", "activity"];
  }

  if (currentStage === "food") return ["activity", "coffee"];
  if (currentStage === "activity") return ["coffee", "food"];
  return ["food", "activity"];
}

export function suggestWhatNext(input: {
  current: Place;
  places: Place[];
  signals: PlannerSignals;
  maxDistanceKm?: number;
  limit?: number;
  localHour?: number;
  maxCostForTwo?: number;
}): NextPlaceSuggestion[] {
  const {
    current,
    places,
    signals,
    maxDistanceKm = 4,
    limit = 3,
    localHour,
    maxCostForTwo = Number.POSITIVE_INFINITY
  } = input;

  const desired = nextStageOrder(current, localHour);
  const currentPoint: UserLocation = {
    latitude: current.latitude,
    longitude: current.longitude
  };

  const scored = places
    .filter((place) => place.id !== current.id)
    .filter((place) => {
      if (signals.ratings[place.id]?.revisit === "no") return false;
      const feedback = signals.feedbacks?.[place.id];
      if (feedback?.reason === "not_taste") return false;

      if (feedback?.reason === "not_now") {
        const time = new Date(feedback.updatedAt).getTime();
        if (
          Number.isFinite(time) &&
          Date.now() - time <= 24 * 60 * 60 * 1000
        ) {
          return false;
        }
      }

      return true;
    })
    .map((place) => {
      const distanceKm = haversineKm(currentPoint, {
        latitude: place.latitude,
        longitude: place.longitude
      });

      if (distanceKm > maxDistanceKm) return null;

      const estimatedCostForTwo = estimateCostForTwo(place, signals.costProfile);
      if (estimatedCostForTwo > maxCostForTwo) return null;

      const stage = inferStage(place);
      const orderIndex = desired.indexOf(stage);
      const transitionBonus =
        orderIndex === 0 ? 26 : orderIndex === 1 ? 12 : 0;
      const count = visitCount(signals.visits, place.id);
      const novelty = count === 0 ? 5 : Math.max(0, 3 - count);
      const estimatedTravelMinutes = travelMinutes(distanceKm);
      const latePenalty =
        typeof localHour === "number" &&
        localHour >= 22 &&
        stage === "activity"
          ? 8
          : 0;

      const score =
        place.match +
        transitionBonus +
        novelty -
        distanceKm * 7 -
        latePenalty;

      const transitionLabel =
        stage === "food"
          ? "Ăn tiếp"
          : stage === "activity"
            ? "Đi chơi"
            : "Cafe / chill";

      const personalReason =
        place.recommendationReasons?.[0] ??
        (signals.savedIds.has(place.id)
          ? "Bạn đã lưu chỗ này"
          : "Phù hợp với bối cảnh hiện tại");

      return {
        place,
        distanceKm,
        estimatedTravelMinutes,
        estimatedCostForTwo,
        transitionLabel,
        score,
        reason:
          personalReason +
          " · " +
          estimatedTravelMinutes +
          " phút di chuyển"
      };
    })
    .filter(
      (
        item
      ): item is NextPlaceSuggestion & { score: number } => item !== null
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.place.match - a.place.match ||
        a.distanceKm - b.distanceKm
    )
    .slice(0, Math.max(1, Math.min(limit, 5)));

  return scored.map(({ score: _score, ...item }) => item);
}


export function toActivePlanSnapshot(
  plan: EveningPlan
): ActivePlanSnapshot {
  return {
    summary: plan.summary,
    totalEstimatedCostForTwo: plan.totalEstimatedCostForTwo,
    budgetRemainingForTwo: plan.budgetRemainingForTwo,
    routeKm: plan.routeKm,
    totalDurationMinutes: plan.totalDurationMinutes,
    averageMatch: plan.averageMatch,
    stops: plan.stops.map((stop) => ({
      placeId: stop.place.id,
      name: stop.place.name,
      latitude: stop.place.latitude,
      longitude: stop.place.longitude,
      stage: stop.stage,
      stageLabel: stop.stageLabel,
      startTime: stop.startTime,
      endTime: stop.endTime,
      estimatedCostForTwo: stop.estimatedCostForTwo,
      travelKmFromPrevious: stop.travelKmFromPrevious,
      travelMinutesFromPrevious: stop.travelMinutesFromPrevious,
      match: stop.place.match,
      reason: stop.reason
    }))
  };
}
