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
  // A place may occur multiple times after merging personal and provider lists.
  // Keep its highest-ranked occurrence so an itinerary never receives
  // duplicate candidates for the same saved place.
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const place of rankedPlaces) {
    if (!allowed.has(place.id) || seen.has(place.id)) continue;
    seen.add(place.id);
    selected.push(place);
  }
  return selected;
}
