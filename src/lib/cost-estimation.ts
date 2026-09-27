import type { Place, PoiSearchResult } from "./types";

export type ProviderCostFamily =
  | "fast_food"
  | "food_court"
  | "cafe"
  | "bar"
  | "restaurant"
  | "escape_game"
  | "bowling"
  | "cinema"
  | "arcade"
  | "aquarium_zoo"
  | "theme_park"
  | "culture"
  | "sport"
  | "outdoor"
  | "activity";

export type ProviderCostEstimate = {
  amountForTwo: number;
  priceLabel: Place["priceLabel"];
  confidence: number;
  family: ProviderCostFamily;
};

export type ProviderCostCalibration = {
  sampleSize: number;
  overallMultiplier: number | null;
  byFamily: Partial<
    Record<
      ProviderCostFamily,
      {
        multiplier: number;
        sampleSize: number;
      }
    >
  >;
};

type CostSignal = {
  kind: string;
  name: string;
  providerCategories?: string[];
  tags?: string[];
};

export function priceLabelForCost(amount: number): Place["priceLabel"] {
  if (amount <= 220_000) return "$";
  if (amount <= 500_000) return "$$";
  return "$$$";
}

export function parseCostAmount(value: string) {
  const plain = /^\s*([\d.,]+)\s*(?:₫|đ|vnd)?\s*$/i.exec(value);
  if (plain) {
    const digits = plain[1]!.replace(/[.,]/g, "");
    const number = Number(digits);
    if (Number.isFinite(number) && number >= 10_000) {
      return Math.round(number);
    }
  }

  const range =
    /(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|triệu|tr)\b/i.exec(
      value
    );

  if (range) {
    const low = Number(range[1]!.replace(",", "."));
    const high = Number(range[2]!.replace(",", "."));
    const unit = range[3]!.toLocaleLowerCase("vi-VN");
    if (Number.isFinite(low) && Number.isFinite(high)) {
      const multiplier =
        unit === "triệu" || unit === "tr" ? 1_000_000 : 1_000;
      return Math.round(((low + high) / 2) * multiplier);
    }
  }

  const matches = Array.from(
    value.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|triệu|tr)\b/gi
    )
  );

  if (matches.length === 0) return null;

  const values = matches
    .map((match) => {
      const raw = Number(match[1]!.replace(",", "."));
      if (!Number.isFinite(raw)) return null;
      const unit = match[2]!.toLocaleLowerCase("vi-VN");
      return unit === "triệu" || unit === "tr"
        ? raw * 1_000_000
        : raw * 1_000;
    })
    .filter((item): item is number => item !== null);

  if (values.length === 0) return null;
  return Math.round(
    values.reduce((sum, item) => sum + item, 0) / values.length
  );
}

