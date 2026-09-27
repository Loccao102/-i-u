import "server-only";

import { randomUUID } from "node:crypto";
import type {
  ActivePlanSnapshot,
  Collection,
  DailyDiscoveryRecord,
  PersonalBackup,
  PersonalRating,
  PersonalSnapshot,
  RecommendationFeedback,
  RecommendationFeedbackReason,
  Place,
  RatingDraft,
  Scenario,
  VisitRecord
} from "../types";
import { cleanPlainText } from "../validation";

const scenarios = new Set<Scenario>([
  "date",
  "friends",
  "food",
  "coffee",
  "fun",
  "chill"
]);

function finiteNumber(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error("INVALID_BODY");
  }
  return number;
}

function stringValue(value: unknown, max: number, required = false) {
  const result =
    typeof value === "string" ? cleanPlainText(value, max) : "";
  if (required && !result) throw new Error("INVALID_BODY");
  return result;
}

function scenarioList(value: unknown): Scenario[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (item): item is Scenario =>
          typeof item === "string" &&
          scenarios.has(item as Scenario)
      )
    )
  ).slice(0, 6);
}

export function parsePlace(
  body: Record<string, unknown>,
  forcedId?: string
): Place {
  const id = forcedId ?? stringValue(body.id, 80, true);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("INVALID_BODY");
  }

  const priceLabel =
    body.priceLabel === "$" ||
    body.priceLabel === "$$" ||
    body.priceLabel === "$$$"
      ? body.priceLabel
      : "$$";

  const noise =
    body.noise === "Yên" ||
    body.noise === "Vừa" ||
    body.noise === "Sôi động"
      ? body.noise
      : "Vừa";

  const crowd =
    body.crowd === "Vắng" ||
    body.crowd === "Vừa" ||
    body.crowd === "Đông"
      ? body.crowd
      : "Vừa";

  const source =
    body.source === "provider" ? "provider" : "personal";

  const tags = Array.isArray(body.tags)
    ? Array.from(
        new Set(
          body.tags
            .filter((item): item is string => typeof item === "string")
            .map((item) => cleanPlainText(item, 40))
            .filter(Boolean)
        )
      ).slice(0, 12)
    : [];

  return {
    id,
    name: stringValue(body.name, 100, true),
    kind: stringValue(body.kind, 80) || "Địa điểm của bạn",
    description: stringValue(body.description, 500),
    latitude: finiteNumber(body.latitude, -90, 90),
    longitude: finiteNumber(body.longitude, -180, 180),
    distanceKm: finiteNumber(body.distanceKm ?? 0, 0, 50000),
    priceLabel,
    averageForTwo:
      stringValue(body.averageForTwo, 100) || "Chưa có dữ liệu",
    publicRating: finiteNumber(body.publicRating ?? 0, 0, 5),
    match: Math.round(finiteNumber(body.match ?? 80, 0, 100)),
    communityNote: stringValue(body.communityNote, 180),
    openUntil: stringValue(body.openUntil, 60) || "Chưa rõ",
    bestTime: stringValue(body.bestTime, 100) || "Chưa có dữ liệu",
    noise,
    crowd,
    tags,
    scenarios: scenarioList(body.scenarios),
    note: stringValue(body.note, 500),
    accent:
      /^#[0-9a-f]{6}$/i.test(String(body.accent ?? ""))
        ? String(body.accent)
        : "#ff6b5e",
    source,
    providerId:
      source === "provider"
        ? stringValue(body.providerId, 160, true)
        : undefined,
    address: stringValue(body.address, 260) || undefined
  };
}

export function parseRating(
  placeId: string,
  body: Record<string, unknown>
): PersonalRating {
  const stars = Math.round(finiteNumber(body.stars, 1, 5));
  const revisit =
    body.revisit === "yes" ||
    body.revisit === "maybe" ||
    body.revisit === "no"
      ? body.revisit
      : "maybe";

  const now = new Date().toISOString();
  const requestedVisitedAt =
    typeof body.visitedAt === "string"
      ? new Date(body.visitedAt)
      : new Date();

  const visitedAt = Number.isNaN(requestedVisitedAt.getTime())
    ? now
    : requestedVisitedAt.toISOString();

  return {
    placeId,
    stars,
    revisit,
    contexts: scenarioList(body.contexts),
    note: stringValue(body.note, 240),
    visitedAt,
    updatedAt: now
  };
}

export function parseRatingDraft(
  body: Record<string, unknown>
): RatingDraft {
  return {
    stars: Math.round(finiteNumber(body.stars, 1, 5)),
    revisit:
      body.revisit === "yes" ||
      body.revisit === "maybe" ||
      body.revisit === "no"
        ? body.revisit
        : "maybe",
    contexts: scenarioList(body.contexts),
    note: stringValue(body.note, 240)
  };
}

