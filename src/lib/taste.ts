import type {
  PersonalRating,
  Place,
  RecommendationFeedback,
  Scenario,
  TasteProfile,
  VisitRecord
} from "./types";

type Bucket = {
  sum: number;
  count: number;
};

const scenarioLabel: Record<Scenario, string> = {
  date: "date",
  friends: "đi cùng bạn bè",
  food: "ăn uống",
  coffee: "cafe",
  fun: "vui chơi",
  chill: "chill"
};

function add<K>(
  map: Map<K, Bucket>,
  key: K,
  value: number
) {
  const current = map.get(key) ?? { sum: 0, count: 0 };
  current.sum += value;
  current.count += 1;
  map.set(key, current);
}

function normalized(bucket: Bucket | undefined) {
  if (!bucket || bucket.count === 0) return 0;
  const average = bucket.sum / bucket.count;
  return Math.max(-1, Math.min(1, average / 2.5));
}

function ratingSignal(rating: PersonalRating) {
  const centered = rating.stars - 3;
  const revisit =
    rating.revisit === "yes"
      ? 0.75
      : rating.revisit === "no"
        ? -1.25
        : 0;
  return centered + revisit;
}

function strongest<K>(
  values: ReadonlyArray<K>,
  score: (key: K) => number
) {
  let best: K | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const next = score(value);
    if (next > bestScore) {
      best = value;
      bestScore = next;
    }
  }

  return bestScore > 0.15 ? best : null;
}

export function deriveTasteProfile(
  places: ReadonlyArray<Place>,
  ratings: Readonly<Record<string, PersonalRating>>,
  visits: ReadonlyArray<VisitRecord>,
  feedbacks: Readonly<Record<string, RecommendationFeedback>> = {}
): TasteProfile {
  const byId = new Map(places.map((place) => [place.id, place]));
  const visitCounts = new Map<string, number>();

  for (const visit of visits) {
    visitCounts.set(
      visit.placeId,
      (visitCounts.get(visit.placeId) ?? 0) + 1
    );
  }

  const scenarioBuckets = new Map<Scenario, Bucket>();
  const priceBuckets = new Map<Place["priceLabel"], Bucket>();
  const noiseBuckets = new Map<Place["noise"], Bucket>();
  const crowdBuckets = new Map<Place["crowd"], Bucket>();

  const observedPlaces = new Set<string>();

  for (const [placeId, rating] of Object.entries(ratings)) {
    const place = byId.get(placeId);
    if (!place) continue;

    observedPlaces.add(placeId);
    const repeatBonus = Math.min(0.45, (visitCounts.get(placeId) ?? 0) * 0.12);
    const signal = ratingSignal(rating) + repeatBonus;
    const contexts = new Set<Scenario>([
      ...place.scenarios,
      ...rating.contexts
    ]);

    for (const scenario of contexts) {
      add(scenarioBuckets, scenario, signal);
    }
    add(priceBuckets, place.priceLabel, signal);
    add(noiseBuckets, place.noise, signal);
    add(crowdBuckets, place.crowd, signal);
  }

  for (const [placeId, count] of visitCounts) {
    if (observedPlaces.has(placeId)) continue;
    const place = byId.get(placeId);
    if (!place) continue;

    observedPlaces.add(placeId);
    const weakPositive = Math.min(0.65, count * 0.18);

    for (const scenario of place.scenarios) {
      add(scenarioBuckets, scenario, weakPositive);
    }
    add(priceBuckets, place.priceLabel, weakPositive);
    add(noiseBuckets, place.noise, weakPositive);
    add(crowdBuckets, place.crowd, weakPositive);
  }

  for (const [placeId, feedback] of Object.entries(feedbacks)) {
    const place = byId.get(placeId);
    if (!place) continue;

    if (feedback.reason === "not_taste") {
      observedPlaces.add(placeId);
      const contexts = feedback.scenario
        ? [feedback.scenario]
        : place.scenarios;

      for (const scenario of contexts) {
        add(scenarioBuckets, scenario, -1.6);
      }

      add(noiseBuckets, place.noise, -1.1);
      add(crowdBuckets, place.crowd, -0.8);
      add(priceBuckets, place.priceLabel, -0.25);
    }

    if (feedback.reason === "too_expensive") {
      observedPlaces.add(placeId);
      add(priceBuckets, place.priceLabel, -1.8);
    }
  }

  const scenarioScores: Partial<Record<Scenario, number>> = {};
  for (const scenario of [
    "date",
    "friends",
    "food",
    "coffee",
    "fun",
    "chill"
  ] as Scenario[]) {
    scenarioScores[scenario] = normalized(scenarioBuckets.get(scenario));
  }

  const priceScores = {
    $: normalized(priceBuckets.get("$")),
    $$: normalized(priceBuckets.get("$$")),
    $$$: normalized(priceBuckets.get("$$$"))
  };

  const noiseValues: Place["noise"][] = ["Yên", "Vừa", "Sôi động"];
  const crowdValues: Place["crowd"][] = ["Vắng", "Vừa", "Đông"];

  const noiseScores: Record<Place["noise"], number> = {
    Yên: normalized(noiseBuckets.get("Yên")),
    Vừa: normalized(noiseBuckets.get("Vừa")),
    "Sôi động": normalized(noiseBuckets.get("Sôi động"))
  };

  const crowdScores: Record<Place["crowd"], number> = {
    Vắng: normalized(crowdBuckets.get("Vắng")),
    Vừa: normalized(crowdBuckets.get("Vừa")),
    Đông: normalized(crowdBuckets.get("Đông"))
  };

  const topScenarios = (Object.keys(scenarioScores) as Scenario[])
    .filter((scenario) => (scenarioScores[scenario] ?? 0) > 0.15)
    .sort(
      (a, b) =>
        (scenarioScores[b] ?? 0) - (scenarioScores[a] ?? 0)
    )
    .slice(0, 3);

  const sampleSize = observedPlaces.size;

  return {
    sampleSize,
    confidence: Math.min(1, sampleSize / 6),
    scenarioScores,
    priceScores,
    noiseScores,
    crowdScores,
    topScenarios,
    preferredPrice: strongest(
      ["$", "$$", "$$$"] as Place["priceLabel"][],
      (value) => priceScores[value]
    ),
    preferredNoise: strongest(
      noiseValues,
      (value) => noiseScores[value]
    ),
    preferredCrowd: strongest(
      crowdValues,
      (value) => crowdScores[value]
    )
  };
}

