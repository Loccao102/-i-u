import "server-only";

import type { MapBounds, PoiSearchResult, Scenario } from "../types";
import { cleanPlainText, suggestScenarios } from "../validation";

const cache = new Map<string, { expiresAt: number; data: PoiSearchResult[] }>();
let lastRequestAt = 0;
let pendingRequest: Promise<void> = Promise.resolve();

function classifyKind(type: string, category: string) {
  const raw = (type + " " + category).toLowerCase();
  if (/restaurant|fast_food|food/.test(raw)) return "Restaurant";
  if (/cafe|coffee/.test(raw)) return "Cafe";
  if (/bar|pub/.test(raw)) return "Bar / Drink";
  if (/cinema|bowling|arcade|theatre|attraction/.test(raw)) {
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
    return Array.from(new Set<Scenario>(["food", ...suggested]));
  }
  if (kind === "Cafe") {
    return Array.from(new Set<Scenario>(["coffee", ...suggested]));
  }
  if (kind === "Activity") {
    return Array.from(new Set<Scenario>(["fun", ...suggested]));
  }
  return suggested;
}

async function obeyPublicRateLimit() {
  pendingRequest = pendingRequest.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
  });
  return pendingRequest;
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

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  await obeyPublicRateLimit();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "vn");

  if (input.bounds) {
    url.searchParams.set(
      "viewbox",
      [
        input.bounds.west,
        input.bounds.north,
        input.bounds.east,
        input.bounds.south
      ].join(",")
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
      "User-Agent": "DiDau/0.1 personal-map development",
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

      return {
        provider: "openstreetmap",
        providerId: String(row.place_id ?? row.osm_id ?? displayName),
        name,
        displayName,
        kind,
        latitude: lat,
        longitude: lon,
        scenarios: scenarioForKind(kind, name),
        accent: colorForKind(kind)
      };
    })
    .filter((item): item is PoiSearchResult => item !== null);

  cache.set(key, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    data
  });

  return data;
}