export function parseRecommendationFeedback(
  placeId: string,
  body: Record<string, unknown>
): RecommendationFeedback {
  const reason = body.reason;
  const allowed = new Set<RecommendationFeedbackReason>([
    "not_taste",
    "not_now",
    "too_far",
    "too_expensive"
  ]);

  if (typeof reason !== "string" || !allowed.has(reason as RecommendationFeedbackReason)) {
    throw new Error("INVALID_BODY");
  }

  const scenario =
    typeof body.scenario === "string" && scenarios.has(body.scenario as Scenario)
      ? (body.scenario as Scenario)
      : null;

  const distanceKm =
    body.distanceKm === null || body.distanceKm === undefined
      ? null
      : finiteNumber(body.distanceKm, 0, 50000);

  const now = new Date().toISOString();

  return {
    placeId,
    reason: reason as RecommendationFeedbackReason,
    scenario,
    distanceKm,
    createdAt: now,
    updatedAt: now
  };
}

export function parseCollection(body: Record<string, unknown>) {
  return {
    name: stringValue(body.name, 60, true),
    description: stringValue(body.description, 180)
  };
}

export function parseBoolean(value: unknown) {
  if (typeof value !== "boolean") throw new Error("INVALID_BODY");
  return value;
}

export function newOpaqueId() {
  return randomUUID();
}


function objectValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_BODY");
  }
  return value as Record<string, unknown>;
}

function boundedId(value: unknown, max = 80) {
  const id = stringValue(value, max, true);
  if (!/^[A-Za-z0-9:_-]+$/.test(id)) {
    throw new Error("INVALID_BODY");
  }
  return id;
}

function uuidValue(value: unknown) {
  const id = stringValue(value, 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("INVALID_BODY");
  }
  return id;
}

function isoDate(value: unknown) {
  if (typeof value !== "string") throw new Error("INVALID_BODY");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_BODY");
  return date.toISOString();
}

function dateOnly(value: unknown) {
  const raw = stringValue(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("INVALID_BODY");
  }

  const parsed = new Date(raw + "T00:00:00Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== raw
  ) {
    throw new Error("INVALID_BODY");
  }

  return raw;
}

export function parsePersonalBackup(value: unknown): PersonalSnapshot {
  const envelope = objectValue(value);
  if (
    envelope.format !== "di-dau-personal-backup" ||
    envelope.version !== 1
  ) {
    throw new Error("INVALID_BODY");
  }

  const data = objectValue(envelope.data);

  const rawPlaces = Array.isArray(data.customPlaces)
    ? data.customPlaces.slice(0, 1000)
    : [];
  if (
    Array.isArray(data.customPlaces) &&
    data.customPlaces.length > 1000
  ) {
    throw new Error("INVALID_BODY");
  }

  const customPlaces = rawPlaces.map((item) =>
    parsePlace(objectValue(item))
  );

  const rawSaved = Array.isArray(data.savedIds) ? data.savedIds : [];
  if (rawSaved.length > 5000) throw new Error("INVALID_BODY");
  const savedIds = Array.from(
    new Set(rawSaved.map((item) => boundedId(item)))
  );

  const ratings: Record<string, PersonalRating> = {};
  const rawRatings =
    data.ratings && typeof data.ratings === "object" && !Array.isArray(data.ratings)
      ? (data.ratings as Record<string, unknown>)
      : {};
  const ratingEntries = Object.entries(rawRatings);
  if (ratingEntries.length > 5000) throw new Error("INVALID_BODY");

  for (const [placeIdRaw, ratingRaw] of ratingEntries) {
    const placeId = boundedId(placeIdRaw);
    const rating = objectValue(ratingRaw);
    ratings[placeId] = {
      ...parseRating(placeId, rating),
      visitedAt: isoDate(rating.visitedAt),
      updatedAt: isoDate(rating.updatedAt ?? rating.visitedAt)
    };
  }

  const recommendationFeedbacks: Record<
    string,
    RecommendationFeedback
  > = {};
  const rawFeedbacks =
    data.recommendationFeedbacks &&
    typeof data.recommendationFeedbacks === "object" &&
    !Array.isArray(data.recommendationFeedbacks)
      ? (data.recommendationFeedbacks as Record<string, unknown>)
      : {};

  const feedbackEntries = Object.entries(rawFeedbacks);
  if (feedbackEntries.length > 5000) throw new Error("INVALID_BODY");

  for (const [placeIdRaw, feedbackRaw] of feedbackEntries) {
    const placeId = boundedId(placeIdRaw);
    const feedback = objectValue(feedbackRaw);
    const parsed = parseRecommendationFeedback(placeId, feedback);

    recommendationFeedbacks[placeId] = {
      ...parsed,
      createdAt: isoDate(feedback.createdAt ?? feedback.updatedAt),
      updatedAt: isoDate(feedback.updatedAt ?? feedback.createdAt)
    };
  }

  const rawVisits = Array.isArray(data.visits) ? data.visits : [];
  if (rawVisits.length > 5000) throw new Error("INVALID_BODY");
  const visits: VisitRecord[] = rawVisits.map((item) => {
    const row = objectValue(item);
    const ratingStars =
      row.ratingStars === null || row.ratingStars === undefined
        ? null
        : Math.round(finiteNumber(row.ratingStars, 1, 5));

    return {
      id: uuidValue(row.id),
      placeId: boundedId(row.placeId),
      visitedAt: isoDate(row.visitedAt),
      ratingStars
    };
  });

  const rawCollections = Array.isArray(data.collections)
    ? data.collections
    : [];
  if (rawCollections.length > 200) throw new Error("INVALID_BODY");

  const collections: Collection[] = rawCollections.map((item) => {
    const row = objectValue(item);
    const rawPlaceIds = Array.isArray(row.placeIds) ? row.placeIds : [];
    if (rawPlaceIds.length > 1000) throw new Error("INVALID_BODY");

    return {
      id: uuidValue(row.id),
      name: stringValue(row.name, 60, true),
      description: stringValue(row.description, 180),
      placeIds: Array.from(
        new Set(rawPlaceIds.map((placeId) => boundedId(placeId)))
      ),
      createdAt: isoDate(row.createdAt),
      updatedAt: isoDate(row.updatedAt)
    };
  });

  const rawDailyDiscoveries = Array.isArray(data.dailyDiscoveries)
    ? data.dailyDiscoveries
    : [];
  if (rawDailyDiscoveries.length > 120) {
    throw new Error("INVALID_BODY");
  }

  const dailyDiscoveries: DailyDiscoveryRecord[] =
    rawDailyDiscoveries.map((item) => {
      const row = objectValue(item);
      const kind =
        row.kind === "place" || row.kind === "route"
          ? row.kind
          : null;
      if (!kind) throw new Error("INVALID_BODY");

      const rawPlaceKeys = Array.isArray(row.placeKeys)
        ? row.placeKeys
        : [];
      if (rawPlaceKeys.length < 1 || rawPlaceKeys.length > 3) {
        throw new Error("INVALID_BODY");
      }

      const placeKeys = Array.from(
        new Set(
          rawPlaceKeys.map((key) => stringValue(key, 180, true))
        )
      );
      if (placeKeys.length < 1 || placeKeys.length > 3) {
        throw new Error("INVALID_BODY");
      }

      const scenario =
        typeof row.scenario === "string" &&
        scenarios.has(row.scenario as Scenario)
          ? (row.scenario as Scenario)
          : null;

      return {
        day: dateOnly(row.day),
        kind,
        placeKeys,
        scenario,
        createdAt: isoDate(row.createdAt),
        updatedAt: isoDate(row.updatedAt ?? row.createdAt)
      };
    });

  return {
    version: 3,
    customPlaces,
    savedIds,
    ratings,
    recommendationFeedbacks,
    visits,
    collections,
    dailyDiscoveries
  };
}


