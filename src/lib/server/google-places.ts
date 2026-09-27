import "server-only";

import type {
  GooglePhotoAttribution,
  GooglePlaceLiveDetails,
  GooglePlacePhoto,
  Place
} from "../types";

type GoogleCandidate = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

type GooglePhoto = {
  name?: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: Array<{
    displayName?: string;
    uri?: string;
    photoUri?: string;
  }>;
};

function apiKey() {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

export function isGooglePlacesConfigured() {
  return Boolean(apiKey());
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nameSimilarity(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap / Math.max(a.size, b.size);
}

export async function resolveGooglePlaceId(
  place: Place
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const query = [place.name, place.address].filter(Boolean).join(" ");
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location"
      },
      body: JSON.stringify({
        textQuery: query || place.name,
        maxResultCount: 3,
        languageCode: "vi",
        locationBias: {
          circle: {
            center: {
              latitude: place.latitude,
              longitude: place.longitude
            },
            radius: 500
          }
        }
      }),
      cache: "no-store"
    }
  );

  if (!response.ok) return null;

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") return null;

  const candidates = Array.isArray(
    (raw as { places?: unknown }).places
  )
    ? ((raw as { places: GoogleCandidate[] }).places ?? [])
    : [];

  const ranked = candidates
    .map((candidate) => {
      const id = candidate.id?.trim();
      const latitude = Number(candidate.location?.latitude);
      const longitude = Number(candidate.location?.longitude);
      if (
        !id ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return null;
      }

      const distance = distanceMeters(
        {
          latitude: place.latitude,
          longitude: place.longitude
        },
        { latitude, longitude }
      );
      const similarity = nameSimilarity(
        place.name,
        candidate.displayName?.text ?? ""
      );

      return {
        id,
        distance,
        similarity,
        score: similarity * 100 - Math.min(100, distance / 8)
      };
    })
    .filter(
      (
        item
      ): item is {
        id: string;
        distance: number;
        similarity: number;
        score: number;
      } => item !== null
    )
    .filter(
      (item) =>
        item.distance <= 700 &&
        (item.similarity >= 0.25 || item.distance <= 120)
    )
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.id ?? null;
}

function parseAttributions(
  value: GooglePhoto["authorAttributions"]
): GooglePhotoAttribution[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      displayName:
        typeof item.displayName === "string"
          ? item.displayName
          : "Google Maps contributor",
      uri: typeof item.uri === "string" ? item.uri : undefined,
      photoUri:
        typeof item.photoUri === "string"
          ? item.photoUri
          : undefined
    }))
    .slice(0, 4);
}

async function photoUri(
  name: string,
  key: string
): Promise<string | null> {
  const url = new URL(
    "https://places.googleapis.com/v1/" + name + "/media"
  );
  url.searchParams.set("maxWidthPx", "1280");
  url.searchParams.set("skipHttpRedirect", "true");
  url.searchParams.set("key", key);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") return null;

  const uri = (raw as { photoUri?: unknown }).photoUri;
  return typeof uri === "string" ? uri : null;
}

export async function getGooglePlaceLiveDetails(
  placeId: string
): Promise<GooglePlaceLiveDetails | null> {
  const key = apiKey();
  if (!key) return null;

  const response = await fetch(
    "https://places.googleapis.com/v1/places/" +
      encodeURIComponent(placeId),
    {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "id,photos,rating,userRatingCount,priceLevel,currentOpeningHours,googleMapsUri"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) return null;

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") return null;

  const place = raw as {
    id?: unknown;
    rating?: unknown;
    userRatingCount?: unknown;
    priceLevel?: unknown;
    googleMapsUri?: unknown;
    currentOpeningHours?: {
      openNow?: unknown;
      weekdayDescriptions?: unknown;
    };
    photos?: unknown;
  };

  const photos = Array.isArray(place.photos)
    ? (place.photos as GooglePhoto[]).slice(0, 3)
    : [];

  const resolvedPhotos = await Promise.all(
    photos.map(async (photo): Promise<GooglePlacePhoto | null> => {
      if (typeof photo.name !== "string") return null;
      const url = await photoUri(photo.name, key);
      if (!url) return null;

      return {
        url,
        width: Number(photo.widthPx) || 0,
        height: Number(photo.heightPx) || 0,
        authorAttributions: parseAttributions(photo.authorAttributions)
      };
    })
  );

  const rating = Number(place.rating);
  const userRatingCount = Number(place.userRatingCount);
  const openNow = place.currentOpeningHours?.openNow;
  const weekdayDescriptions =
    place.currentOpeningHours &&
    Array.isArray(place.currentOpeningHours.weekdayDescriptions)
      ? place.currentOpeningHours.weekdayDescriptions.filter(
          (item): item is string => typeof item === "string"
        )
      : [];

  return {
    placeId,
    mapsUrl:
      typeof place.googleMapsUri === "string"
        ? place.googleMapsUri
        : "https://www.google.com/maps/search/?api=1&query_place_id=" +
          encodeURIComponent(placeId) +
          "&query=" +
          encodeURIComponent(placeId),
    rating: Number.isFinite(rating) ? rating : null,
    userRatingCount: Number.isFinite(userRatingCount)
      ? userRatingCount
      : null,
    priceLevel:
      typeof place.priceLevel === "string" ? place.priceLevel : null,
    openNow: typeof openNow === "boolean" ? openNow : null,
    weekdayDescriptions,
    photos: resolvedPhotos.filter(
      (item): item is GooglePlacePhoto => item !== null
    )
  };
}
