import type {
  ActivePlanSnapshot,
  EveningPlan,
  EveningPlanPreferences,
  EveningPlanStop,
  NextPlaceSuggestion,
  PersonalRating,
  Place,
  PlannerCostProfile,
  PlannerReplayTemplate,
  PlannerTravelMatrix,
  PlanOutcomeProfile,
  RecommendationFeedback,
  PlanStage,
  RoutingMode,
  Scenario,
  UserLocation,
  VisitRecord
} from "./types";
import { parseCostAmount } from "./cost-estimation";
import { openingStatus } from "./opening-hours";
import { scorePlanOutcomeMatch } from "./plan-outcomes";
import { analyzePlanQuality } from "./plan-quality";
import { haversineKm } from "./search";

type PlannerSignals = {
  savedIds: ReadonlySet<string>;
  ratings: Readonly<Record<string, PersonalRating>>;
  feedbacks?: Readonly<Record<string, RecommendationFeedback>>;
  visits: ReadonlyArray<VisitRecord>;
  costProfile?: PlannerCostProfile;
  planOutcomes?: PlanOutcomeProfile;
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
    const explicit = parseCostAmount(place.averageForTwo);
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
  const explicit = parseCostAmount(place.averageForTwo);
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

function travelMinutes(
  distanceKm: number,
  mode: RoutingMode = "motorcycle"
) {
  if (mode === "walk") {
    return Math.max(
      4,
      Math.min(180, Math.round(distanceKm * 12.5))
    );
  }

  if (mode === "drive") {
    return Math.max(
      7,
      Math.min(75, Math.round(7 + distanceKm * 3.6))
    );
  }

  return Math.max(
    6,
    Math.min(60, Math.round(5 + distanceKm * 3.8))
  );
}

function travelMetric(input: {
  origin: UserLocation;
  previous: Place | null;
  place: Place;
  matrix?: PlannerTravelMatrix;
  routeMode: RoutingMode;
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
    durationMinutes: travelMinutes(distanceKm, input.routeMode),
    source: "heuristic" as const
  };
}

export function plannerRoutingCandidates(
  places: Place[],
  preferences: EveningPlanPreferences,
  limit = 6,
  replayTemplate?: PlannerReplayTemplate | null
) {
  const chosen: Place[] = [];
  const used = new Set<string>();
  const stages =
    replayTemplate?.stops.length
      ? replayTemplate.stops.map((stop) => stop.stage)
      : stagesFor(
          preferences.scenario,
          preferences.durationHours
        );

  if (replayTemplate?.stops.length) {
    for (const templateStop of replayTemplate.stops) {
      if (chosen.length >= limit) break;
      const place = places.find(
        (item) => item.id === templateStop.placeId
      );
      if (!place || used.has(place.id)) continue;
      if (!matchesStage(place, templateStop.stage)) continue;

      chosen.push(place);
      used.add(place.id);
    }
  }

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
  previous: Place | null;
  maxDistanceKm: number;
  stageBudget: number;
  variant: number;
  originDistanceKm: number;
  legDistanceKm: number;
  preferredPlaceId?: string | null;
}) {
  const {
    place,
    stage,
    scenario,
    signals,
    previous,
    maxDistanceKm,
    stageBudget,
    variant,
    originDistanceKm,
    legDistanceKm,
    preferredPlaceId
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

  const outcomeBonus = signals.planOutcomes
    ? scorePlanOutcomeMatch(place, signals.planOutcomes, scenario).score
    : 0;
  const replayBonus =
    preferredPlaceId === place.id
      ? Math.max(12, 44 - input.variant * 12)
      : 0;

  return (
    place.match +
    (matchesStage(place, stage) ? 28 : 0) +
    (place.scenarios.includes(scenario) ? 10 : 0) +
    novelty +
    variantScore +
    outcomeBonus +
    replayBonus -
    routePenalty -
    feedbackPenalty
  );
}

function replayReplacementReason(input: {
  places: Place[];
  preferredPlaceId: string;
  stage: PlanStage;
  signals: PlannerSignals;
  scenario: Scenario;
  origin: UserLocation;
  previous: Place | null;
  travelMatrix?: PlannerTravelMatrix;
  routeMode: RoutingMode;
  maxDistanceKm: number;
  stageBudget: number;
  remainingBudget: number;
  relaxedBudget: boolean;
  scheduledStart: Date;
  stageMinutes: number;
  usedMinutes: number;
  reserveMinutes: number;
  maxDurationMinutes: number;
}) {
  const preferred = input.places.find(
    (place) => place.id === input.preferredPlaceId
  );
  if (!preferred) {
    return "Địa điểm cũ không còn trong dữ liệu hiện tại.";
  }

  if (!matchesStage(preferred, input.stage)) {
    return "Loại địa điểm cũ không còn khớp với chặng này.";
  }

  const rating = input.signals.ratings[preferred.id];
  if (rating?.revisit === "no") {
    return "Bạn từng đánh dấu không muốn quay lại địa điểm cũ.";
  }

  const feedback = input.signals.feedbacks?.[preferred.id];
  if (feedback?.reason === "not_taste") {
    return "Tín hiệu cá nhân hiện tại cho biết địa điểm cũ không hợp gu.";
  }

  if (feedback?.reason === "not_now") {
    const feedbackTime = new Date(feedback.updatedAt).getTime();
    const stillFresh =
      Number.isFinite(feedbackTime) &&
      Date.now() - feedbackTime <= 24 * 60 * 60 * 1000;
    const sameContext =
      !feedback.scenario || feedback.scenario === input.scenario;
    if (stillFresh && sameContext) {
      return "Bạn vừa đánh dấu địa điểm cũ là không phù hợp lúc này.";
    }
  }

  const metric = travelMetric({
    origin: input.origin,
    previous: input.previous,
    place: preferred,
    matrix: input.travelMatrix,
    routeMode: input.routeMode
  });
  const originMetric = travelMetric({
    origin: input.origin,
    previous: null,
    place: preferred,
    matrix: input.travelMatrix,
    routeMode: input.routeMode
  });

  if (originMetric.distanceKm > input.maxDistanceKm) {
    return "Địa điểm cũ nằm ngoài bán kính bạn đang chọn.";
  }

  if (
    input.previous &&
    metric.distanceKm > Math.max(3.5, input.maxDistanceKm * 0.7)
  ) {
    return "Quãng đường từ chặng trước tới địa điểm cũ quá xa.";
  }

  const availability = openingAvailability(
    preferred,
    input.scheduledStart,
    input.stageMinutes
  );
  if (availability === "closed") {
    return "Địa điểm cũ đóng cửa trong khung giờ dự kiến.";
  }

  if (
    input.usedMinutes +
      (input.previous ? metric.durationMinutes : 0) +
      input.stageMinutes +
      input.reserveMinutes >
    input.maxDurationMinutes
  ) {
    return "Chặng cũ không còn vừa khung thời lượng hôm nay.";
  }

  const cost = estimateCostForTwo(
    preferred,
    input.signals.costProfile
  );
  if (
    (!input.relaxedBudget && cost > input.remainingBudget) ||
    cost > input.stageBudget
  ) {
    return "Chi phí hiện tại của chặng cũ không còn phù hợp budget.";
  }

  return "Có phương án khác được xếp hạng phù hợp hơn với điều kiện hôm nay.";
}

function buildWithGuardrails(input: {
  places: Place[];
  preferences: EveningPlanPreferences;
  signals: PlannerSignals;
  origin: UserLocation;
  variant: number;
  relaxedBudget: boolean;
  travelMatrix?: PlannerTravelMatrix;
  replayTemplate?: PlannerReplayTemplate | null;
}) {
  const {
    places,
    preferences,
    signals,
    origin,
    variant,
    relaxedBudget,
    travelMatrix,
    replayTemplate
  } = input;
  const stages =
    replayTemplate?.stops.length
      ? replayTemplate.stops.map((stop) => stop.stage)
      : stagesFor(preferences.scenario, preferences.durationHours);
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
  const replacements: Array<{
    stage: PlanStage;
    originalPlaceId: string;
    originalName: string;
    replacementPlaceId: string | null;
    replacementName: string | null;
    reason: string;
  }> = [];
  const used = new Set<string>();
  let previous: Place | null = null;
  let remainingBudget = preferences.budgetForTwo;
  let usedMinutes = 0;

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]!;
    const preferredPlaceId =
      replayTemplate?.stops[index]?.placeId ?? null;
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
          matrix: travelMatrix,
          routeMode: preferences.routeMode
        });
        const originMetric = travelMetric({
          origin,
          previous: null,
          place,
          matrix: travelMatrix,
          routeMode: preferences.routeMode
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
          previous,
          maxDistanceKm: preferences.maxDistanceKm,
          stageBudget,
          variant,
          originDistanceKm: originMetric.distanceKm,
          legDistanceKm: metric.distanceKm,
          preferredPlaceId
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
    const templateStop = replayTemplate?.stops[index];

    if (
      templateStop &&
      (!chosen || chosen.place.id !== templateStop.placeId)
    ) {
      const stageMin = stageDurationMinutes(stage);
      const preferredPlace = places.find(
        (place) => place.id === templateStop.placeId
      );
      const preferredMetric = preferredPlace
        ? travelMetric({
            origin,
            previous,
            place: preferredPlace,
            matrix: travelMatrix,
            routeMode: preferences.routeMode
          })
        : null;
      const scheduledStart = new Date(
        planStart.getTime() +
          (usedMinutes +
            (selected.length > 0
              ? preferredMetric?.durationMinutes ?? 0
              : 0)) *
            60 *
            1000
      );

      replacements.push({
        stage,
        originalPlaceId: templateStop.placeId,
        originalName:
          templateStop.name ??
          preferredPlace?.name ??
          "Địa điểm cũ",
        replacementPlaceId: chosen?.place.id ?? null,
        replacementName: chosen?.place.name ?? null,
        reason: replayReplacementReason({
          places,
          preferredPlaceId: templateStop.placeId,
          stage,
          signals,
          scenario: preferences.scenario,
          origin,
          previous,
          travelMatrix,
          routeMode: preferences.routeMode,
          maxDistanceKm: preferences.maxDistanceKm,
          stageBudget,
          remainingBudget,
          relaxedBudget,
          scheduledStart,
          stageMinutes: stageMin,
          usedMinutes,
          reserveMinutes,
          maxDurationMinutes
        })
      });
    }

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
    replacements,
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
  replayTemplate?: PlannerReplayTemplate | null;
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
    travelMatrix: input.travelMatrix,
    replayTemplate: input.replayTemplate
  });

  if (generated.selected.length === 0) {
    generated = buildWithGuardrails({
      places,
      preferences,
      signals,
      origin,
      variant,
      relaxedBudget: true,
      travelMatrix: input.travelMatrix,
      replayTemplate: input.replayTemplate
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
  const retainedStopIds = input.replayTemplate
    ? stops
        .filter((stop) =>
          input.replayTemplate?.stops.some(
            (templateStop) =>
              templateStop.placeId === stop.place.id
          )
        )
        .map((stop) => stop.place.id)
    : [];
  const replay = input.replayTemplate
    ? {
        sourcePlanId: input.replayTemplate.sourcePlanId,
        originalStopCount: input.replayTemplate.stops.length,
        retainedStopIds,
        replacedStopCount: Math.max(
          0,
          input.replayTemplate.stops.length - retainedStopIds.length
        ),
        replacements: generated.replacements
      }
    : null;

  return {
    scenario: preferences.scenario,
    routeMode: preferences.routeMode,
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
    replay,
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
  travelMatrix?: PlannerTravelMatrix;
  routeMode?: RoutingMode;
}): NextPlaceSuggestion[] {
  const {
    current,
    places,
    signals,
    maxDistanceKm = 4,
    limit = 3,
    localHour,
    maxCostForTwo = Number.POSITIVE_INFINITY,
    travelMatrix,
    routeMode = "motorcycle"
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
      const metric = travelMetric({
        origin: currentPoint,
        previous: current,
        place,
        matrix: travelMatrix,
        routeMode
      });
      const distanceKm = metric.distanceKm;

      if (distanceKm > maxDistanceKm) return null;

      const estimatedCostForTwo = estimateCostForTwo(place, signals.costProfile);
      if (estimatedCostForTwo > maxCostForTwo) return null;

      const stage = inferStage(place);
      const orderIndex = desired.indexOf(stage);
      const transitionBonus =
        orderIndex === 0 ? 26 : orderIndex === 1 ? 12 : 0;
      const count = visitCount(signals.visits, place.id);
      const novelty = count === 0 ? 5 : Math.max(0, 3 - count);
      const estimatedTravelMinutes = metric.durationMinutes;
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
        travelSource: metric.source,
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
      ): item is NextPlaceSuggestion & {
        score: number;
        travelSource: "road" | "heuristic";
      } => item !== null
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
  const quality = analyzePlanQuality(plan);

  return {
    scenario: plan.scenario,
    routeMode: plan.routeMode,
    summary: plan.summary,
    totalEstimatedCostForTwo: plan.totalEstimatedCostForTwo,
    budgetRemainingForTwo: plan.budgetRemainingForTwo,
    routeKm: plan.routeKm,
    totalDurationMinutes: plan.totalDurationMinutes,
    averageMatch: plan.averageMatch,
    quality: {
      score: quality.score,
      level: quality.level,
      routingCoverage: quality.routingCoverage,
      openingCoverage: quality.openingCoverage,
      estimatedCostStops: quality.estimatedCostStops,
      issues: quality.issues.slice(0, 5)
    },
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
