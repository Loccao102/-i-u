import type {
  PersonalRating,
  Place,
  Scenario,
  UserLocation,
  VisitRecord
} from "./types";

const scenarioTerms: Record<Scenario, string[]> = {
  date: ["date", "hẹn hò", "hen ho", "lãng mạn", "lang man"],
  friends: ["bạn", "ban", "nhóm", "nhom", "friends"],
  food: ["ăn", "an", "đói", "doi", "food", "dinner"],
  coffee: ["cafe", "coffee", "cà phê", "ca phe"],
  fun: ["chơi", "choi", "vui", "game", "activity"],
  chill: ["chill", "yên", "yen", "nói chuyện", "noi chuyen"]
};

export type PersonalSignals = {
  savedIds: ReadonlySet<string>;
  ratings: Readonly<Record<string, PersonalRating>>;
  visits: ReadonlyArray<VisitRecord>;
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

function visitStats(visits: ReadonlyArray<VisitRecord>) {
  const result = new Map<
    string,
    { count: number; latestAt: number }
  >();

  for (const visit of visits) {
    const current = result.get(visit.placeId) ?? {
      count: 0,
      latestAt: 0
    };
    current.count += 1;
    const time = new Date(visit.visitedAt).getTime();
    if (Number.isFinite(time)) current.latestAt = Math.max(current.latestAt, time);
    result.set(visit.placeId, current);
  }

  return result;
}

function personalScore(
  place: Place,
  selectedScenario: Scenario | "all",
  detected: Scenario[],
  distanceKm: number,
  signals?: PersonalSignals
) {
  let score = 44;

  if (selectedScenario !== "all" && place.scenarios.includes(selectedScenario)) {
    score += 14;
  }
  if (detected.some((item) => place.scenarios.includes(item))) score += 10;

  const rating = signals?.ratings[place.id];
  if (rating) {
    score += rating.stars * 4.5;
    if (rating.revisit === "yes") score += 8;
    if (rating.revisit === "no") score -= 10;
    if (
      selectedScenario !== "all" &&
      rating.contexts.includes(selectedScenario)
    ) {
      score += 7;
    }
  } else if (place.publicRating > 0) {
    score += place.publicRating * 1.5;
  }

  if (signals?.savedIds.has(place.id)) score += 4;

  if (signals) {
    const stats = visitStats(signals.visits).get(place.id);
    if (stats) {
      score += Math.min(6, stats.count * 1.5);
      const ageDays =
        (Date.now() - stats.latestAt) / (1000 * 60 * 60 * 24);
      if (ageDays < 30) score += 3;
    }
  }

  if (Number.isFinite(distanceKm)) {
    score += Math.max(0, 14 - Math.min(14, distanceKm * 2.2));
  }

  return Math.max(1, Math.min(99, Math.round(score)));
}

export function filterPlaces(
  source: Place[],
  query: string,
  scenario: Scenario | "all",
  userLocation: UserLocation | null,
  signals?: PersonalSignals
) {
  const normalized = normalize(query);
  const detected = detectScenarios(query);
  const stats = signals ? visitStats(signals.visits) : null;

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
          place.address ?? "",
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

      const textMatch =
        words.length === 0 ||
        words.some((word) => searchable.includes(word));
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

      const rating = signals?.ratings[place.id];
      const score = personalScore(
        place,
        scenario,
        detected,
        computedDistance,
        signals
      );

      return {
        ...place,
        personalRating: rating?.stars,
        distanceKm: computedDistance,
        match: score,
        communityNote:
          stats?.get(place.id)?.count
            ? `Bạn đã đi ${stats.get(place.id)!.count} lần`
            : place.communityNote
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
