import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import type {
  BackupImportResult,
  Collection,
  DailyDiscoveryKind,
  DailyDiscoveryRecord,
  MapBounds,
  NearbyPlaceResult,
  PersonalRating,
  PersonalSnapshot,
  RecommendationFeedback,
  Place,
  Scenario,
  ViewportPlaceResult,
  VisitRecord
} from "../types";

type PlaceRow = {
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
  tags: string[] | null;
  scenarios: string[] | null;
  note: string;
  accent: string;
  source: "PERSONAL" | "PROVIDER";
  provider_id: string | null;
  google_place_id: string | null;
  address: string | null;
};

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function mapPlace(row: PlaceRow): Place {
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
    tags: (row.tags ?? []).filter((item): item is string => typeof item === "string"),
    scenarios: (row.scenarios ?? []).filter(
      (item): item is Scenario =>
        item === "date" ||
        item === "friends" ||
        item === "food" ||
        item === "coffee" ||
        item === "fun" ||
        item === "chill"
    ),
    note: row.note,
    accent: row.accent,
    source: row.source === "PROVIDER" ? "provider" : "personal",
    providerId: row.provider_id ?? undefined,
    googlePlaceId: row.google_place_id ?? undefined,
    address: row.address ?? undefined
  };
}

async function listPlaces(ownerKey: string): Promise<Place[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("personal_places")
    .select(
      "id,name,kind,description,latitude,longitude,distance_km,price_label,average_for_two,public_rating,match_score,community_note,open_until,best_time,noise,crowd,tags,scenarios,note,accent,source,provider_id,google_place_id,address"
    )
    .eq("owner_key", ownerKey)
    .order("updated_at", { ascending: false })
    .limit(1000);

  dbError(error, "List places");
  return ((data ?? []) as PlaceRow[]).map(mapPlace);
}

async function listSaved(ownerKey: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("saved_places")
    .select("place_id")
    .eq("owner_key", ownerKey)
    .order("created_at", { ascending: false })
    .limit(5000);

  dbError(error, "List saved");
  return (data ?? []).map((row) => String(row.place_id));
}

async function listRatings(
  ownerKey: string
): Promise<Record<string, PersonalRating>> {
  const { data, error } = await getSupabaseAdmin()
    .from("personal_ratings")
    .select("place_id,stars,revisit,contexts,note,visited_at,updated_at")
    .eq("owner_key", ownerKey);

  dbError(error, "List ratings");

  const result: Record<string, PersonalRating> = {};
  for (const row of data ?? []) {
    const placeId = String(row.place_id);
    result[placeId] = {
      placeId,
      stars: Number(row.stars),
      revisit:
        row.revisit === "yes" || row.revisit === "no" ? row.revisit : "maybe",
      contexts: Array.isArray(row.contexts)
        ? row.contexts.filter(
            (item): item is Scenario =>
              item === "date" ||
              item === "friends" ||
              item === "food" ||
              item === "coffee" ||
              item === "fun" ||
              item === "chill"
          )
        : [],
      note: typeof row.note === "string" ? row.note : "",
      visitedAt: String(row.visited_at),
      updatedAt: String(row.updated_at)
    };
  }
  return result;
}

