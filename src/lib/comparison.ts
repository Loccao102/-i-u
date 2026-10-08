import { parseCostAmount } from "./cost-estimation";
import type { Place } from "./types";

export type ComparisonSort = "match" | "distance" | "cost";

export function comparisonCost(place: Place): number | null {
  if (place.costSource === "unknown") return null;
  const cost = parseCostAmount(place.averageForTwo);
  return cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null;
}

function comparableDistance(place: Place) {
  return Number.isFinite(place.distanceKm) && place.distanceKm >= 0
    ? place.distanceKm
    : Number.POSITIVE_INFINITY;
}

export function sortComparisonPlaces(
  places: ReadonlyArray<Place>,
  sort: ComparisonSort
): Place[] {
  return places
    .map((place, originalIndex) => ({ place, originalIndex }))
    .sort((a, b) => {
      let diff: number;
      if (sort === "distance") {
        diff = comparableDistance(a.place) - comparableDistance(b.place);
      } else if (sort === "cost") {
        diff =
          (comparisonCost(a.place) ?? Number.POSITIVE_INFINITY) -
          (comparisonCost(b.place) ?? Number.POSITIVE_INFINITY);
      } else {
        diff = b.place.match - a.place.match;
      }
      return (Number.isNaN(diff) ? 0 : diff) ||
        b.place.match - a.place.match ||
        a.originalIndex - b.originalIndex;
    })
    .map(({ place }) => place);
}

export function comparisonHighlights(places: ReadonlyArray<Place>) {
  const match = [...places].sort((a, b) => b.match - a.match)[0] ?? null;
  const distance = places
    .filter((place) => Number.isFinite(comparableDistance(place)))
    .sort((a, b) => comparableDistance(a) - comparableDistance(b))[0] ?? null;
  const cost = places
    .filter((place) => comparisonCost(place) !== null)
    .sort((a, b) => comparisonCost(a)! - comparisonCost(b)!)[0] ?? null;

  return { matchId: match?.id ?? null, distanceId: distance?.id ?? null, costId: cost?.id ?? null };
}
