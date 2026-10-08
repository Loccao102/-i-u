import assert from "node:assert/strict";
import test from "node:test";

import { openingStatus } from "../../src/lib/opening-hours";
import { comparisonCost, comparisonHighlights, sortComparisonPlaces } from "../../src/lib/comparison";
import { filterPlaces } from "../../src/lib/search";
import {
  deriveGroupPollOutcome,
  groupPollCandidateFromPlace,
  isGroupPollOpen,
  parseGroupPollCandidates
} from "../../src/lib/group-poll";
import {
  buildGroupPollPlannerHref,
  groupPollPlannerScenario,
  parseGroupPollPlanAnchor
} from "../../src/lib/group-poll-handoff";
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
  const { id, name, ...overrides } = input;

  return {
    id,
    name,
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
    ...overrides
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

test("planner keeps a valid anchored place even when another candidate scores higher", () => {
  const anchor = place({
    id: "anchor-cafe",
    name: "Cafe cả nhóm chọn",
    match: 55
  });
  const higherScore = place({
    id: "high-score-cafe",
    name: "Cafe điểm cao hơn",
    match: 99
  });

  const plan = buildEveningPlan({
    places: [higherScore, anchor],
    preferences,
    signals,
    origin: {
      latitude: 21.0278,
      longitude: 105.8342
    },
    anchorPlaceId: anchor.id
  });

  assert.ok(plan);
  assert.equal(plan.stops[0]?.place.id, anchor.id);
});

test("planner does not force an anchored place through opening-hours guardrails", () => {
  const closedAnchor = place({
    id: "anchor-closed",
    name: "Cafe poll đã đóng cửa",
    match: 99,
    openUntil: "Mo 08:00-10:00"
  });
  const fallback = place({
    id: "anchor-fallback",
    name: "Cafe fallback",
    match: 70,
    openUntil: "24/7"
  });

  const plan = buildEveningPlan({
    places: [closedAnchor, fallback],
    preferences,
    signals,
    origin: {
      latitude: 21.0278,
      longitude: 105.8342
    },
    anchorPlaceId: closedAnchor.id
  });

  assert.ok(plan);
  assert.equal(plan.stops[0]?.place.id, fallback.id);
});



test("group poll lifecycle closes on manual close or expiry", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");

  assert.equal(
    isGroupPollOpen(
      {
        closedAt: null,
        expiresAt: "2026-10-06T12:00:01.000Z"
      },
      now
    ),
    true
  );
  assert.equal(
    isGroupPollOpen(
      {
        closedAt: "2026-10-06T11:59:00.000Z",
        expiresAt: "2026-10-07T12:00:00.000Z"
      },
      now
    ),
    false
  );
  assert.equal(
    isGroupPollOpen(
      {
        closedAt: null,
        expiresAt: "2026-10-06T12:00:00.000Z"
      },
      now
    ),
    false
  );
  assert.equal(
    isGroupPollOpen(
      {
        closedAt: null,
        expiresAt: "not-a-date"
      },
      now
    ),
    false
  );
});

