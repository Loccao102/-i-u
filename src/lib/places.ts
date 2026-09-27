import type { Place, PoiSearchResult, Scenario } from "./types";

export const scenarioLabels: Record<Scenario, string> = {
  date: "Date",
  friends: "Bạn bè",
  food: "Ăn uống",
  coffee: "Cafe",
  fun: "Vui chơi",
  chill: "Chill"
};

export function placeFromPoiResult(result: PoiSearchResult): Place {
  const scenarios = result.scenarios;

  return {
    id: "provider:" + result.providerId,
    name: result.name,
    kind: result.kind,
    description: result.displayName,
    latitude: result.latitude,
    longitude: result.longitude,
    distanceKm: 0,
    priceLabel: "$",
    averageForTwo: "Chưa có dữ liệu",
    publicRating: 0,
    match: 72,
    communityNote: "Dữ liệu OpenStreetMap",
    openUntil: result.openingHours ?? "Chưa rõ",
    bestTime: "Chưa có dữ liệu",
    noise: "Vừa",
    crowd: "Vừa",
    tags: scenarios.map((item) => scenarioLabels[item]),
    scenarios,
    note: "",
    accent: result.accent,
    source: "provider",
    providerId: result.providerId,
    address: result.address ?? result.displayName
  };
}