export function scoreTasteMatch(
  place: Place,
  profile: TasteProfile
) {
  if (profile.sampleSize === 0 || profile.confidence <= 0) {
    return { score: 0, reasons: [] as string[] };
  }

  const scenarioValues = place.scenarios
    .map((scenario) => profile.scenarioScores[scenario] ?? 0);

  const scenarioFit =
    scenarioValues.length > 0
      ? scenarioValues.reduce((sum, value) => sum + value, 0) /
        scenarioValues.length
      : 0;

  const priceFit = profile.priceScores[place.priceLabel] ?? 0;
  const noiseFit = profile.noiseScores[place.noise] ?? 0;
  const crowdFit = profile.crowdScores[place.crowd] ?? 0;

  const raw =
    scenarioFit * 8 +
    priceFit * 4.5 +
    noiseFit * 3 +
    crowdFit * 2;

  const reasons: string[] = [];
  const bestScenario = strongest(
    place.scenarios,
    (scenario) => profile.scenarioScores[scenario] ?? 0
  );

  if (
    bestScenario &&
    (profile.scenarioScores[bestScenario] ?? 0) >= 0.3
  ) {
    reasons.push(
      "Hợp gu " + scenarioLabel[bestScenario] + " bạn thường thích"
    );
  }

  if (priceFit >= 0.35) {
    reasons.push("Đúng tầm giá bạn hay chọn");
  }

  if (noiseFit >= 0.4) {
    reasons.push(
      place.noise === "Yên"
        ? "Hợp gu không gian yên"
        : place.noise === "Sôi động"
          ? "Hợp gu không khí sôi động"
          : "Hợp mức độ ồn bạn thường chọn"
    );
  }

  return {
    score: raw * profile.confidence,
    reasons: reasons.slice(0, 2)
  };
}

export function tasteProfileSummary(profile: TasteProfile) {
  if (profile.sampleSize === 0) {
    return "Chưa đủ dữ liệu để học gu";
  }

  const parts: string[] = [];

  if (profile.topScenarios[0]) {
    parts.push(scenarioLabel[profile.topScenarios[0]]);
  }

  if (profile.preferredNoise === "Yên") {
    parts.push("không gian yên");
  } else if (profile.preferredNoise === "Sôi động") {
    parts.push("sôi động");
  }

  if (profile.preferredPrice) {
    parts.push("mức " + profile.preferredPrice);
  }

  return parts.length > 0
    ? parts.slice(0, 3).join(" · ")
    : "Đang học từ " + profile.sampleSize + " trải nghiệm";
}