function planStage(
  value: unknown
): ActivePlanSnapshot["stops"][number]["stage"] {
  if (value === "food" || value === "activity" || value === "coffee") {
    return value;
  }
  throw new Error("INVALID_BODY");
}

function clockValue(value: unknown) {
  const result = stringValue(value, 5, true);
  const match = /^(\d{2}):(\d{2})$/.exec(result);
  if (!match) throw new Error("INVALID_BODY");

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error("INVALID_BODY");
  }

  return result;
}

export function parseActivePlanSnapshot(value: unknown): ActivePlanSnapshot {
  const root = objectValue(value);
  const rawStops = Array.isArray(root.stops) ? root.stops : [];

  if (rawStops.length < 1 || rawStops.length > 3) {
    throw new Error("INVALID_BODY");
  }

  const seen = new Set<string>();
  const stops = rawStops.map((item) => {
    const row = objectValue(item);
    const placeId = boundedId(row.placeId);

    if (seen.has(placeId)) throw new Error("INVALID_BODY");
    seen.add(placeId);

    return {
      placeId,
      name: stringValue(row.name, 100, true),
      latitude: finiteNumber(row.latitude, -90, 90),
      longitude: finiteNumber(row.longitude, -180, 180),
      stage: planStage(row.stage),
      stageLabel: stringValue(row.stageLabel, 40, true),
      startTime: clockValue(row.startTime),
      endTime: clockValue(row.endTime),
      estimatedCostForTwo: Math.round(
        finiteNumber(row.estimatedCostForTwo, 0, 20_000_000)
      ),
      travelKmFromPrevious: finiteNumber(
        row.travelKmFromPrevious,
        0,
        200
      ),
      travelMinutesFromPrevious: Math.round(
        finiteNumber(row.travelMinutesFromPrevious, 0, 240)
      ),
      match: Math.round(finiteNumber(row.match, 0, 100)),
      reason: stringValue(row.reason, 220)
    };
  });

  return {
    summary: stringValue(root.summary, 180, true),
    totalEstimatedCostForTwo: Math.round(
      finiteNumber(root.totalEstimatedCostForTwo, 0, 60_000_000)
    ),
    budgetRemainingForTwo: Math.round(
      finiteNumber(root.budgetRemainingForTwo, -60_000_000, 60_000_000)
    ),
    routeKm: finiteNumber(root.routeKm, 0, 500),
    totalDurationMinutes: Math.round(
      finiteNumber(root.totalDurationMinutes, 1, 24 * 60)
    ),
    averageMatch: Math.round(finiteNumber(root.averageMatch, 0, 100)),
    stops
  };
}
