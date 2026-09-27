import { scoreTasteMatch } from "./taste";
import type {
  Collection,
  PersonalRating,
  Place,
  RecommendationFeedback,
  RecommendationContext,
  Scenario,
  TasteProfile,
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
  feedbacks?: Readonly<Record<string, RecommendationFeedback>>;
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

function placeContextText(place: Place) {
  return normalize(
    [
      place.kind,
      place.description,
      place.note,
      place.bestTime,
      place.address ?? "",
      ...place.tags
    ].join(" ")
  );
}

function timeContextScore(
  place: Place,
  context: RecommendationContext | undefined
) {
  if (!context) return { score: 0, reasons: [] as string[] };

  const hour = context.localHour;
  const text = placeContextText(place);
  let score = 0;
  const reasons: string[] = [];

  const morning = hour >= 5 && hour < 11;
  const lunch = hour >= 11 && hour < 14;
  const afternoon = hour >= 14 && hour < 18;
  const evening = hour >= 18 && hour < 22;
  const late = hour >= 22 || hour < 5;

  if (morning) {
    if (place.scenarios.includes("coffee")) score += 5;
    if (place.scenarios.includes("food")) score += 2;
    if (/sáng|morning|breakfast/.test(text)) {
      score += 6;
      reasons.push("Hợp buổi sáng");
    }
  } else if (lunch) {
    if (place.scenarios.includes("food")) score += 5;
    if (/trưa|lunch/.test(text)) {
      score += 5;
      reasons.push("Hợp giờ trưa");
    }
  } else if (afternoon) {
    if (place.scenarios.includes("coffee")) score += 4;
    if (place.scenarios.includes("fun")) score += 3;
    if (/chiều|afternoon/.test(text)) {
      score += 4;
      reasons.push("Hợp buổi chiều");
    }
  } else if (evening) {
    if (
      place.scenarios.some((item) =>
        ["date", "chill", "food", "fun"].includes(item)
      )
    ) {
      score += 4;
    }
    if (/tối|evening|19:|20:|21:/.test(text)) {
      score += 6;
      reasons.push("Hợp đi tối nay");
    }
  } else if (late) {
    if (place.scenarios.includes("chill")) score += 4;
    if (/bar|drink/.test(normalize(place.kind))) score += 6;
    if (/muộn|late|22:|23:|00:/.test(text)) {
      score += 6;
      reasons.push("Hợp đi muộn");
    }
  }

  if (context.isWeekend) {
    if (
      place.scenarios.includes("friends") ||
      place.scenarios.includes("fun")
    ) {
      score += 3;
      reasons.push("Hợp cuối tuần");
    }
    if (place.crowd === "Đông") score -= 2;
  }

  return { score, reasons };
}

function weatherContextScore(
  place: Place,
  context: RecommendationContext | undefined
) {
  const weather = context?.weather;
  if (!weather) return { score: 0, reasons: [] as string[] };

  const text = placeContextText(place);
  const indoorLike =
    /indoor|trong nhà|có mái|có mái che|trời mưa|mưa|covered/.test(text);
  const outdoorLike =
    /outdoor|ngoài trời|rooftop|sân vườn|view hồ|view đẹp|terrace/.test(text);

  let score = 0;
  const reasons: string[] = [];

  if (weather.condition === "rain" || weather.condition === "storm") {
    if (indoorLike) {
      score += 10;
      reasons.push("Hợp trời mưa");
    } else if (
      place.kind === "Cafe" ||
      place.kind === "Restaurant" ||
      place.kind === "Activity"
    ) {
      score += 3;
      reasons.push("Dễ đi khi trời mưa");
    }

    if (outdoorLike && !indoorLike) score -= 6;
  }

  if (weather.condition === "clear" && outdoorLike) {
    score += 6;
    reasons.push("Trời đẹp hợp không gian mở");
  }

  if (weather.temperatureC >= 32) {
    if (
      !outdoorLike &&
      (place.kind === "Cafe" || place.kind === "Restaurant")
    ) {
      score += 3;
      reasons.push("Hợp tránh nóng");
    } else if (outdoorLike) {
      score -= 2;
    }
  }

  if (!weather.isDay) {
    if (
      place.scenarios.includes("date") ||
      place.scenarios.includes("chill") ||
      /bar|drink/.test(normalize(place.kind))
    ) {
      score += 3;
      reasons.push("Hợp buổi tối");
    }
  }

  return { score, reasons };
}

function recommendationFeedbackScore(
  feedback: RecommendationFeedback | undefined,
  selectedScenario: Scenario | "all",
  distanceKm: number
) {
  if (!feedback) {
    return { score: 0, reasons: [] as string[] };
  }

  const updatedAt = new Date(feedback.updatedAt).getTime();
  const ageHours = Number.isFinite(updatedAt)
    ? Math.max(0, (Date.now() - updatedAt) / (1000 * 60 * 60))
    : Number.POSITIVE_INFINITY;

  if (feedback.reason === "not_taste") {
    const contextMismatch =
      feedback.scenario &&
      selectedScenario !== "all" &&
      feedback.scenario !== selectedScenario;

    return {
      score: contextMismatch ? -12 : -22,
      reasons: ["Bạn từng đánh dấu không hợp gu"]
    };
  }

  if (feedback.reason === "not_now") {
    let penalty = ageHours <= 24 ? -20 : ageHours <= 72 ? -8 : ageHours <= 168 ? -3 : 0;

    if (
      feedback.scenario &&
      selectedScenario !== "all" &&
      feedback.scenario !== selectedScenario
    ) {
      penalty = Math.round(penalty * 0.35);
    }

    return {
      score: penalty,
      reasons: penalty < 0 ? ["Bạn từng chọn không phải lúc này"] : []
    };
  }

  if (feedback.reason === "too_far") {
    const previousDistance = feedback.distanceKm ?? distanceKm;

    if (
      distanceKm <= 2 ||
      (Number.isFinite(previousDistance) &&
        distanceKm <= Math.max(2, previousDistance * 0.55))
    ) {
      return { score: 0, reasons: [] as string[] };
    }

    return {
      score: -Math.min(18, Math.round(6 + distanceKm * 1.5)),
      reasons: ["Bạn từng thấy chỗ này quá xa"]
    };
  }

  return {
    score: -14,
    reasons: ["Bạn từng thấy chỗ này quá đắt"]
  };
}

function personalScore(
  place: Place,
  selectedScenario: Scenario | "all",
  detected: Scenario[],
  distanceKm: number,
  signals?: PersonalSignals,
  stats?: ReadonlyMap<string, { count: number; latestAt: number }>,
  context?: RecommendationContext,
  tasteProfile?: TasteProfile
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

  const timeSignal = timeContextScore(place, context);
  score += timeSignal.score;
  reasons.push(...timeSignal.reasons);

  const weatherSignal = weatherContextScore(place, context);
  score += weatherSignal.score;
  reasons.push(...weatherSignal.reasons);

  const feedbackSignal = recommendationFeedbackScore(
    signals?.feedbacks?.[place.id],
    selectedScenario,
    distanceKm
  );
  score += feedbackSignal.score;
  reasons.push(...feedbackSignal.reasons);


  const rating = signals?.ratings[place.id];
  if (rating) {
    score += (rating.stars - 3) * 5;
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
    score += (place.publicRating - 3) * 1.5;
  }

  if (tasteProfile) {
    const tasteSignal = scoreTasteMatch(place, tasteProfile);
    score += tasteSignal.score;
    reasons.push(...tasteSignal.reasons);
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
    reasons: Array.from(new Set(reasons)).slice(0, 5)
  };
}

export function filterPlaces(
  source: Place[],
  query: string,
  scenario: Scenario | "all",
  userLocation: UserLocation | null,
  signals?: PersonalSignals,
  serverDistances?: Readonly<Record<string, number>>,
  context?: RecommendationContext,
  tasteProfile?: TasteProfile
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
        stats ?? undefined,
        context,
        tasteProfile
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

export function pickSurprisePlace(
  source: Place[],
  signals: PersonalSignals
): Place | null {
  const accepted = source.filter((place) => {
    if (signals.ratings[place.id]?.revisit === "no") return false;

    const feedback = signals.feedbacks?.[place.id];
    if (feedback?.reason === "not_taste") return false;

    if (feedback?.reason === "not_now") {
      const time = new Date(feedback.updatedAt).getTime();
      if (
        Number.isFinite(time) &&
        Date.now() - time <= 24 * 60 * 60 * 1000
      ) {
        return false;
      }
    }

    return true;
  });
  const candidates = (accepted.length > 0 ? accepted : source).slice(0, 12);
  if (candidates.length === 0) return null;

  const stats = visitStats(signals.visits);
  const weighted = candidates.map((place) => {
    const count = stats.get(place.id)?.count ?? 0;
    const novelty = count === 0 ? 18 : Math.max(0, 6 - count * 2);
    const unsavedBonus = signals.savedIds.has(place.id) ? 0 : 3;
    return {
      place,
      weight: Math.max(1, place.match - 45 + novelty + unsavedBonus)
    };
  });

  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let target = Math.random() * total;

  for (const item of weighted) {
    target -= item.weight;
    if (target <= 0) return item.place;
  }

  return weighted[weighted.length - 1]!.place;
}

function deterministicUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function stablePlaceKey(place: Place) {
  return place.providerId ?? place.id;
}

export function pickDailyDiscoveryPlace(
  source: Place[],
  signals: PersonalSignals,
  input: {
    seed: string;
    avoidPlaceKeys?: ReadonlySet<string>;
  }
): Place | null {
  const accepted = source.filter((place) => {
    if (signals.ratings[place.id]?.revisit === "no") return false;

    const feedback = signals.feedbacks?.[place.id];
    if (feedback?.reason === "not_taste") return false;

    if (feedback?.reason === "not_now") {
      const time = new Date(feedback.updatedAt).getTime();
      if (
        Number.isFinite(time) &&
        Date.now() - time <= 24 * 60 * 60 * 1000
      ) {
        return false;
      }
    }

    return true;
  });

  const base = accepted.length > 0 ? accepted : source;
  if (base.length === 0) return null;

  const avoid = input.avoidPlaceKeys ?? new Set<string>();
  const fresh = base.filter(
    (place) => !avoid.has(stablePlaceKey(place))
  );
  const candidates = (fresh.length > 0 ? fresh : base).slice(0, 30);
  const stats = visitStats(signals.visits);

  return (
    candidates
      .map((place) => {
        const count = stats.get(place.id)?.count ?? 0;
        const neverVisitedBonus = count === 0 ? 30 : Math.max(0, 8 - count * 2);
        const unsavedBonus = signals.savedIds.has(place.id) ? 0 : 4;
        const dailyShuffle =
          deterministicUnit(input.seed + ":" + stablePlaceKey(place)) * 36;

        return {
          place,
          score:
            place.match * 0.8 +
            neverVisitedBonus +
            unsavedBonus +
            dailyShuffle
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.place.match - a.place.match ||
          a.place.distanceKm - b.place.distanceKm
      )[0]?.place ?? null
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
