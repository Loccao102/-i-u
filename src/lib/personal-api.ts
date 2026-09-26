import type {
  Collection,
  PersonalRating,
  PersonalSnapshot,
  Place,
  PoiSearchResult,
  RatingDraft,
  Scenario,
  UserLocation,
  VisitRecord
} from "./types";

async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers:
      init?.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      init?.body === undefined
        ? undefined
        : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store"
  });

  const data = (await response.json()) as
    | T
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      "error" in data && data.error
        ? data.error
        : "Yêu cầu không hoàn tất."
    );
  }

  return data as T;
}

export const personalApi = {
  snapshot: () => api<PersonalSnapshot>("/api/personal"),

  createPlace: (place: Place) =>
    api<Place>("/api/personal/places", {
      method: "POST",
      body: place
    }),

  updatePlace: (placeId: string, place: Place) =>
    api<Place>(
      "/api/personal/places/" + encodeURIComponent(placeId),
      { method: "PATCH", body: place }
    ),

  deletePlace: (placeId: string) =>
    api<{ deleted: true }>(
      "/api/personal/places/" + encodeURIComponent(placeId),
      { method: "DELETE" }
    ),

  setSaved: (placeId: string, saved: boolean) =>
    api<{ saved: boolean }>(
      "/api/personal/saved/" + encodeURIComponent(placeId),
      { method: "PUT", body: { saved } }
    ),

  saveRating: (
    placeId: string,
    input: RatingDraft & { visitedAt?: string }
  ) =>
    api<PersonalRating>(
      "/api/personal/ratings/" + encodeURIComponent(placeId),
      { method: "PUT", body: input }
    ),

  checkIn: (placeId: string) =>
    api<VisitRecord>(
      "/api/personal/checkins/" + encodeURIComponent(placeId),
      { method: "POST", body: {} }
    ),

  createCollection: (input: {
    name: string;
    description?: string;
  }) =>
    api<Collection>("/api/personal/collections", {
      method: "POST",
      body: input
    }),

  updateCollection: (
    collectionId: string,
    input: { name: string; description?: string }
  ) =>
    api<{ updated: true }>(
      "/api/personal/collections/" +
        encodeURIComponent(collectionId),
      { method: "PATCH", body: input }
    ),

  deleteCollection: (collectionId: string) =>
    api<{ deleted: true }>(
      "/api/personal/collections/" +
        encodeURIComponent(collectionId),
      { method: "DELETE" }
    ),

  setCollectionPlace: (
    collectionId: string,
    placeId: string,
    included: boolean
  ) =>
    api<{ included: boolean }>(
      "/api/personal/collections/" +
        encodeURIComponent(collectionId) +
        "/places/" +
        encodeURIComponent(placeId),
      { method: "PUT", body: { included } }
    ),

  searchPoi: (
    query: string,
    location: UserLocation | null
  ) => {
    const params = new URLSearchParams({ q: query });
    if (location) {
      params.set("lat", String(location.latitude));
      params.set("lon", String(location.longitude));
    }
    return api<{ results: PoiSearchResult[] }>(
      "/api/poi/search?" + params.toString()
    );
  },

  importPoi: (result: PoiSearchResult) => {
    const scenarios = result.scenarios as Scenario[];
    const place: Place = {
      id: crypto.randomUUID(),
      name: result.name,
      kind: result.kind,
      description: result.displayName,
      latitude: result.latitude,
      longitude: result.longitude,
      distanceKm: 0,
      priceLabel: "$$",
      averageForTwo: "Chưa có dữ liệu",
      publicRating: 0,
      match: 78,
      communityNote: "Nhập từ OpenStreetMap",
      openUntil: "Chưa rõ",
      bestTime: "Chưa có dữ liệu",
      noise: "Vừa",
      crowd: "Vừa",
      tags: scenarios,
      scenarios,
      note: "",
      accent: result.accent,
      source: "provider",
      providerId: result.providerId,
      address: result.displayName
    };
    return personalApi.createPlace(place);
  }
};
