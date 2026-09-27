import type { ProviderCostCalibration } from "./cost-estimation";
import { placeFromPoiResult } from "./places";
import type {
  ActivePlanAdvanceResult,
  ActivePersonalPlan,
  ActivePlanSnapshot,
  BackupImportResult,
  Collection,
  CompletedPersonalPlan,
  CompletedPlanFeedbackInput,
  DailyDiscoveryKind,
  DailyDiscoveryRecord,
  MapBounds,
  NearbyPlaceResult,
  PersonalBackup,
  PersonalRating,
  RecommendationFeedback,
  RecommendationFeedbackReason,
  ProviderPlaceDetails,
  RoutingMatrixPoint,
  RoutingMatrixResult,
  RoutingMode,
  PlaceMedia,
  PlaceUserPhoto,
  PersonalSnapshot,
  Place,
  PoiDiscoveryFilters,
  PoiDiscoveryPage,
  PoiSearchResult,
  RatingDraft,
  UserLocation,
  ViewportPlaceResult,
  VisitRecord,
  WeatherContext
} from "./types";

async function readApiPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "Máy chủ trả response rỗng."
        : "Máy chủ lỗi " + response.status + " nhưng không trả JSON."
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      response.ok
        ? "Máy chủ trả dữ liệu không phải JSON."
        : "Máy chủ lỗi " +
            response.status +
            " và trả response không hợp lệ."
    );
  }
}

function apiErrorMessage(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error?: unknown }).error === "string"
  ) {
    const base = (data as { error: string }).error;
    const code =
      "code" in data &&
      typeof (data as { code?: unknown }).code === "string"
        ? (data as { code: string }).code
        : null;
    return code ? base + " [" + code + "]" : base;
  }

  return fallback;
}

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

  const data = await readApiPayload(response);

  if (!response.ok) {
    throw new Error(apiErrorMessage(data, "Yêu cầu không hoàn tất."));
  }

  return data as T;
}

