import "server-only";

import { randomUUID } from "node:crypto";
import type {
  PersonalRating,
  Place,
  RatingDraft,
  Scenario
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
