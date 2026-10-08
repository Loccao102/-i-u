import type { Place } from "./types";

export type LibrarySource = "all" | "excel" | "map" | "manual";

export function librarySourceOf(place: Place): Exclude<LibrarySource, "all"> {
  const note = place.communityNote.toLocaleLowerCase("vi-VN");
  if (note.startsWith("nhập excel")) return "excel";
  if (place.source === "provider" || note.startsWith("nhập từ ")) return "map";
  return "manual";
}

export function librarySourceCounts(places: readonly Place[]) {
  const result = { all: places.length, excel: 0, map: 0, manual: 0 };
  for (const place of places) {
    result[librarySourceOf(place)] += 1;
  }
  return result;
}

export function filterLibraryPlaces(places: readonly Place[], source: LibrarySource): Place[] {
  if (source === "all") return [...places];
  return places.filter(place => librarySourceOf(place) === source);
}
