import type {
  BackupImportResult,
  Collection,
  MapBounds,
  NearbyPlaceResult,
  PersonalBackup,
  PersonalRating,
  PersonalSnapshot,
  Place,
  PoiSearchResult,
  RatingDraft,
  Scenario,
  UserLocation,
  ViewportPlaceResult,
  VisitRecord,
  WeatherContext
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

  const data: unknown = await response.json();

  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Yêu cầu không hoàn tất.";
    throw new Error(message);
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
    input: RatingDraft & {
      visitedAt?: string;
      recordVisit?: boolean;
    }
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
    location: UserLocation | null,
    bounds?: MapBounds | null
  ) => {
    const params = new URLSearchParams({ q: query });
    if (location) {
      params.set("lat", String(location.latitude));
      params.set("lon", String(location.longitude));
    }
    if (bounds) {
      params.set("west", String(bounds.west));
      params.set("south", String(bounds.south));
      params.set("east", String(bounds.east));
      params.set("north", String(bounds.north));
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
      priceLabel: "$",
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

    return api<{ place: Place; duplicate: boolean }>(
      "/api/personal/import-poi",
      { method: "POST", body: place }
    );
  },

  nearby: (location: UserLocation, limit = 100) => {
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude),
      limit: String(limit)
    });

    return api<{ results: NearbyPlaceResult[] }>(
      "/api/personal/nearby?" + params.toString()
    );
  },

  viewport: (bounds: MapBounds) => {
    const params = new URLSearchParams({
      west: String(bounds.west),
      south: String(bounds.south),
      east: String(bounds.east),
      north: String(bounds.north)
    });

    return api<{ results: ViewportPlaceResult[] }>(
      "/api/personal/viewport?" + params.toString()
    );
  },

  weather: (location: UserLocation) => {
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude)
    });

    return api<{ weather: WeatherContext }>(
      "/api/context/weather?" + params.toString()
    );
  },

  exportBackup: () => api<PersonalBackup>("/api/personal/export"),

  importBackup: (backup: PersonalBackup) =>
    api<BackupImportResult & { mode: "merge" }>(
      "/api/personal/import",
      { method: "POST", body: backup }
    )
};
