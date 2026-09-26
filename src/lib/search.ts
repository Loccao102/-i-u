import type { Place, Scenario, UserLocation } from "./types";

const scenarioTerms: Record<Scenario, string[]> = {
  date: ["date", "hẹn hò", "hen ho", "lãng mạn", "lang man"],
  friends: ["bạn", "ban", "nhóm", "nhom", "friends"],
  food: ["ăn", "an", "đói", "doi", "food", "dinner"],
  coffee: ["cafe", "coffee", "cà phê", "ca phe"],
  fun: ["chơi", "choi", "vui", "game", "activity"],
  chill: ["chill", "yên", "yen", "nói chuyện", "noi chuyen"]
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("vi-VN");
}

export function detectScenarios(query: string): Scenario[] {
  const normalized = normalize(query);
  return (Object.keys(scenarioTerms) as Scenario[]).filter((scenario) =>
    scenarioTerms[scenario].some((term) => normalized.includes(term))
  );
}

export function haversineKm(
  pointA: UserLocation,
  pointB: UserLocation
): number {
  const earthRadiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(pointB.latitude - pointA.latitude);
  const dLon = toRad(pointB.longitude - pointA.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pointA.latitude)) *
      Math.cos(toRad(pointB.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterPlaces(
  source: Place[],
  query: string,
  scenario: Scenario | "all",
  userLocation: UserLocation | null
) {
  const normalized = normalize(query);
  const detected = detectScenarios(query);

  return source
    .filter((place) => {
      const scenarioMatch =
        scenario === "all" || place.scenarios.includes(scenario);
      if (!scenarioMatch) return false;
      if (!normalized) return true;

      const searchable = normalize(
        [
          place.name,
          place.kind,
          place.description,
          place.note,
          ...place.tags
        ].join(" ")
      );

      const words = normalized
        .split(/\s+/)
        .filter((word) => word.length > 1)
        .filter(
          (word) =>
            !["tối", "nay", "gần", "tôi", "cho", "với", "một"].includes(word)
        );

      const textMatch = words.length === 0 || words.some((word) => searchable.includes(word));
      const contextMatch =
        detected.length === 0 ||
        detected.some((item) => place.scenarios.includes(item));

      return textMatch || contextMatch;
    })
    .map((place) => {
      const computedDistance = userLocation
        ? haversineKm(userLocation, {
            latitude: place.latitude,
            longitude: place.longitude
          })
        : place.distanceKm;

      const contextBoost =
        detected.length > 0 &&
        detected.some((item) => place.scenarios.includes(item))
          ? 5
          : 0;

      return {
        ...place,
        distanceKm: computedDistance,
        match: Math.min(99, place.match + contextBoost)
      };
    })
    .sort(
      (a, b) =>
        b.match - a.match ||
        (b.personalRating ?? b.publicRating) -
          (a.personalRating ?? a.publicRating) ||
        a.distanceKm - b.distanceKm
    );
}