async function listRecommendationFeedbacks(
  ownerKey: string
): Promise<Record<string, RecommendationFeedback>> {
  const { data, error } = await getSupabaseAdmin()
    .from("recommendation_feedback")
    .select(
      "place_id,reason,scenario,distance_km,created_at,updated_at"
    )
    .eq("owner_key", ownerKey)
    .order("updated_at", { ascending: false })
    .limit(5000);

  dbError(error, "List recommendation feedback");

  const result: Record<string, RecommendationFeedback> = {};
  for (const row of data ?? []) {
    const placeId = String(row.place_id);
    const reason = row.reason;

    if (
      reason !== "not_taste" &&
      reason !== "not_now" &&
      reason !== "too_far" &&
      reason !== "too_expensive"
    ) {
      continue;
    }

    const scenario =
      row.scenario === "date" ||
      row.scenario === "friends" ||
      row.scenario === "food" ||
      row.scenario === "coffee" ||
      row.scenario === "fun" ||
      row.scenario === "chill"
        ? row.scenario
        : null;

    result[placeId] = {
      placeId,
      reason,
      scenario,
      distanceKm:
        row.distance_km === null || row.distance_km === undefined
          ? null
          : Number(row.distance_km),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  return result;
}

async function listVisits(ownerKey: string): Promise<VisitRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("visits")
    .select("id,place_id,visited_at,rating_stars")
    .eq("owner_key", ownerKey)
    .order("visited_at", { ascending: false })
    .limit(5000);

  dbError(error, "List visits");

  return (data ?? []).map((row) => ({
    id: String(row.id),
    placeId: String(row.place_id),
    visitedAt: String(row.visited_at),
    ratingStars:
      row.rating_stars === null || row.rating_stars === undefined
        ? null
        : Number(row.rating_stars)
  }));
}

async function listDailyDiscoveries(
  ownerKey: string
): Promise<DailyDiscoveryRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_discoveries")
    .select("day,kind,place_keys,scenario,created_at,updated_at")
    .eq("owner_key", ownerKey)
    .order("day", { ascending: false })
    .limit(60);

  dbError(error, "List daily discoveries");

  return (data ?? []).flatMap((row) => {
    const kind: DailyDiscoveryKind | null =
      row.kind === "place" || row.kind === "route" ? row.kind : null;
    if (!kind) return [];

    const scenario: Scenario | null =
      row.scenario === "date" ||
      row.scenario === "friends" ||
      row.scenario === "food" ||
      row.scenario === "coffee" ||
      row.scenario === "fun" ||
      row.scenario === "chill"
        ? row.scenario
        : null;

    return [{
      day: String(row.day),
      kind,
      placeKeys: Array.isArray(row.place_keys)
        ? row.place_keys.filter(
            (item): item is string =>
              typeof item === "string" && item.length > 0
          )
        : [],
      scenario,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }];
  });
}

export async function upsertDailyDiscovery(
  ownerKey: string,
  input: {
    day: string;
    kind: DailyDiscoveryKind;
    placeKeys: string[];
    scenario: Scenario | null;
  }
): Promise<DailyDiscoveryRecord> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("daily_discoveries")
    .upsert(
      {
        owner_key: ownerKey,
        day: input.day,
        kind: input.kind,
        place_keys: input.placeKeys,
        scenario: input.scenario,
        updated_at: now
      },
      { onConflict: "owner_key,day,kind" }
    )
    .select("day,kind,place_keys,scenario,created_at,updated_at")
    .single();

  dbError(error, "Upsert daily discovery");

  return {
    day: String(data!.day),
    kind: data!.kind === "route" ? "route" : "place",
    placeKeys: data!.place_keys ?? [],
    scenario:
      data!.scenario === "date" ||
      data!.scenario === "friends" ||
      data!.scenario === "food" ||
      data!.scenario === "coffee" ||
      data!.scenario === "fun" ||
      data!.scenario === "chill"
        ? data!.scenario
        : null,
    createdAt: String(data!.created_at),
    updatedAt: String(data!.updated_at)
  };
}

