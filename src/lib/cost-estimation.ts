import type { Place, PoiSearchResult } from "./types";

export type ProviderCostEstimate = {
  amountForTwo: number;
  priceLabel: Place["priceLabel"];
  confidence: number;
};

export function priceLabelForCost(amount: number): Place["priceLabel"] {
  if (amount <= 220_000) return "$";
  if (amount <= 500_000) return "$$";
  return "$$$";
}

function estimateFromText(text: string): Omit<ProviderCostEstimate, "priceLabel"> | null {
  const raw = text.toLowerCase();

  if (/catering\.fast_food|fast_food/.test(raw)) {
    return { amountForTwo: 180_000, confidence: 66 };
  }
  if (/catering\.food_court|food_court/.test(raw)) {
    return { amountForTwo: 220_000, confidence: 62 };
  }
  if (/catering\.cafe|\bcafe\b|coffee/.test(raw)) {
    return { amountForTwo: 180_000, confidence: 60 };
  }
  if (/catering\.(bar|pub)|\bbar\b|\bpub\b|biergarten/.test(raw)) {
    return { amountForTwo: 450_000, confidence: 52 };
  }
  if (/catering\.restaurant|restaurant/.test(raw)) {
    return { amountForTwo: 350_000, confidence: 55 };
  }

  if (/escape_game/.test(raw)) {
    return { amountForTwo: 500_000, confidence: 62 };
  }
  if (/bowling/.test(raw)) {
    return { amountForTwo: 360_000, confidence: 60 };
  }
  if (/cinema/.test(raw)) {
    return { amountForTwo: 320_000, confidence: 62 };
  }
  if (/amusement_arcade|arcade/.test(raw)) {
    return { amountForTwo: 260_000, confidence: 55 };
  }
  if (/aquarium|\bzoo\b/.test(raw)) {
    return { amountForTwo: 420_000, confidence: 50 };
  }
  if (/theme_park|water_park|activity_park/.test(raw)) {
    return { amountForTwo: 650_000, confidence: 48 };
  }
  if (/museum|gallery|heritage|theatre|arts_centre/.test(raw)) {
    return { amountForTwo: 200_000, confidence: 48 };
  }
  if (/sport|fitness|gym|swimming_pool|ice_rink/.test(raw)) {
    return { amountForTwo: 300_000, confidence: 40 };
  }
  if (/park|garden|picnic|beach|outdoor/.test(raw)) {
    return { amountForTwo: 80_000, confidence: 30 };
  }

  if (/\bactivity\b|attraction/.test(raw)) {
    return { amountForTwo: 350_000, confidence: 35 };
  }
  if (/\bculture\b/.test(raw)) {
    return { amountForTwo: 220_000, confidence: 35 };
  }

  return null;
}

export function estimateProviderCost(
  place: Pick<PoiSearchResult, "kind" | "name" | "providerCategories">
): ProviderCostEstimate | null {
  const categories = place.providerCategories ?? [];
  const raw = [place.kind, place.name, ...categories].join(" ");
  const estimate = estimateFromText(raw);
  if (!estimate) return null;

  return {
    ...estimate,
    priceLabel: priceLabelForCost(estimate.amountForTwo)
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
