import "server-only";

import type { MapBounds, PoiSearchResult, Scenario } from "../types";
import { cleanPlainText, suggestScenarios } from "../validation";

const searchCache = new Map<
  string,
  { expiresAt: number; data: PoiSearchResult[] }
>();
const discoveryCache = new Map<
  string,
  { expiresAt: number; data: PoiSearchResult[] }
>();

let lastNominatimRequestAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

let lastOverpassRequestAt = 0;
let overpassQueue: Promise<void> = Promise.resolve();

function classifyKind(type: string, category: string) {
  const raw = (type + " " + category).toLowerCase();

  if (/restaurant|fast_food|food_court|food/.test(raw)) {
    return "Restaurant";
  }
  if (/cafe|coffee/.test(raw)) return "Cafe";
  if (/bar|pub|biergarten/.test(raw)) return "Bar / Drink";
  if (
    /cinema|bowling|arcade|theatre|attraction|museum|gallery|viewpoint|escape_game|sports_centre/.test(
      raw
    )
  ) {
    return "Activity";
  }
  return "Địa điểm";
}

function colorForKind(kind: string) {
  if (kind === "Restaurant") return "#d68d4f";
  if (kind === "Activity") return "#6c63d9";
  if (kind === "Bar / Drink") return "#6677a8";
  return "#6f9274";
}

function scenarioForKind(kind: string, name: string): Scenario[] {
  const suggested = suggestScenarios(kind + " " + name);

  if (kind === "Restaurant") {
    return Array.from(new Set<Scenario>(["food", "date", ...suggested]));
  }
  if (kind === "Cafe") {
    return Array.from(new Set<Scenario>(["coffee", "chill", "date", ...suggested]));
  }
  if (kind === "Activity") {
    return Array.from(new Set<Scenario>(["fun", "friends", ...suggested]));
  }
  if (kind === "Bar / Drink") {
    return Array.from(new Set<Scenario>(["friends", "chill", "date", ...suggested]));
  }
  return suggested.length > 0 ? suggested : ["friends"];
}

async function obeyNominatimRateLimit() {
  nominatimQueue = nominatimQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastNominatimRequestAt = Date.now();
  });

  return nominatimQueue;
}

async function obeyOverpassRateLimit() {
  overpassQueue = overpassQueue.then(async () => {
    const wait = Math.max(0, 2200 - (Date.now() - lastOverpassRequestAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastOverpassRequestAt = Date.now();
  });

  return overpassQueue;
}

function normalizedBounds(bounds: MapBounds) {
  const west = Math.max(-180, Math.min(180, bounds.west));
  const east = Math.max(-180, Math.min(180, bounds.east));
  const south = Math.max(-90, Math.min(90, bounds.south));
  const north = Math.max(-90, Math.min(90, bounds.north));

  if (south >= north || west >= east) {
    throw new Error("INVALID_BODY");
  }

  // Public Overpass is a discovery fallback, not a country-scale export.
  if (east - west > 0.45 || north - south > 0.35) {
    throw new Error("POI_DISCOVERY_AREA_TOO_LARGE");
  }

  return { west, east, south, north };
}

function compactAddress(tags: Record<string, unknown>) {
  const values = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:district"],
    tags["addr:city"]
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => cleanPlainText(value, 80));

  return Array.from(new Set(values)).join(", ");
}

function stableOsmId(type: unknown, id: unknown, fallback: string) {
  if (
    (type === "node" || type === "way" || type === "relation") &&
    (typeof id === "number" || typeof id === "string")
  ) {
    return "osm:" + type + ":" + String(id);
  }
  return fallback;
}

export async function searchPoi(input: {
  query: string;
  latitude?: number;
  longitude?: number;
  bounds?: MapBounds;
}): Promise<PoiSearchResult[]> {
  const query = cleanPlainText(input.query, 120);
  if (query.length < 2) return [];

  const key = [
    query.toLowerCase(),
    input.latitude?.toFixed(2) ?? "",
    input.longitude?.toFixed(2) ?? "",
    input.bounds
      ? [
          input.bounds.west.toFixed(2),
          input.bounds.south.toFixed(2),
          input.bounds.east.toFixed(2),
          input.bounds.north.toFixed(2)
        ].join(",")
      : ""
  ].join("|");

  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  await obeyNominatimRateLimit();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "vn");

  if (input.bounds) {
    const bounds = normalizedBounds(input.bounds);
    url.searchParams.set(
      "viewbox",
      [bounds.west, bounds.north, bounds.east, bounds.south].join(",")
    );
    url.searchParams.set("bounded", "1");
  } else if (
    typeof input.latitude === "number" &&
    typeof input.longitude === "number"
  ) {
    const lat = input.latitude;
    const lon = input.longitude;
    url.searchParams.set(
      "viewbox",
      [lon - 0.18, lat + 0.15, lon + 0.18, lat - 0.15].join(",")
    );
    url.searchParams.set("bounded", "0");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "DiDau/0.2 personal-map discovery",
      "Accept-Language": "vi,en;q=0.8"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("POI_PROVIDER_UNAVAILABLE");
  }

  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) return [];

  const data = raw
    .slice(0, 8)
    .map((item): PoiSearchResult | null => {
      if (!item || typeof item !== "object") return null;

      const row = item as Record<string, unknown>;
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      const displayName =
        typeof row.display_name === "string"
          ? cleanPlainText(row.display_name, 240)
          : "";

      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !displayName) {
        return null;
      }

      const type = typeof row.type === "string" ? row.type : "";
      const category =
        typeof row.category === "string" ? row.category : "";
      const kind = classifyKind(type, category);
      const name =
        typeof row.name === "string" && row.name.trim()
          ? cleanPlainText(row.name, 100)
          : displayName.split(",")[0]!.trim();

      const extra =
        row.extratags && typeof row.extratags === "object"
          ? (row.extratags as Record<string, unknown>)
          : {};

      return {
        provider: "openstreetmap",
        providerId: stableOsmId(
          row.osm_type,
          row.osm_id,
          "nominatim:" + String(row.place_id ?? displayName)
        ),
        name,
        displayName,
        kind,
        latitude: lat,
        longitude: lon,
        scenarios: scenarioForKind(kind, name),
        accent: colorForKind(kind),
        address: displayName,
        openingHours:
          typeof extra.opening_hours === "string"
            ? cleanPlainText(extra.opening_hours, 120)
            : undefined
      };
    })
    .filter((item): item is PoiSearchResult => item !== null);

  searchCache.set(key, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    data
  });

  return data;
}

