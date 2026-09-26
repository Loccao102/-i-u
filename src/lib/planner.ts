import type {
  EveningPlan,
  EveningPlanPreferences,
  EveningPlanStop,
  PersonalRating,
  Place,
  PlanStage,
  Scenario,
  UserLocation,
  VisitRecord
} from "./types";
import { haversineKm } from "./search";

type PlannerSignals = {
  savedIds: ReadonlySet<string>;
  ratings: Readonly<Record<string, PersonalRating>>;
  visits: ReadonlyArray<VisitRecord>;
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

export function estimateCostForTwo(place: Place) {
  return parseMoney(place.averageForTwo) ?? fallbackCost[place.priceLabel];
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
  if (stage === "activity") return 90;
  if (stage === "food") return 75;
  return 60;
}

function travelMinutes(distanceKm: number) {
  return Math.max(8, Math.min(35, Math.round(7 + distanceKm * 5)));
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
    variant
  } = input;

  const rating = signals.ratings[place.id];
  if (rating?.revisit === "no") return null;

  const originDistance = haversineKm(origin, {
    latitude: place.latitude,
    longitude: place.longitude
  });

  if (originDistance > maxDistanceKm) return null;

  const legDistance = previous
    ? haversineKm(
        {
          latitude: previous.latitude,
          longitude: previous.longitude
        },
        {
          latitude: place.latitude,
          longitude: place.longitude
        }
      )
    : originDistance;

  if (previous && legDistance > Math.max(4, maxDistanceKm * 0.8)) {
    return null;
  }

  const cost = estimateCostForTwo(place);
  const costOver = Math.max(0, cost - stageBudget);
  const costPenalty = costOver / 35_000;
  const routePenalty = legDistance * (previous ? 5.5 : 2.5);
  const novelty = visitCount(signals.visits, place.id) === 0 ? 5 : 0;
  const variant = variantBias(place.id, input.variant) * 8;

  return (
    place.match +
    (matchesStage(place, stage) ? 28 : 0) +
    (place.scenarios.includes(scenario) ? 10 : 0) +
    novelty +
    variant -
    routePenalty -
    costPenalty
  );
}

export function buildEveningPlan(input: {
  places: Place[];
  preferences: EveningPlanPreferences;
  signals: PlannerSignals;
  origin: UserLocation;
  variant?: number;
}): EveningPlan | null {
  const { places, preferences, signals, origin } = input;
  const variant = input.variant ?? 0;
  const stages = stagesFor(
    preferences.scenario,
    preferences.durationHours
  );

  const selected: Array<{
    place: Place;
    stage: PlanStage;
    cost: number;
    travelKm: number;
  }> = [];

  const used = new Set<string>();
  let previous: Place | null = null;
  let remainingBudget = preferences.budgetForTwo;

  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index]!;
    const remainingStages = stages.length - index;
    const stageBudget = Math.max(120_000, remainingBudget / remainingStages);

    const stageCandidates = places
      .filter((place) => !used.has(place.id))
      .filter((place) => matchesStage(place, stage))
      .map((place) => ({
        place,
        score: candidateScore({
          place,
          stage,
          scenario: preferences.scenario,
          signals,
          origin,
          previous,
          maxDistanceKm: preferences.maxDistanceKm,
          stageBudget,
          variant
        })
      }))
      .filter(
        (
          item
        ): item is {
          place: Place;
          score: number;
        } => item.score !== null
      )
      .sort((a, b) => b.score - a.score);

    let chosen = stageCandidates[0]?.place;

    if (!chosen) {
      chosen = places
        .filter((place) => !used.has(place.id))
        .map((place) => ({
          place,
          score: candidateScore({
            place,
            stage,
            scenario: preferences.scenario,
            signals,
            origin,
            previous,
            maxDistanceKm: preferences.maxDistanceKm,
            stageBudget,
            variant
          })
        }))
        .filter(
          (
            item
          ): item is {
            place: Place;
            score: number;
          } => item.score !== null
        )
        .sort((a, b) => b.score - a.score)[0]?.place;
    }

    if (!chosen) continue;

    const travelKm = previous
      ? haversineKm(
          {
            latitude: previous.latitude,
            longitude: previous.longitude
          },
          {
            latitude: chosen.latitude,
            longitude: chosen.longitude
          }
        )
      : haversineKm(origin, {
          latitude: chosen.latitude,
          longitude: chosen.longitude
        });

    const cost = estimateCostForTwo(chosen);
    selected.push({ place: chosen, stage, cost, travelKm });
    used.add(chosen.id);
    remainingBudget = Math.max(0, remainingBudget - cost);
    previous = chosen;
  }

  if (selected.length === 0) return null;

  let clock = parseClock(preferences.startTime);
  const stops: EveningPlanStop[] = selected.map((item, index) => {
    if (index > 0) {
      clock += travelMinutes(item.travelKm);
    }

    const startTime = formatClock(clock);
    clock += stageDurationMinutes(item.stage);

    return {
      place: item.place,
      stage: item.stage,
      stageLabel: stageLabels[item.stage],
      startTime,
      estimatedCostForTwo: item.cost,
      travelKmFromPrevious: item.travelKm,
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
  const averageMatch = Math.round(
    stops.reduce((sum, stop) => sum + stop.place.match, 0) /
      stops.length
  );
  const withinBudget =
    totalEstimatedCostForTwo <= preferences.budgetForTwo;

  return {
    stops,
    totalEstimatedCostForTwo,
    routeKm,
    averageMatch,
    withinBudget,
    summary:
      stops.length +
      " chặng · " +
      Math.round(totalEstimatedCostForTwo / 1000) +
      "k/2 người · " +
      routeKm.toFixed(1) +
      " km"
  };
}
