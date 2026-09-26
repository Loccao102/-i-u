import "server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "./sqlite";
import type {
  Collection,
  PersonalRating,
  PersonalSnapshot,
  Place,
  Scenario,
  VisitRecord
} from "../types";

type DbPlaceRow = {
  id: string;
  name: string;
  kind: string;
  description: string;
  latitude: number;
  longitude: number;
  distance_km: number;
  price_label: "$" | "$$" | "$$$";
  average_for_two: string;
  public_rating: number;
  match_score: number;
  community_note: string;
  open_until: string;
  best_time: string;
  noise: Place["noise"];
  crowd: Place["crowd"];
  tags_json: string;
  scenarios_json: string;
  note: string;
  accent: string;
  source: string;
  provider_id: string | null;
  address: string | null;
};

function safeStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function mapPlace(row: DbPlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceKm: row.distance_km,
    priceLabel: row.price_label,
    averageForTwo: row.average_for_two,
    publicRating: row.public_rating,
    match: row.match_score,
    communityNote: row.community_note,
    openUntil: row.open_until,
    bestTime: row.best_time,
    noise: row.noise,
    crowd: row.crowd,
    tags: safeStringArray(row.tags_json),
    scenarios: safeStringArray(row.scenarios_json) as Scenario[],
    note: row.note,
    accent: row.accent,
    source: row.source === "PROVIDER" ? "provider" : "personal",
    providerId: row.provider_id ?? undefined,
    address: row.address ?? undefined
  };
}

function listPlaces(ownerKey: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT *
         FROM personal_places
         WHERE owner_key = ?
         ORDER BY updated_at DESC
         LIMIT 1000`
      )
      .all(ownerKey) as unknown as DbPlaceRow[]
  ).map(mapPlace);
}

function listSaved(ownerKey: string) {
  return (
    getDatabase()
      .prepare(
        `SELECT place_id
         FROM saved_places
         WHERE owner_key = ?
         ORDER BY created_at DESC
         LIMIT 5000`
      )
      .all(ownerKey) as unknown as Array<{ place_id: string }>
  ).map((row) => row.place_id);
}

function listRatings(ownerKey: string) {
  const rows = getDatabase()
    .prepare(
      `SELECT place_id, stars, revisit, contexts_json, note, visited_at, updated_at
       FROM personal_ratings
       WHERE owner_key = ?`
    )
    .all(ownerKey) as unknown as Array<{
    place_id: string;
    stars: number;
    revisit: PersonalRating["revisit"];
    contexts_json: string;
    note: string;
    visited_at: string;
    updated_at: string;
  }>;

  const result: Record<string, PersonalRating> = {};
  for (const row of rows) {
    result[row.place_id] = {
      placeId: row.place_id,
      stars: row.stars,
      revisit: row.revisit,
      contexts: safeStringArray(row.contexts_json) as Scenario[],
      note: row.note,
      visitedAt: row.visited_at,
      updatedAt: row.updated_at
    };
  }
  return result;
}

function listVisits(ownerKey: string) {
  return getDatabase()
    .prepare(
      `SELECT id, place_id, visited_at, rating_stars
       FROM visits
       WHERE owner_key = ?
       ORDER BY visited_at DESC
       LIMIT 5000`
    )
    .all(ownerKey) as unknown as VisitRecord[];
}

function listCollections(ownerKey: string): Collection[] {
  const collections = getDatabase()
    .prepare(
      `SELECT id, name, description, created_at, updated_at
       FROM collections
       WHERE owner_key = ?
       ORDER BY updated_at DESC
       LIMIT 200`
    )
    .all(ownerKey) as unknown as Array<{
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
  }>;

  const links = getDatabase()
    .prepare(
      `SELECT collection_id, place_id
       FROM collection_places
       WHERE owner_key = ?`
    )
    .all(ownerKey) as unknown as Array<{
    collection_id: string;
    place_id: string;
  }>;

  const byCollection = new Map<string, string[]>();
  for (const link of links) {
    const items = byCollection.get(link.collection_id) ?? [];
    items.push(link.place_id);
    byCollection.set(link.collection_id, items);
  }

  return collections.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    placeIds: byCollection.get(item.id) ?? [],
    createdAt: item.created_at,
    updatedAt: item.updated_at
  }));
}

export function getPersonalSnapshot(ownerKey: string): PersonalSnapshot {
  return {
    version: 2,
    customPlaces: listPlaces(ownerKey),
    savedIds: listSaved(ownerKey),
    ratings: listRatings(ownerKey),
    visits: listVisits(ownerKey),
    collections: listCollections(ownerKey)
  };
}

export function upsertPlace(ownerKey: string, place: Place) {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `INSERT INTO personal_places (
         owner_key, id, name, kind, description, latitude, longitude,
         distance_km, price_label, average_for_two, public_rating,
         match_score, community_note, open_until, best_time, noise, crowd,
         tags_json, scenarios_json, note, accent, source, provider_id,
         address, created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?
       )
       ON CONFLICT(owner_key, id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         description = excluded.description,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         distance_km = excluded.distance_km,
         price_label = excluded.price_label,
         average_for_two = excluded.average_for_two,
         public_rating = excluded.public_rating,
         match_score = excluded.match_score,
         community_note = excluded.community_note,
         open_until = excluded.open_until,
         best_time = excluded.best_time,
         noise = excluded.noise,
         crowd = excluded.crowd,
         tags_json = excluded.tags_json,
         scenarios_json = excluded.scenarios_json,
         note = excluded.note,
         accent = excluded.accent,
         source = excluded.source,
         provider_id = excluded.provider_id,
         address = excluded.address,
         updated_at = excluded.updated_at`
    )
    .run(
      ownerKey,
      place.id,
      place.name,
      place.kind,
      place.description,
      place.latitude,
      place.longitude,
      place.distanceKm,
      place.priceLabel,
      place.averageForTwo,
      place.publicRating,
      place.match,
      place.communityNote,
      place.openUntil,
      place.bestTime,
      place.noise,
      place.crowd,
      JSON.stringify(place.tags),
      JSON.stringify(place.scenarios),
      place.note,
      place.accent,
      place.source === "provider" ? "PROVIDER" : "PERSONAL",
      place.providerId ?? null,
      place.address ?? null,
      now,
      now
    );

  return place;
}

export function deletePlace(ownerKey: string, placeId: string) {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");

  try {
    db.prepare(
      "DELETE FROM collection_places WHERE owner_key = ? AND place_id = ?"
    ).run(ownerKey, placeId);
    db.prepare(
      "DELETE FROM saved_places WHERE owner_key = ? AND place_id = ?"
    ).run(ownerKey, placeId);
    db.prepare(
      "DELETE FROM personal_ratings WHERE owner_key = ? AND place_id = ?"
    ).run(ownerKey, placeId);
    db.prepare(
      "DELETE FROM visits WHERE owner_key = ? AND place_id = ?"
    ).run(ownerKey, placeId);
    const result = db
      .prepare(
        "DELETE FROM personal_places WHERE owner_key = ? AND id = ?"
      )
      .run(ownerKey, placeId);
    db.exec("COMMIT");
    return result.changes > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setSaved(ownerKey: string, placeId: string, saved: boolean) {
  if (saved) {
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO saved_places (owner_key, place_id, created_at)
         VALUES (?, ?, ?)`
      )
      .run(ownerKey, placeId, new Date().toISOString());
  } else {
    getDatabase()
      .prepare(
        "DELETE FROM saved_places WHERE owner_key = ? AND place_id = ?"
      )
      .run(ownerKey, placeId);
  }
}

