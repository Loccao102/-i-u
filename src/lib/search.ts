import type {
  Collection,
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
    if (Number.isFinite(time)) {
      current.latestAt = Math.max(current.latestAt, time);
    }
    result.set(visit.placeId, current);
  }

  return result;
}

function personalScore(
  place: Place,
  selectedScenario: Scenario | "all",
  detected: Scenario[],
  distanceKm: number,
  signals?: PersonalSignals,
  stats?: ReadonlyMap<string, { count: number; latestAt: number }>
) {
  let score = 44;
  const reasons: string[] = [];

  if (
    selectedScenario !== "all" &&
    place.scenarios.includes(selectedScenario)
  ) {
    score += 14;
    reasons.push(`Hợp ${selectedScenario}`);
  }

  if (detected.some((item) => place.scenarios.includes(item))) {
    score += 10;
    reasons.push("Khớp điều bạn đang tìm");
  }

  const rating = signals?.ratings[place.id];
  if (rating) {
    score += rating.stars * 4.5;
    reasons.push(`Bạn từng chấm ${rating.stars}/5`);

    if (rating.revisit === "yes") {
      score += 8;
      reasons.push("Bạn muốn quay lại");
    }

    if (rating.revisit === "no") {
      score -= 10;
      reasons.push("Bạn từng không muốn quay lại");
    }

    if (
      selectedScenario !== "all" &&
      rating.contexts.includes(selectedScenario)
    ) {
      score += 7;
    }
  } else if (place.publicRating > 0) {
    score += place.publicRating * 1.5;
  }

  if (signals?.savedIds.has(place.id)) {
    score += 4;
    reasons.push("Đã lưu");
  }

  const placeStats = stats?.get(place.id);
  if (placeStats) {
    score += Math.min(6, placeStats.count * 1.5);
    reasons.push(`Đã đi ${placeStats.count} lần`);

    const ageDays =
      (Date.now() - placeStats.latestAt) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) {
      score += 3;
      reasons.push("Bạn mới ghé gần đây");
    }
  }

  if (Number.isFinite(distanceKm)) {
    score += Math.max(0, 14 - Math.min(14, distanceKm * 2.2));
    if (distanceKm <= 2) {
      reasons.push("Rất gần bạn");
    } else if (distanceKm <= 5) {
      reasons.push("Khá gần");
    }
  }

  return {
    score: Math.max(1, Math.min(99, Math.round(score))),
    reasons: Array.from(new Set(reasons)).slice(0, 4)
  };
}

export function filterPlaces(
  source: Place[],
  query: string,
  scenario: Scenario | "all",
  userLocation: UserLocation | null,
  signals?: PersonalSignals,
  serverDistances?: Readonly<Record<string, number>>
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
      const serverDistance = serverDistances?.[place.id];
      const computedDistance =
        typeof serverDistance === "number"
          ? serverDistance
          : userLocation
            ? haversineKm(userLocation, {
                latitude: place.latitude,
                longitude: place.longitude
              })
            : place.distanceKm;

      const rating = signals?.ratings[place.id];
      const personalized = personalScore(
        place,
        scenario,
        detected,
        computedDistance,
        signals,
        stats ?? undefined
      );

      return {
        ...place,
        personalRating: rating?.stars,
        distanceKm: computedDistance,
        match: personalized.score,
        recommendationReasons: personalized.reasons,
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

export function recommendForCollection(
  collection: Collection,
  source: Place[],
  signals: PersonalSignals,
  limit = 4
) {
  const memberIds = new Set(collection.placeIds);
  const memberPlaces = source.filter((place) => memberIds.has(place.id));

  if (memberPlaces.length === 0) return [];

  const scenarioWeights = new Map<Scenario, number>();
  const tagWeights = new Map<string, number>();

  for (const place of memberPlaces) {
    const personalRating = signals.ratings[place.id]?.stars ?? 3;

    for (const scenario of place.scenarios) {
      scenarioWeights.set(
        scenario,
        (scenarioWeights.get(scenario) ?? 0) + personalRating
      );
    }

    for (const tag of place.tags) {
      const key = normalize(tag);
      tagWeights.set(key, (tagWeights.get(key) ?? 0) + personalRating);
    }
  }

  return source
    .filter((place) => !memberIds.has(place.id))
    .map((place) => {
      let affinity = 0;
      const reasons: string[] = [];

      const matchingScenarios = place.scenarios
        .map((scenario) => ({
          scenario,
          weight: scenarioWeights.get(scenario) ?? 0
        }))
        .filter((item) => item.weight > 0)
        .sort((a, b) => b.weight - a.weight);

      if (matchingScenarios.length > 0) {
        affinity += matchingScenarios.reduce(
          (sum, item) => sum + item.weight,
          0
        );
        reasons.push("Cùng kiểu với các chỗ trong bộ sưu tập");
      }

      const matchingTags = place.tags
        .map((tag) => ({
          tag,
          weight: tagWeights.get(normalize(tag)) ?? 0
        }))
        .filter((item) => item.weight > 0)
        .sort((a, b) => b.weight - a.weight);

      if (matchingTags.length > 0) {
        affinity += matchingTags
          .slice(0, 3)
          .reduce((sum, item) => sum + item.weight * 0.6, 0);
        reasons.push(
          "Có vibe tương tự: " +
            matchingTags
              .slice(0, 2)
              .map((item) => item.tag)
              .join(", ")
        );
      }

      if (signals.savedIds.has(place.id)) affinity += 2;
      const rating = signals.ratings[place.id];
      if (rating) affinity += rating.stars * 0.5;

      return {
        ...place,
        collectionAffinity: affinity,
        collectionReasons: reasons.slice(0, 2)
      };
    })
    .filter((place) => place.collectionAffinity > 0)
    .sort(
      (a, b) =>
        b.collectionAffinity - a.collectionAffinity ||
        b.match - a.match
    )
    .slice(0, limit);
}