async function listCollections(ownerKey: string): Promise<Collection[]> {
  const client = getSupabaseAdmin();
  const [collectionsResult, linksResult] = await Promise.all([
    client
      .from("collections")
      .select("id,name,description,created_at,updated_at")
      .eq("owner_key", ownerKey)
      .order("updated_at", { ascending: false })
      .limit(200),
    client
      .from("collection_places")
      .select("collection_id,place_id")
      .eq("owner_key", ownerKey)
  ]);

  dbError(collectionsResult.error, "List collections");
  dbError(linksResult.error, "List collection places");

  const byCollection = new Map<string, string[]>();
  for (const link of linksResult.data ?? []) {
    const collectionId = String(link.collection_id);
    const items = byCollection.get(collectionId) ?? [];
    items.push(String(link.place_id));
    byCollection.set(collectionId, items);
  }

  return (collectionsResult.data ?? []).map((item) => ({
    id: String(item.id),
    name: String(item.name),
    description: String(item.description ?? ""),
    placeIds: byCollection.get(String(item.id)) ?? [],
    createdAt: String(item.created_at),
    updatedAt: String(item.updated_at)
  }));
}

export async function getPersonalSnapshot(
  ownerKey: string
): Promise<PersonalSnapshot> {
  const [
    customPlaces,
    savedIds,
    ratings,
    recommendationFeedbacks,
    visits,
    collections,
    dailyDiscoveries
  ] = await Promise.all([
    listPlaces(ownerKey),
    listSaved(ownerKey),
    listRatings(ownerKey),
    listRecommendationFeedbacks(ownerKey),
    listVisits(ownerKey),
    listCollections(ownerKey),
    listDailyDiscoveries(ownerKey)
  ]);

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

export async function upsertPlace(ownerKey: string, place: Place) {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("personal_places")
    .upsert(
      {
        owner_key: ownerKey,
        id: place.id,
        name: place.name,
        kind: place.kind,
        description: place.description,
        latitude: place.latitude,
        longitude: place.longitude,
        distance_km: place.distanceKm,
        price_label: place.priceLabel,
        average_for_two: place.averageForTwo,
        public_rating: place.publicRating,
        match_score: place.match,
        community_note: place.communityNote,
        open_until: place.openUntil,
        best_time: place.bestTime,
        noise: place.noise,
        crowd: place.crowd,
        tags: place.tags,
        scenarios: place.scenarios,
        note: place.note,
        accent: place.accent,
        source: place.source === "provider" ? "PROVIDER" : "PERSONAL",
        provider_id: place.providerId ?? null,
        ...(place.googlePlaceId
          ? { google_place_id: place.googlePlaceId }
          : {}),
        address: place.address ?? null,
        updated_at: now
      },
      { onConflict: "owner_key,id" }
    );

  dbError(error, "Upsert place");
  return place;
}

export async function deletePlace(ownerKey: string, placeId: string) {
  const { data, error } = await getSupabaseAdmin().rpc(
    "delete_personal_place",
    {
      p_owner_key: ownerKey,
      p_place_id: placeId
    }
  );

  dbError(error, "Delete place");
  return data === true;
}

export async function setSaved(
  ownerKey: string,
  placeId: string,
  saved: boolean
) {
  const client = getSupabaseAdmin();

  if (saved) {
    const { error } = await client
      .from("saved_places")
      .upsert(
        {
          owner_key: ownerKey,
          place_id: placeId,
          created_at: new Date().toISOString()
        },
        {
          onConflict: "owner_key,place_id",
          ignoreDuplicates: true
        }
      );
    dbError(error, "Save place");
    return;
  }

  const { error } = await client
    .from("saved_places")
    .delete()
    .eq("owner_key", ownerKey)
    .eq("place_id", placeId);
  dbError(error, "Unsave place");
}

export async function saveRating(
  ownerKey: string,
  rating: PersonalRating
) {
  const { error } = await getSupabaseAdmin()
    .from("personal_ratings")
    .upsert(
      {
        owner_key: ownerKey,
        place_id: rating.placeId,
        stars: rating.stars,
        revisit: rating.revisit,
        contexts: rating.contexts,
        note: rating.note,
        visited_at: rating.visitedAt,
        updated_at: rating.updatedAt
      },
      { onConflict: "owner_key,place_id" }
    );

  dbError(error, "Save rating");
}

export async function saveRecommendationFeedback(
  ownerKey: string,
  feedback: RecommendationFeedback
) {
  const { error } = await getSupabaseAdmin()
    .from("recommendation_feedback")
    .upsert(
      {
        owner_key: ownerKey,
        place_id: feedback.placeId,
        reason: feedback.reason,
        scenario: feedback.scenario,
        distance_km: feedback.distanceKm,
        created_at: feedback.createdAt,
        updated_at: feedback.updatedAt
      },
      { onConflict: "owner_key,place_id" }
    );

  dbError(error, "Save recommendation feedback");
  return feedback;
}

export async function deleteRecommendationFeedback(
  ownerKey: string,
  placeId: string
) {
  const { error } = await getSupabaseAdmin()
    .from("recommendation_feedback")
    .delete()
    .eq("owner_key", ownerKey)
    .eq("place_id", placeId);

  dbError(error, "Delete recommendation feedback");
}

export async function addVisit(
  ownerKey: string,
  placeId: string,
  ratingStars: number | null,
  visitedAt = new Date().toISOString()
): Promise<VisitRecord> {
  const visit: VisitRecord = {
    id: randomUUID(),
    placeId,
    visitedAt,
    ratingStars
  };

  const { error } = await getSupabaseAdmin().from("visits").insert({
    owner_key: ownerKey,
    id: visit.id,
    place_id: visit.placeId,
    visited_at: visit.visitedAt,
    rating_stars: visit.ratingStars
  });

  dbError(error, "Add visit");
  return visit;
}

export async function createCollection(
  ownerKey: string,
  name: string,
  description: string
): Promise<Collection> {
  const now = new Date().toISOString();
  const item: Collection = {
    id: randomUUID(),
    name,
    description,
    placeIds: [],
    createdAt: now,
    updatedAt: now
  };

  const { error } = await getSupabaseAdmin().from("collections").insert({
    owner_key: ownerKey,
    id: item.id,
    name: item.name,
    description: item.description,
    created_at: now,
    updated_at: now
  });

  dbError(error, "Create collection");
  return item;
}

export async function updateCollection(
  ownerKey: string,
  collectionId: string,
  name: string,
  description: string
) {
  const { data, error } = await getSupabaseAdmin()
    .from("collections")
    .update({
      name,
      description,
      updated_at: new Date().toISOString()
    })
    .eq("owner_key", ownerKey)
    .eq("id", collectionId)
    .select("id")
    .maybeSingle();

  dbError(error, "Update collection");
  return Boolean(data);
}

export async function deleteCollection(
  ownerKey: string,
  collectionId: string
) {
  const { data, error } = await getSupabaseAdmin()
    .from("collections")
    .delete()
    .eq("owner_key", ownerKey)
    .eq("id", collectionId)
    .select("id")
    .maybeSingle();

  dbError(error, "Delete collection");
  return Boolean(data);
}

export async function setCollectionPlace(
  ownerKey: string,
  collectionId: string,
  placeId: string,
  included: boolean
) {
  const client = getSupabaseAdmin();

  const { data: collection, error: collectionError } = await client
    .from("collections")
    .select("id")
    .eq("owner_key", ownerKey)
    .eq("id", collectionId)
    .maybeSingle();

  dbError(collectionError, "Check collection");
  if (!collection) return false;

  if (included) {
    const { error } = await client
      .from("collection_places")
      .upsert(
        {
          owner_key: ownerKey,
          collection_id: collectionId,
          place_id: placeId,
          created_at: new Date().toISOString()
        },
        {
          onConflict: "owner_key,collection_id,place_id",
          ignoreDuplicates: true
        }
      );
    dbError(error, "Add place to collection");
  } else {
    const { error } = await client
      .from("collection_places")
      .delete()
      .eq("owner_key", ownerKey)
      .eq("collection_id", collectionId)
      .eq("place_id", placeId);
    dbError(error, "Remove place from collection");
  }

  const { error: touchError } = await client
    .from("collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("owner_key", ownerKey)
    .eq("id", collectionId);
  dbError(touchError, "Touch collection");

  return true;
}


export async function findProviderPlace(
  ownerKey: string,
  providerId: string
): Promise<Place | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("personal_places")
    .select(
      "id,name,kind,description,latitude,longitude,distance_km,price_label,average_for_two,public_rating,match_score,community_note,open_until,best_time,noise,crowd,tags,scenarios,note,accent,source,provider_id,google_place_id,address"
    )
    .eq("owner_key", ownerKey)
    .eq("source", "PROVIDER")
    .eq("provider_id", providerId)
    .maybeSingle();

  dbError(error, "Find provider place");
  return data ? mapPlace(data as PlaceRow) : null;
}

export async function importProviderPlace(
  ownerKey: string,
  place: Place
): Promise<{ place: Place; duplicate: boolean }> {
  if (place.source !== "provider" || !place.providerId) {
    throw new Error("INVALID_PROVIDER_PLACE");
  }

  const existing = await findProviderPlace(ownerKey, place.providerId);
  if (existing) {
    return { place: existing, duplicate: true };
  }

  try {
    await upsertPlace(ownerKey, place);
    return { place, duplicate: false };
  } catch (error) {
    const raced = await findProviderPlace(ownerKey, place.providerId);
    if (raced) {
      return { place: raced, duplicate: true };
    }
    throw error;
  }
}

export async function listNearbyPersonalPlaceDistances(
  ownerKey: string,
  latitude: number,
  longitude: number,
  limit = 100
): Promise<NearbyPlaceResult[]> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "nearby_personal_places",
    {
      p_owner_key: ownerKey,
      p_lat: latitude,
      p_long: longitude,
      p_limit: Math.max(1, Math.min(limit, 500))
    }
  );

  dbError(error, "Nearby personal places");

  return (data ?? []).map((row) => ({
    placeId: String(row.id),
    distanceKm: Number(row.distance_meters) / 1000
  }));
}

