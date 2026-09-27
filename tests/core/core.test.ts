import assert from "node:assert/strict";
import test from "node:test";

import { openingStatus } from "../../src/lib/opening-hours";
import { derivePlannerHealth } from "../../src/lib/planner-health";
import {
  buildEveningPlan,
  toActivePlanSnapshot
} from "../../src/lib/planner";
import type {
  EveningPlanPreferences,
  Place,
  PlannerMetricsSummary,
  PlannerReplayTemplate
} from "../../src/lib/types";

function plannerMetrics(
  overrides: Partial<PlannerMetricsSummary> = {}
): PlannerMetricsSummary {
  return {
    windowDays: 30,
    activeDays: 0,
    generated: 0,
    initialGenerated: 0,
    rerolled: 0,
    generationFailed: 0,
    started: 0,
    completed: 0,
    replayed: 0,
    canceled: 0,
    generationSuccessRate: null,
    startRate: null,
    completionRate: null,
    replayRate: null,
    rerollRate: null,
    cancelRate: null,
    ...overrides
  };
}

function place(input: Partial<Place> & Pick<Place, "id" | "name">): Place {
  return {
    id: input.id,
    name: input.name,
    kind: "Cafe",
    description: "",
    latitude: 21.0278,
    longitude: 105.8342,
    distanceKm: 0,
    priceLabel: "$",
    averageForTwo: "150000",
    costSource: "user",
    costConfidence: 100,
    publicRating: 4.5,
    match: 80,
    communityNote: "",
    openUntil: "24/7",
    bestTime: "Tối",
    noise: "Vừa",
    crowd: "Vừa",
    tags: ["Cafe"],
    scenarios: ["coffee", "chill"],
    note: "",
    accent: "#d9ddd7",
    source: "personal",
    ...input
  };
}

const preferences: EveningPlanPreferences = {
  scenario: "coffee",
  routeMode: "motorcycle",
  budgetForTwo: 400_000,
  maxDistanceKm: 5,
  durationHours: 2,
  startTime: "19:00",
  startAt: "2026-09-28T19:00:00"
};

const signals = {
  savedIds: new Set<string>(),
  ratings: {},
  feedbacks: {},
  visits: []
};

function replayTemplate(oldPlace: Place): PlannerReplayTemplate {
  return {
    sourcePlanId: "11111111-1111-4111-8111-111111111111",
    stops: [
      {
        placeId: oldPlace.id,
        name: oldPlace.name,
        stage: "coffee"
      }
    ]
  };
}

test("opening hours supports normal and overnight ranges", () => {
  const mondayMorning = new Date(2026, 8, 28, 10, 0, 0);
  const mondayNight = new Date(2026, 8, 28, 20, 0, 0);
  const saturdayEarly = new Date(2026, 9, 3, 1, 0, 0);

  assert.equal(
    openingStatus("Mo-Fr 09:00-18:00", mondayMorning).state,
    "open"
  );
  assert.equal(
    openingStatus("Mo-Fr 09:00-18:00", mondayNight).state,
    "closed"
  );
  assert.equal(
    openingStatus("Fr 18:00-02:00", saturdayEarly).state,
    "open"
  );
  assert.equal(openingStatus("Chưa rõ", mondayMorning).state, "unknown");
});

test("Planner Health does not diagnose friction from a tiny sample", () => {
  const insight = derivePlannerHealth(
    plannerMetrics({
      activeDays: 3,
      generated: 5,
      initialGenerated: 5,
      started: 1,
      startRate: 20
    })
  );

  assert.equal(insight.state, "collecting");
  assert.equal(insight.confidence, "low");
});

test("Planner Health separates pre-start and completion friction", () => {
  const preStart = derivePlannerHealth(
    plannerMetrics({
      activeDays: 5,
      generated: 12,
      initialGenerated: 10,
      rerolled: 2,
      started: 3,
      startRate: 30,
      rerollRate: 20
    })
  );
  assert.equal(preStart.state, "pre_start_friction");

  const completion = derivePlannerHealth(
    plannerMetrics({
      activeDays: 5,
      generated: 10,
      initialGenerated: 10,
      started: 6,
      completed: 2,
      startRate: 60,
      completionRate: 33,
      cancelRate: 50
    })
  );
  assert.equal(completion.state, "completion_friction");
});

test("Planner Health recognizes replay value only with enough started plans", () => {
  const insight = derivePlannerHealth(
    plannerMetrics({
      activeDays: 6,
      generated: 10,
      initialGenerated: 10,
      started: 8,
      completed: 6,
      replayed: 3,
      startRate: 80,
      completionRate: 75,
      replayRate: 38
    })
  );

  assert.equal(insight.state, "replay_value");
});

test("replay replaces an old stop that is closed at the planned time", () => {
  const oldPlace = place({
    id: "old-closed",
    name: "Cafe cũ",
    match: 99,
    openUntil: "Mo 08:00-10:00"
  });
  const alternative = place({
    id: "new-open",
    name: "Cafe thay thế",
    match: 78,
    openUntil: "24/7"
  });

  const plan = buildEveningPlan({
    places: [oldPlace, alternative],
    preferences,
    signals,
    origin: {
      latitude: 21.0278,
      longitude: 105.8342
    },
    replayTemplate: replayTemplate(oldPlace)
  });

  assert.ok(plan);
  assert.equal(plan.stops[0]?.place.id, alternative.id);
  assert.equal(plan.replay?.replacedStopCount, 1);
  assert.match(
    plan.replay?.replacements[0]?.reason ?? "",
    /đóng cửa/
  );
});

test("replay replaces an old stop that no longer fits budget", () => {
  const expensive = place({
    id: "old-expensive",
    name: "Cafe cũ đắt",
    match: 99,
    averageForTwo: "650000",
    priceLabel: "$$$"
  });
  const affordable = place({
    id: "new-affordable",
    name: "Cafe vừa budget",
    match: 75,
    averageForTwo: "150000"
  });

  const plan = buildEveningPlan({
    places: [expensive, affordable],
    preferences,
    signals,
    origin: {
      latitude: 21.0278,
      longitude: 105.8342
    },
    replayTemplate: replayTemplate(expensive)
  });

  assert.ok(plan);
  assert.equal(plan.stops[0]?.place.id, affordable.id);
  assert.match(
    plan.replay?.replacements[0]?.reason ?? "",
    /budget/
  );
});

test("valid replay keeps the original stop and replay metadata stays ephemeral", () => {
  const original = place({
    id: "old-valid",
    name: "Cafe cũ vẫn hợp",
    match: 96
  });
  const alternative = place({
    id: "new-valid",
    name: "Cafe khác",
    match: 62
  });

  const plan = buildEveningPlan({
    places: [original, alternative],
    preferences,
    signals,
    origin: {
      latitude: 21.0278,
      longitude: 105.8342
    },
    replayTemplate: replayTemplate(original)
  });

  assert.ok(plan);
  assert.equal(plan.stops[0]?.place.id, original.id);
  assert.equal(plan.replay?.replacedStopCount, 0);
  assert.deepEqual(plan.replay?.retainedStopIds, [original.id]);

  const snapshot = toActivePlanSnapshot(plan);
  assert.equal("replay" in snapshot, false);
  assert.ok(snapshot.quality);
});
