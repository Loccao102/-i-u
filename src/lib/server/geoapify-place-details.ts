import "server-only";

import type { ProviderPlaceDetails } from "../types";
import { cleanPlainText } from "../validation";

const detailsCache = new Map<
  string,
  { expiresAt: number; data: ProviderPlaceDetails | null }
>();

function apiKey() {
  return process.env.GEOAPIFY_API_KEY?.trim() || null;
}

export function isGeoapifyDetailsConfigured() {
  return Boolean(apiKey());
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const text = cleanPlainText(value, max);
  return text || null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeEmail(value: unknown) {
  const email = optionalText(value, 160);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function categoryLabel(value: string) {
  const exact: Record<string, string> = {
    "catering.restaurant": "Nhà hàng",
    "catering.cafe": "Cafe",
    "catering.fast_food": "Đồ ăn nhanh",
    "catering.food_court": "Khu ẩm thực",
    "catering.bar": "Bar",
    "catering.pub": "Pub",
    "entertainment.cinema": "Rạp phim",
    "entertainment.museum": "Bảo tàng",
    "entertainment.bowling_alley": "Bowling",
    "entertainment.escape_game": "Escape room",
    "tourism.attraction": "Điểm tham quan",
    "tourism.sights": "Điểm tham quan",
    "leisure.park": "Công viên"
  };

  if (exact[value]) return exact[value];

  const last = value.split(".").at(-1) ?? value;
  return last
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function parseProviderId(providerId: string) {
  if (!providerId.startsWith("geoapify:")) {
    throw new Error("INVALID_BODY");
  }

  const id = providerId.slice("geoapify:".length).trim();
  if (
    id.length < 8 ||
    id.length > 200 ||
    !/^[A-Za-z0-9._~:-]+$/.test(id)
  ) {
    throw new Error("INVALID_BODY");
  }

  return id;
}

function parseDetailsFeature(
  providerId: string,
  raw: unknown
): ProviderPlaceDetails | null {
  if (!raw || typeof raw !== "object") return null;

  const features = Array.isArray(
    (raw as { features?: unknown }).features
  )
    ? ((raw as { features: unknown[] }).features ?? [])
    : [];

  const feature = features.find((item) => {
    if (!item || typeof item !== "object") return false;
    const properties = objectValue(
      (item as { properties?: unknown }).properties
    );
    return properties.feature_type === "details";
  });

  if (!feature || typeof feature !== "object") return null;

  const properties = objectValue(
    (feature as { properties?: unknown }).properties
  );
  const contact = objectValue(properties.contact);
  const parkingRaw = objectValue(properties.parking);
  const wheelchairDetails = objectValue(
    properties.wheelchair_details
  );

  const rawCategories = Array.isArray(properties.categories)
    ? properties.categories.filter(
        (item): item is string => typeof item === "string"
      )
    : [];

  const categories = Array.from(
    new Set(
      rawCategories
        .filter(
          (item) =>
            !item.startsWith("wheelchair") &&
            !item.startsWith("internet_access") &&
            !item.startsWith("dogs")
        )
        .map(categoryLabel)
        .filter(Boolean)
    )
  ).slice(0, 6);

  const facilities: string[] = [];
  const positiveFacilities: Array<[unknown, string]> = [
    [properties.internet_access, "Có Internet / Wi-Fi"],
    [properties.toilets, "Có nhà vệ sinh"],
    [properties.air_conditioning, "Có điều hòa"],
    [properties.outdoor_seating, "Có chỗ ngồi ngoài trời"],
    [properties.takeaway, "Có mang đi"],
    [properties.delivery, "Có giao hàng"],
    [properties.dogs, "Cho phép thú cưng"]
  ];

  for (const [value, label] of positiveFacilities) {
    if (value === true) facilities.push(label);
  }

  const wheelchair = optionalBoolean(properties.wheelchair);
  if (wheelchair === true) facilities.push("Hỗ trợ xe lăn");
  if (wheelchair === false) facilities.push("Không hỗ trợ xe lăn");

  const smoking = optionalBoolean(properties.smoking);
  if (smoking === false) facilities.push("Không hút thuốc");

  const hasParkingData =
    Object.keys(parkingRaw).length > 0;

  return {
    provider: "geoapify",
    providerId,
    description: optionalText(properties.description, 500),
    brand: optionalText(properties.brand, 120),
    website:
      safeHttpUrl(properties.website) ??
      safeHttpUrl(objectValue(properties.brand_details).website),
    phone: optionalText(contact.phone, 80),
    email: safeEmail(contact.email),
    openingHours: optionalText(properties.opening_hours, 160),
    categories,
    facilities: Array.from(new Set(facilities)).slice(0, 8),
    wheelchairNote:
      optionalText(wheelchairDetails.description, 220) ??
      optionalText(wheelchairDetails.condition, 100),
    parking: hasParkingData
      ? {
          type: optionalText(parkingRaw.type, 80),
          fee: optionalBoolean(parkingRaw.fee),
          access: optionalText(parkingRaw.access, 80),
          capacity: optionalText(parkingRaw.capacity, 40),
          supervised: optionalBoolean(parkingRaw.supervised)
        }
      : null
  };
}

export async function getGeoapifyPlaceDetails(
  providerId: string
): Promise<ProviderPlaceDetails | null> {
  const key = apiKey();
  if (!key) return null;

  const id = parseProviderId(providerId);
  const cacheKey = "details:" + id;
  const cached = detailsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = new URL("https://api.geoapify.com/v2/place-details");
  url.searchParams.set("id", id);
  url.searchParams.set("features", "details");
  url.searchParams.set("lang", "vi");
  url.searchParams.set("apiKey", key);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("POI_PROVIDER_UNAVAILABLE");
  }

  const data = parseDetailsFeature(providerId, await response.json());

  detailsCache.set(cacheKey, {
    expiresAt: Date.now() + 30 * 60 * 1000,
    data
  });

  return data;
}