export async function mergePersonalBackup(
  ownerKey: string,
  snapshot: PersonalSnapshot
): Promise<BackupImportResult> {
  const client = getSupabaseAdmin();
  const idRemap = new Map<string, string>();

  let places = 0;
  for (const place of snapshot.customPlaces) {
    if (place.source === "provider" && place.providerId) {
      const imported = await importProviderPlace(ownerKey, place);
      idRemap.set(place.id, imported.place.id);
      if (!imported.duplicate) places += 1;
    } else {
      await upsertPlace(ownerKey, place);
      idRemap.set(place.id, place.id);
      places += 1;
    }
  }

  const mapPlaceId = (placeId: string) => idRemap.get(placeId) ?? placeId;
  const now = new Date().toISOString();

  const savedRows = Array.from(
    new Set(snapshot.savedIds.map(mapPlaceId))
  ).map((placeId) => ({
    owner_key: ownerKey,
    place_id: placeId,
    created_at: now
  }));

  if (savedRows.length > 0) {
    const { error } = await client
      .from("saved_places")
      .upsert(savedRows, {
        onConflict: "owner_key,place_id",
        ignoreDuplicates: true
      });
    dbError(error, "Import saved places");
  }

  const ratingRows = Object.values(snapshot.ratings).map((rating) => ({
    owner_key: ownerKey,
    place_id: mapPlaceId(rating.placeId),
    stars: rating.stars,
    revisit: rating.revisit,
    contexts: rating.contexts,
    note: rating.note,
    visited_at: rating.visitedAt,
    updated_at: rating.updatedAt
  }));

  if (ratingRows.length > 0) {
    const { error } = await client
      .from("personal_ratings")
      .upsert(ratingRows, { onConflict: "owner_key,place_id" });
    dbError(error, "Import ratings");
  }

  const feedbackRows = Object.values(
    snapshot.recommendationFeedbacks
  ).map((feedback) => ({
    owner_key: ownerKey,
    place_id: mapPlaceId(feedback.placeId),
    reason: feedback.reason,
    scenario: feedback.scenario,
    distance_km: feedback.distanceKm,
    created_at: feedback.createdAt,
    updated_at: feedback.updatedAt
  }));

  if (feedbackRows.length > 0) {
    const { error } = await client
      .from("recommendation_feedback")
      .upsert(feedbackRows, { onConflict: "owner_key,place_id" });
    dbError(error, "Import recommendation feedback");
  }

  const visitRows = snapshot.visits.map((visit) => ({
    owner_key: ownerKey,
    id: visit.id,
    place_id: mapPlaceId(visit.placeId),
    visited_at: visit.visitedAt,
    rating_stars: visit.ratingStars
  }));

  if (visitRows.length > 0) {
    const { error } = await client
      .from("visits")
      .upsert(visitRows, {
        onConflict: "owner_key,id",
        ignoreDuplicates: true
      });
    dbError(error, "Import visits");
  }

  const collectionRows = snapshot.collections.map((collection) => ({
    owner_key: ownerKey,
    id: collection.id,
    name: collection.name,
    description: collection.description,
    created_at: collection.createdAt,
    updated_at: collection.updatedAt
  }));

  if (collectionRows.length > 0) {
    const { error } = await client
      .from("collections")
      .upsert(collectionRows, { onConflict: "owner_key,id" });
    dbError(error, "Import collections");
  }

  const collectionPlaceRows = snapshot.collections.flatMap((collection) =>
    collection.placeIds.map((placeId) => ({
      owner_key: ownerKey,
      collection_id: collection.id,
      place_id: mapPlaceId(placeId),
      created_at: now
    }))
  );

  if (collectionPlaceRows.length > 0) {
    const { error } = await client
      .from("collection_places")
      .upsert(collectionPlaceRows, {
        onConflict: "owner_key,collection_id,place_id",
        ignoreDuplicates: true
      });
    dbError(error, "Import collection places");
  }

  return {
    places,
    saved: savedRows.length,
    ratings: ratingRows.length,
    recommendationFeedbacks: feedbackRows.length,
    visits: visitRows.length,
    collections: collectionRows.length,
    collectionPlaces: collectionPlaceRows.length
  };
}


