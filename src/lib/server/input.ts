import "server-only";

import { randomUUID } from "node:crypto";
import type {
  Collection,
  PersonalBackup,
  PersonalRating,
  PersonalSnapshot,
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

  return {
    version: 2,
    customPlaces,
    savedIds,
    ratings,
    visits,
    collections
  };
}