export function saveRating(ownerKey: string, rating: PersonalRating) {
  getDatabase()
    .prepare(
      `INSERT INTO personal_ratings (
         owner_key, place_id, stars, revisit, contexts_json, note,
         visited_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_key, place_id) DO UPDATE SET
         stars = excluded.stars,
         revisit = excluded.revisit,
         contexts_json = excluded.contexts_json,
         note = excluded.note,
         visited_at = excluded.visited_at,
         updated_at = excluded.updated_at`
    )
    .run(
      ownerKey,
      rating.placeId,
      rating.stars,
      rating.revisit,
      JSON.stringify(rating.contexts),
      rating.note,
      rating.visitedAt,
      rating.updatedAt
    );
}

export function addVisit(
  ownerKey: string,
  placeId: string,
  ratingStars: number | null,
  visitedAt = new Date().toISOString()
): VisitRecord {
  const visit: VisitRecord = {
    id: randomUUID(),
    placeId,
    visitedAt,
    ratingStars
  };

  getDatabase()
    .prepare(
      `INSERT INTO visits (
         owner_key, id, place_id, visited_at, rating_stars, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      ownerKey,
      visit.id,
      visit.placeId,
      visit.visitedAt,
      visit.ratingStars,
      new Date().toISOString()
    );

  return visit;
}

export function createCollection(
  ownerKey: string,
  name: string,
  description: string
): Collection {
  const now = new Date().toISOString();
  const item: Collection = {
    id: randomUUID(),
    name,
    description,
    placeIds: [],
    createdAt: now,
    updatedAt: now
  };

  getDatabase()
    .prepare(
      `INSERT INTO collections (
         owner_key, id, name, description, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(ownerKey, item.id, item.name, item.description, now, now);

  return item;
}

export function updateCollection(
  ownerKey: string,
  collectionId: string,
  name: string,
  description: string
) {
  const result = getDatabase()
    .prepare(
      `UPDATE collections
       SET name = ?, description = ?, updated_at = ?
       WHERE owner_key = ? AND id = ?`
    )
    .run(
      name,
      description,
      new Date().toISOString(),
      ownerKey,
      collectionId
    );
  return result.changes > 0;
}

export function deleteCollection(ownerKey: string, collectionId: string) {
  const result = getDatabase()
    .prepare("DELETE FROM collections WHERE owner_key = ? AND id = ?")
    .run(ownerKey, collectionId);
  return result.changes > 0;
}

export function setCollectionPlace(
  ownerKey: string,
  collectionId: string,
  placeId: string,
  included: boolean
) {
  const collection = getDatabase()
    .prepare(
      "SELECT 1 AS ok FROM collections WHERE owner_key = ? AND id = ?"
    )
    .get(ownerKey, collectionId) as { ok: number } | undefined;

  if (!collection) return false;

  if (included) {
    getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO collection_places (
           owner_key, collection_id, place_id, created_at
         ) VALUES (?, ?, ?, ?)`
      )
      .run(ownerKey, collectionId, placeId, new Date().toISOString());
  } else {
    getDatabase()
      .prepare(
        `DELETE FROM collection_places
         WHERE owner_key = ? AND collection_id = ? AND place_id = ?`
      )
      .run(ownerKey, collectionId, placeId);
  }

  getDatabase()
    .prepare(
      "UPDATE collections SET updated_at = ? WHERE owner_key = ? AND id = ?"
    )
    .run(new Date().toISOString(), ownerKey, collectionId);

  return true;
}
