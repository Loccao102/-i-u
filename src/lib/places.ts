import {
  estimateProviderCost,
  formatProviderCostEstimate
} from "./cost-estimation";
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
  const cost = estimateProviderCost(result);

  return {
    id: "provider:" + result.providerId,
    name: result.name,
    kind: result.kind,
    description: result.displayName,
    latitude: result.latitude,
    longitude: result.longitude,
    distanceKm: 0,
    priceLabel: cost?.priceLabel ?? "$",
    averageForTwo: cost
      ? formatProviderCostEstimate(cost.amountForTwo)
      : "Chưa có dữ liệu",
    costSource: cost ? "provider_estimate" : "unknown",
    costConfidence: cost?.confidence ?? 0,
    publicRating: 0,
    match: 72,
    communityNote:
      result.provider === "geoapify"
        ? "Dữ liệu Geoapify"
        : "Dữ liệu OpenStreetMap",
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
