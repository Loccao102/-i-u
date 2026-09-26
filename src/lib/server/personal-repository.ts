import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import type {
  Collection,
  PersonalRating,
  PersonalSnapshot,
  Place,
  Scenario,
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
    address: row.address ?? undefined
  };
}

async function listPlaces(ownerKey: string): Promise<Place[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("personal_places")
    .select(
      "id,name,kind,description,latitude,longitude,distance_km,price_label,average_for_two,public_rating,match_score,community_note,open_until,best_time,noise,crowd,tags,scenarios,note,accent,source,provider_id,address"
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
  const [customPlaces, savedIds, ratings, visits, collections] =
    await Promise.all([
      listPlaces(ownerKey),
      listSaved(ownerKey),
      listRatings(ownerKey),
      listVisits(ownerKey),
      listCollections(ownerKey)
    ]);

  return {
    version: 2,
    customPlaces,
    savedIds,
    ratings,
    visits,
    collections
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