export async function listViewportPersonalPlaces(
  ownerKey: string,
  bounds: MapBounds,
  limit = 500
): Promise<ViewportPlaceResult[]> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "viewport_personal_places",
    {
      p_owner_key: ownerKey,
      p_west: bounds.west,
      p_south: bounds.south,
      p_east: bounds.east,
      p_north: bounds.north,
      p_limit: Math.max(1, Math.min(limit, 1000))
    }
  );

  dbError(error, "Viewport personal places");

  return (data ?? []).map((row) => ({
    placeId: String(row.id),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude)
  }));
}


export async function getPersonalPlace(
  ownerKey: string,
  placeId: string
): Promise<Place | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("personal_places")
    .select(
      "id,name,kind,description,latitude,longitude,distance_km,price_label,average_for_two,public_rating,match_score,community_note,open_until,best_time,noise,crowd,tags,scenarios,note,accent,source,provider_id,google_place_id,address"
    )
    .eq("owner_key", ownerKey)
    .eq("id", placeId)
    .maybeSingle();

  dbError(error, "Get personal place");
  return data ? mapPlace(data as PlaceRow) : null;
}

export async function setGooglePlaceId(
  ownerKey: string,
  placeId: string,
  googlePlaceId: string
) {
  const { error } = await getSupabaseAdmin()
    .from("personal_places")
    .update({
      google_place_id: googlePlaceId,
      updated_at: new Date().toISOString()
    })
    .eq("owner_key", ownerKey)
    .eq("id", placeId);

  dbError(error, "Set Google place id");
}
