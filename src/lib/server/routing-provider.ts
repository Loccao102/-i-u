import "server-only";

import type {
  PlannerTravelMatrix,
  RoutingMatrixPoint,
  RoutingMatrixResult,
  RoutingMode
} from "../types";

const routeMatrixCache = new Map<
  string,
  { expiresAt: number; result: RoutingMatrixResult }
>();

function apiKey() {
  return process.env.GEOAPIFY_API_KEY?.trim() || null;
}

export function isRoutingConfigured() {
  return Boolean(apiKey());
}

function cacheKey(points: RoutingMatrixPoint[], mode: RoutingMode) {
  return (
    mode +
    "|" +
    points
    .map(
      (point) =>
        point.key +
        ":" +
        point.latitude.toFixed(5) +
        "," +
        point.longitude.toFixed(5)
    )
    .join("|")
  );
}

export async function getRoadRouteMatrix(
  points: RoutingMatrixPoint[],
  mode: RoutingMode
): Promise<RoutingMatrixResult> {
  const key = apiKey();
  if (!key) {
    return {
      matrix: null,
      provider: null,
      mode,
      configured: false
    };
  }

  const cacheId = cacheKey(points, mode);
  const cached = routeMatrixCache.get(cacheId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const url = new URL("https://api.geoapify.com/v1/routematrix");
  url.searchParams.set("apiKey", key);

  const locations = points.map((point) => ({
    location: [point.longitude, point.latitude]
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "DiDau/0.3 road-routing"
    },
    body: JSON.stringify({
      mode,
      type: "balanced",
      sources: locations,
      targets: locations
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("ROUTING_PROVIDER_UNAVAILABLE");
  }

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") {
    throw new Error("ROUTING_PROVIDER_UNAVAILABLE");
  }

  const sourceRows = (
    raw as { sources_to_targets?: unknown }
  ).sources_to_targets;

  if (!Array.isArray(sourceRows)) {
    throw new Error("ROUTING_PROVIDER_UNAVAILABLE");
  }

  const matrix: PlannerTravelMatrix = {};

  points.forEach((source, sourceIndex) => {
    const row = sourceRows[sourceIndex];
    matrix[source.key] = {};

    points.forEach((target, targetIndex) => {
      if (!Array.isArray(row)) {
        matrix[source.key]![target.key] = null;
        return;
      }

      const cell = row[targetIndex];
      if (!cell || typeof cell !== "object") {
        matrix[source.key]![target.key] = null;
        return;
      }

      const distance = Number(
        (cell as { distance?: unknown }).distance
      );
      const time = Number((cell as { time?: unknown }).time);

      if (
        !Number.isFinite(distance) ||
        !Number.isFinite(time) ||
        distance < 0 ||
        time < 0
      ) {
        matrix[source.key]![target.key] = null;
        return;
      }

      matrix[source.key]![target.key] = {
        distanceKm: Math.round((distance / 1000) * 100) / 100,
        durationMinutes:
          source.key === target.key
            ? 0
            : Math.max(1, Math.round(time / 60))
      };
    });
  });

  const result: RoutingMatrixResult = {
    matrix,
    provider: "geoapify",
    mode,
    configured: true
  };

  routeMatrixCache.set(cacheId, {
    expiresAt: Date.now() + 15 * 60 * 1000,
    result
  });

  return result;
}
