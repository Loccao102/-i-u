import type { Place } from "./types";

/**
 * Scope planner candidates to a collection without falling back to other places.
 * The original ranking is preserved; the planner still applies distance, opening
 * hours, travel-time, duration and budget guardrails afterwards.
 */
export function filterCollectionPlannerPlaces<T extends Pick<Place, "id">>(
  rankedPlaces: ReadonlyArray<T>,
  collectionPlaceIds: ReadonlyArray<string>
): T[] {
  const allowed = new Set(collectionPlaceIds);
  if (allowed.size === 0) return [];
  return rankedPlaces.filter((place) => allowed.has(place.id));
}