export async function discoverPoi(input: {
  bounds: MapBounds;
}): Promise<PoiSearchResult[]> {
  const bounds = normalizedBounds(input.bounds);
  const key = [
    bounds.west.toFixed(3),
    bounds.south.toFixed(3),
    bounds.east.toFixed(3),
    bounds.north.toFixed(3)
  ].join("|");

  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  await obeyOverpassRateLimit();

  const bbox = [
    bounds.south,
    bounds.west,
    bounds.north,
    bounds.east
  ].join(",");

  const query = `
[out:json][timeout:10];
(
  nwr["amenity"~"^(cafe|restaurant|fast_food|food_court|bar|pub|biergarten|cinema|theatre)$"](${bbox});
  nwr["leisure"~"^(bowling_alley|amusement_arcade|escape_game|sports_centre)$"](${bbox});
  nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"](${bbox});
);
out center 80;
`.trim();

  const endpoint =
    process.env.OVERPASS_API_URL?.trim() ||
    "https://overpass-api.de/api/interpreter";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "DiDau/0.2 personal-map discovery"
    },
    body: new URLSearchParams({ data: query }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("POI_PROVIDER_UNAVAILABLE");
  }

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") return [];

  const elements = Array.isArray((raw as { elements?: unknown }).elements)
    ? ((raw as { elements: unknown[] }).elements ?? [])
    : [];

  const seen = new Set<string>();

  const data = elements
    .map((item): PoiSearchResult | null => {
      if (!item || typeof item !== "object") return null;

      const row = item as Record<string, unknown>;
      const tags =
        row.tags && typeof row.tags === "object"
          ? (row.tags as Record<string, unknown>)
          : {};

      const rawName =
        typeof tags.name === "string"
          ? tags.name
          : typeof tags["name:vi"] === "string"
            ? tags["name:vi"]
            : "";

      const name = cleanPlainText(rawName, 100);
      if (name.length < 2) return null;

      const center =
        row.center && typeof row.center === "object"
          ? (row.center as Record<string, unknown>)
          : {};

      const latitude = Number(row.lat ?? center.lat);
      const longitude = Number(row.lon ?? center.lon);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }

      const category = [
        typeof tags.amenity === "string" ? tags.amenity : "",
        typeof tags.leisure === "string" ? tags.leisure : "",
        typeof tags.tourism === "string" ? tags.tourism : ""
      ]
        .filter(Boolean)
        .join(" ");

      const kind = classifyKind(category, category);
      if (kind === "Địa điểm") return null;

      const providerId = stableOsmId(
        row.type,
        row.id,
        "overpass:" + latitude + ":" + longitude + ":" + name
      );

      if (seen.has(providerId)) return null;
      seen.add(providerId);

      const address = compactAddress(tags);
      const displayName = address ? name + ", " + address : name;

      return {
        provider: "openstreetmap",
        providerId,
        name,
        displayName,
        kind,
        latitude,
        longitude,
        scenarios: scenarioForKind(kind, name),
        accent: colorForKind(kind),
        address: address || undefined,
        openingHours:
          typeof tags.opening_hours === "string"
            ? cleanPlainText(tags.opening_hours, 120)
            : undefined
      };
    })
    .filter((item): item is PoiSearchResult => item !== null)
    .slice(0, 60);

  discoveryCache.set(key, {
    expiresAt: Date.now() + 10 * 60 * 1000,
    data
  });

  return data;
}