export const personalApi = {
  snapshot: () => api<PersonalSnapshot>("/api/personal"),

  saveDailyDiscovery: (input: {
    day: string;
    kind: DailyDiscoveryKind;
    placeKeys: string[];
    scenario: string | null;
  }) =>
    api<DailyDiscoveryRecord>("/api/personal/daily-discovery", {
      method: "PUT",
      body: input
    }),

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

  getPlaceMedia: (placeId: string) =>
    api<PlaceMedia>(
      "/api/personal/places/" +
        encodeURIComponent(placeId) +
        "/media"
    ),

  getPlaceCovers: (placeIds: string[]) => {
    const ids = placeIds
      .slice(0, 50)
      .map((item) => item.trim())
      .filter(Boolean);

    const params = new URLSearchParams({
      ids: ids.join(",")
    });

    return api<{ covers: Record<string, string> }>(
      "/api/personal/place-covers?" + params.toString()
    );
  },

  uploadPlacePhoto: async (
    placeId: string,
    file: File,
    caption = ""
  ): Promise<PlaceUserPhoto> => {
    const form = new FormData();
    form.set("file", file);
    form.set("caption", caption);

    const response = await fetch(
      "/api/personal/places/" +
        encodeURIComponent(placeId) +
        "/media",
      {
        method: "POST",
        body: form,
        credentials: "same-origin",
        cache: "no-store"
      }
    );

    const data = await readApiPayload(response);
    if (!response.ok) {
      throw new Error(
        apiErrorMessage(data, "Không thể tải ảnh lên.")
      );
    }

    return data as PlaceUserPhoto;
  },

  deletePlacePhoto: (photoId: string) =>
    api<{ deleted: true }>(
      "/api/personal/photos/" + encodeURIComponent(photoId),
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

  setRecommendationFeedback: (
    placeId: string,
    input: {
      reason: RecommendationFeedbackReason;
      scenario: string | null;
      distanceKm: number | null;
    }
  ) =>
    api<RecommendationFeedback>(
      "/api/personal/feedback/" + encodeURIComponent(placeId),
      { method: "PUT", body: input }
    ),

  clearRecommendationFeedback: (placeId: string) =>
    api<{ deleted: true }>(
      "/api/personal/feedback/" + encodeURIComponent(placeId),
      { method: "DELETE" }
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

  discoverPoi: (
    bounds: MapBounds,
    filters?: PoiDiscoveryFilters,
    offset = 0
  ) => {
    const params = new URLSearchParams({
      west: String(bounds.west),
      south: String(bounds.south),
      east: String(bounds.east),
      north: String(bounds.north)
    });

    if (filters) {
      params.set("category", filters.category);
      params.set("amenity", filters.amenity);
      params.set("radiusKm", String(filters.radiusKm));
    }
    params.set("offset", String(offset));

    return api<PoiDiscoveryPage>(
      "/api/poi/discover?" + params.toString()
    );
  },

  getProviderPlaceDetails: (providerId: string) => {
    const params = new URLSearchParams({ providerId });
    return api<{
      details: ProviderPlaceDetails | null;
      configured: boolean;
    }>("/api/poi/details?" + params.toString());
  },

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

  importPoi: (
    result: PoiSearchResult,
    calibration?: ProviderCostCalibration
  ) => {
    const place: Place = {
      ...placeFromPoiResult(result, calibration),
      id: crypto.randomUUID(),
      match: 78,
      communityNote:
        result.provider === "geoapify"
          ? "Nhập từ Geoapify"
          : "Nhập từ OpenStreetMap"
    };

    return api<{ place: Place; duplicate: boolean }>(
      "/api/personal/import-poi",
      { method: "POST", body: place }
    );
  },

  importProviderPlace: (place: Place) =>
    api<{ place: Place; duplicate: boolean }>(
      "/api/personal/import-poi",
      {
        method: "POST",
        body: {
          ...place,
          id: crypto.randomUUID(),
          match: Math.max(72, place.match),
          communityNote: place.providerId?.startsWith("geoapify:")
            ? "Nhập từ Geoapify"
            : "Nhập từ OpenStreetMap"
        }
      }
    ),

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

  routeMatrix: (
    points: RoutingMatrixPoint[],
    mode: RoutingMode = "motorcycle"
  ) =>
    api<RoutingMatrixResult>("/api/routing/matrix", {
      method: "POST",
      body: { points, mode }
    }),

  weather: (location: UserLocation, targetAt?: string) => {
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lon: String(location.longitude)
    });

    if (targetAt) params.set("at", targetAt);

    return api<{ weather: WeatherContext }>(
      "/api/context/weather?" + params.toString()
    );
  },

  exportBackup: () => api<PersonalBackup>("/api/personal/export"),

  importBackup: (backup: PersonalBackup) =>
    api<BackupImportResult & { mode: "merge" }>(
      "/api/personal/import",
      { method: "POST", body: backup }
    ),

  saveCompletedPlanFeedback: (
    planId: string,
    input: CompletedPlanFeedbackInput
  ) =>
    api<{ completedPlan: CompletedPersonalPlan }>(
      "/api/personal/completed-plans/" +
        encodeURIComponent(planId) +
        "/feedback",
      { method: "PATCH", body: input }
    ),

  activePlan: {
    get: () =>
      api<{ activePlan: ActivePersonalPlan | null }>(
        "/api/personal/active-plan"
      ),

    start: (plan: ActivePlanSnapshot) =>
      api<{ activePlan: ActivePersonalPlan }>(
        "/api/personal/active-plan",
        { method: "PUT", body: { plan } }
      ),

    advance: (
      action: "complete" | "skip",
      expectedIndex: number
    ) =>
      api<ActivePlanAdvanceResult>(
        "/api/personal/active-plan",
        { method: "PATCH", body: { action, expectedIndex } }
      ),

    cancel: () =>
      api<{ canceled: true }>(
        "/api/personal/active-plan",
        { method: "DELETE" }
      )
  }
};