function baseEstimate(
  signal: CostSignal
): Omit<ProviderCostEstimate, "priceLabel"> | null {
  const raw = [
    signal.kind,
    signal.name,
    ...(signal.providerCategories ?? []),
    ...(signal.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();

  if (/catering\.fast_food|fast_food/.test(raw)) {
    return { amountForTwo: 180_000, confidence: 66, family: "fast_food" };
  }
  if (/catering\.food_court|food_court/.test(raw)) {
    return { amountForTwo: 220_000, confidence: 62, family: "food_court" };
  }
  if (/catering\.cafe|\bcafe\b|coffee/.test(raw)) {
    return { amountForTwo: 180_000, confidence: 60, family: "cafe" };
  }
  if (/catering\.(bar|pub)|\bbar\b|\bpub\b|biergarten/.test(raw)) {
    return { amountForTwo: 450_000, confidence: 52, family: "bar" };
  }
  if (/catering\.restaurant|restaurant/.test(raw)) {
    return { amountForTwo: 350_000, confidence: 55, family: "restaurant" };
  }
  if (/escape_game/.test(raw)) {
    return { amountForTwo: 500_000, confidence: 62, family: "escape_game" };
  }
  if (/bowling/.test(raw)) {
    return { amountForTwo: 360_000, confidence: 60, family: "bowling" };
  }
  if (/cinema/.test(raw)) {
    return { amountForTwo: 320_000, confidence: 62, family: "cinema" };
  }
  if (/amusement_arcade|arcade/.test(raw)) {
    return { amountForTwo: 260_000, confidence: 55, family: "arcade" };
  }
  if (/aquarium|\bzoo\b/.test(raw)) {
    return { amountForTwo: 420_000, confidence: 50, family: "aquarium_zoo" };
  }
  if (/theme_park|water_park|activity_park/.test(raw)) {
    return { amountForTwo: 650_000, confidence: 48, family: "theme_park" };
  }
  if (/museum|gallery|heritage|theatre|arts_centre|\bculture\b/.test(raw)) {
    return { amountForTwo: 210_000, confidence: 46, family: "culture" };
  }
  if (/sport|fitness|gym|swimming_pool|ice_rink/.test(raw)) {
    return { amountForTwo: 300_000, confidence: 40, family: "sport" };
  }
  if (/park|garden|picnic|beach|outdoor/.test(raw)) {
    return { amountForTwo: 80_000, confidence: 30, family: "outdoor" };
  }
  if (/\bactivity\b|attraction/.test(raw)) {
    return { amountForTwo: 350_000, confidence: 35, family: "activity" };
  }

  return null;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function safeMultiplier(value: number) {
  return Math.max(0.75, Math.min(1.35, value));
}

export function deriveProviderCostCalibration(
  places: ReadonlyArray<Place>
): ProviderCostCalibration {
  const ratios: number[] = [];
  const grouped = new Map<ProviderCostFamily, number[]>();

  for (const place of places) {
    if (place.source !== "provider" || place.costSource !== "user") {
      continue;
    }

    const actual = parseCostAmount(place.averageForTwo);
    const baseline = baseEstimate({
      kind: place.kind,
      name: place.name,
      tags: place.tags
    });
    if (!actual || !baseline) continue;

    const rawRatio = actual / baseline.amountForTwo;
    if (!Number.isFinite(rawRatio) || rawRatio < 0.4 || rawRatio > 2.5) {
      continue;
    }

    ratios.push(rawRatio);
    const familyValues = grouped.get(baseline.family) ?? [];
    familyValues.push(rawRatio);
    grouped.set(baseline.family, familyValues);
  }

  const byFamily: ProviderCostCalibration["byFamily"] = {};
  for (const [family, values] of grouped) {
    if (values.length < 2) continue;
    const familyMedian = median(values);
    if (familyMedian === null) continue;
    byFamily[family] = {
      multiplier: safeMultiplier(familyMedian),
      sampleSize: values.length
    };
  }

  const overallMedian = ratios.length >= 3 ? median(ratios) : null;

  return {
    sampleSize: ratios.length,
    overallMultiplier:
      overallMedian === null ? null : safeMultiplier(overallMedian),
    byFamily
  };
}

export function estimateProviderCost(
  place: Pick<PoiSearchResult, "kind" | "name" | "providerCategories">,
  calibration?: ProviderCostCalibration
): ProviderCostEstimate | null {
  const estimate = baseEstimate(place);
  if (!estimate) return null;

  const familyCalibration = calibration?.byFamily[estimate.family];
  const multiplier =
    familyCalibration?.multiplier ??
    calibration?.overallMultiplier ??
    1;
  const calibrated = multiplier !== 1;
  const amountForTwo =
    Math.round((estimate.amountForTwo * multiplier) / 10_000) * 10_000;
  const sampleBonus = familyCalibration
    ? Math.min(12, familyCalibration.sampleSize * 3)
    : calibration?.overallMultiplier
      ? Math.min(8, calibration.sampleSize * 2)
      : 0;

  return {
    ...estimate,
    amountForTwo,
    confidence: Math.min(
      82,
      estimate.confidence + (calibrated ? sampleBonus : 0)
    ),
    priceLabel: priceLabelForCost(amountForTwo)
  };
}

export function formatProviderCostEstimate(amountForTwo: number) {
  if (amountForTwo >= 1_000_000) {
    return (
      "Ước tính ~" +
      (amountForTwo / 1_000_000).toLocaleString("vi-VN", {
        maximumFractionDigits: 1
      }) +
      " triệu"
    );
  }

  return "Ước tính ~" + Math.round(amountForTwo / 1000) + "k";
}

export function costBadgeLabel(
  place: Pick<Place, "averageForTwo" | "priceLabel" | "costSource">
) {
  if (place.averageForTwo === "Chưa có dữ liệu") return "Giá chưa rõ";

  if (place.costSource === "provider_estimate") {
    return place.averageForTwo
      .replace(/^Ước tính\s*/i, "≈ ")
      .replace(/\s*\/\s*2 người$/i, "");
  }

  return place.priceLabel;
}