test("group poll candidates keep validation and dedupe guardrails", () => {
  const candidates = parseGroupPollCandidates([
    {
      placeId: " cafe-a ",
      name: " Cafe A ",
      kind: "Cafe",
      latitude: "95",
      longitude: "200",
      address: "  Hà Nội  ",
      averageForTwo: "150000",
      publicRating: 7,
      match: 105
    },
    {
      placeId: "cafe-b",
      name: "Cafe B",
      kind: "Cafe",
      latitude: 21.03,
      longitude: 105.84,
      address: "",
      averageForTwo: "200000",
      publicRating: 4.4,
      match: 82
    }
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.placeId, "cafe-a");
  assert.equal(candidates[0]?.name, "Cafe A");
  assert.equal(candidates[0]?.latitude, 90);
  assert.equal(candidates[0]?.longitude, 180);
  assert.equal(candidates[0]?.publicRating, 5);
  assert.equal(candidates[0]?.match, 100);

  assert.throws(
    () =>
      parseGroupPollCandidates([
        candidates[0],
        {
          ...candidates[1],
          placeId: candidates[0]!.placeId
        }
      ]),
    /INVALID_BODY/
  );
});

test("group poll outcome distinguishes no-vote winner and tie", () => {
  const first = groupPollCandidateFromPlace(
    place({ id: "poll-a", name: "Cafe A" })
  );
  const second = groupPollCandidateFromPlace(
    place({ id: "poll-b", name: "Cafe B" })
  );

  const empty = deriveGroupPollOutcome([
    { ...first, votes: 0 },
    { ...second, votes: 0 }
  ]);
  assert.equal(empty.state, "no_votes");
  assert.equal(empty.leaderVotes, 0);
  assert.equal(empty.leaders.length, 0);

  const winner = deriveGroupPollOutcome([
    { ...first, votes: 3 },
    { ...second, votes: 1 }
  ]);
  assert.equal(winner.state, "winner");
  assert.equal(winner.leaderVotes, 3);
  assert.equal(winner.leaders[0]?.placeId, first.placeId);

  const tie = deriveGroupPollOutcome([
    { ...first, votes: 2 },
    { ...second, votes: 2 }
  ]);
  assert.equal(tie.state, "tie");
  assert.deepEqual(
    tie.leaders.map((candidate) => candidate.placeId),
    [first.placeId, second.placeId]
  );
});


test("group poll planner handoff round-trips a winner into an anchor", () => {
  const candidate = {
    ...groupPollCandidateFromPlace(
      place({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Bếp Nhà",
        kind: "Nhà hàng",
        latitude: 21.028,
        longitude: 105.835,
        address: "12 Tràng Tiền, Hà Nội",
        averageForTwo: "420000",
        publicRating: 4.7,
        match: 91
      })
    ),
    votes: 4
  };

  const href = buildGroupPollPlannerHref("abcdefghijklmnop", candidate);
  const query = href.slice(href.indexOf("?") + 1);
  const anchor = parseGroupPollPlanAnchor(new URLSearchParams(query));

  assert.ok(anchor);
  assert.equal(anchor.id, candidate.placeId);
  assert.equal(anchor.name, candidate.name);
  assert.equal(anchor.kind, candidate.kind);
  assert.equal(anchor.latitude, candidate.latitude);
  assert.equal(anchor.longitude, candidate.longitude);
  assert.equal(anchor.address, candidate.address);
  assert.equal(anchor.averageForTwo, candidate.averageForTwo);
  assert.equal(anchor.publicRating, candidate.publicRating);
  assert.equal(anchor.match, candidate.match);
  assert.equal(anchor.source, "personal");
  assert.equal(groupPollPlannerScenario(anchor), "food");
});

test("group poll planner handoff preserves provider identity safely", () => {
  const candidate = {
    ...groupPollCandidateFromPlace(
      place({
        id: "provider:google-place-123",
        name: "Workshop Space",
        kind: "Workshop",
        latitude: 21.02,
        longitude: 105.83
      })
    ),
    votes: 2
  };

  const href = buildGroupPollPlannerHref("abcdefghijklmnop", candidate);
  const query = href.slice(href.indexOf("?") + 1);
  const anchor = parseGroupPollPlanAnchor(
    new URLSearchParams(query),
    () => "22222222-2222-4222-8222-222222222222"
  );

  assert.ok(anchor);
  assert.equal(anchor.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(anchor.providerId, "google-place-123");
  assert.equal(anchor.source, "provider");
  assert.equal(groupPollPlannerScenario(anchor), "fun");
});

test("group poll planner handoff rejects incomplete or invalid coordinates", () => {
  assert.equal(
    parseGroupPollPlanAnchor(
      new URLSearchParams({
        anchorName: "Cafe A",
        anchorLat: "21",
        anchorLng: "105"
      })
    ),
    null
  );

  assert.equal(
    parseGroupPollPlanAnchor(
      new URLSearchParams({
        fromPoll: "abcdefghijklmnop",
        anchorName: "Cafe A",
        anchorLat: "91",
        anchorLng: "105"
      })
    ),
    null
  );

  assert.equal(
    parseGroupPollPlanAnchor(
      new URLSearchParams({
        fromPoll: "abcdefghijklmnop",
        anchorName: "A",
        anchorLat: "21",
        anchorLng: "105"
      })
    ),
    null
  );
});


test("POI distance uses the viewed search area without GPS, not a zero-km placeholder", () => {
  const poi = place({
    id: "geoapify-cafe",
    name: "Cafe cách tâm khoảng 1 km",
    source: "provider",
    latitude: 21.0278,
    longitude: 105.8442,
    distanceKm: 0
  });
  const searchCenter = { latitude: 21.0278, longitude: 105.8342 };

  const [withoutGps] = filterPlaces(
    [poi], "", "all", null, signals, undefined, undefined, undefined, searchCenter
  );
  assert.ok(withoutGps.distanceKm > 0.9);
  assert.ok(withoutGps.distanceKm < 1.2);
  assert.ok(withoutGps.recommendationReasons.includes("Gần tâm vùng tìm kiếm"));
  assert.ok(!withoutGps.recommendationReasons.includes("Rất gần bạn"));

  const [withGps] = filterPlaces(
    [poi], "", "all", { latitude: poi.latitude, longitude: poi.longitude },
    signals, undefined, undefined, undefined, searchCenter
  );
  assert.equal(withGps.distanceKm, 0);
  assert.ok(withGps.recommendationReasons.includes("Rất gần bạn"));
});


test("comparison sorts by match, distance, and known costs without inventing prices", () => {
  const pricey = place({
    id: "pricey",
    name: "Đắt mà hợp gu",
    match: 95,
    distanceKm: 4,
    averageForTwo: "500k",
    costSource: "provider_estimate"
  });
  const cheap = place({
    id: "cheap",
    name: "Giá rẻ hơn",
    match: 81,
    distanceKm: 1,
    averageForTwo: "180k",
    costSource: "user"
  });
  const unknown = place({
    id: "unknown",
    name: "Chưa xác định giá",
    match: 90,
    distanceKm: 6,
    costSource: "unknown",
    averageForTwo: "Chưa có dữ liệu"
  });
  const options = [pricey, unknown, cheap];
  assert.deepEqual(sortComparisonPlaces(options, "match").map(p => p.id), ["pricey", "unknown", "cheap"]);
  assert.deepEqual(sortComparisonPlaces(options, "distance").map(p => p.id), ["cheap", "pricey", "unknown"]);
  assert.deepEqual(sortComparisonPlaces(options, "cost").map(p => p.id), ["cheap", "pricey", "unknown"]);
  assert.equal(comparisonCost(unknown), null);
  assert.equal(comparisonCost(pricey), 500000);
  assert.deepEqual(comparisonHighlights(options), {
    matchId: "pricey",
    distanceId: "cheap",
    costId: "cheap"
  });
});

test("comparison keeps original order for matching values", () => {
  const b = place({ id: "b", name: "B", match: 70, distanceKm: 2, costSource: "unknown" });
  const a = place({ id: "a", name: "A", match: 70, distanceKm: 2, costSource: "unknown" });
  assert.deepEqual(sortComparisonPlaces([b, a], "match").map(p => p.id), ["b", "a"]);
  assert.deepEqual(sortComparisonPlaces([b, a], "cost").map(p => p.id), ["b", "a"]);
  assert.equal(comparisonHighlights([b, a]).costId, null);
});
