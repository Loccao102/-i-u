import "server-only";

import type { WeatherCondition, WeatherContext } from "../types";

const cache = new Map<
  string,
  { expiresAt: number; data: WeatherContext }
>();

function weatherCondition(code: number): WeatherCondition {
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82)
  ) {
    return "rain";
  }
  if (
    (code >= 71 && code <= 77) ||
    code === 85 ||
    code === 86
  ) {
    return "snow";
  }
  if (code >= 95 && code <= 99) return "storm";
  return "cloudy";
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function getWeatherContext(
  latitude: number,
  longitude: number
): Promise<WeatherContext> {
  const key = latitude.toFixed(2) + "|" + longitude.toFixed(2);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const apiKey = process.env.OPEN_METEO_API_KEY?.trim();
  const baseUrl = apiKey
    ? "https://customer-api.open-meteo.com/v1/forecast"
    : "https://api.open-meteo.com/v1/forecast";

  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "precipitation",
      "rain",
      "showers",
      "weather_code",
      "is_day"
    ].join(",")
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  if (apiKey) url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "DiDau/0.1 context-aware-discovery"
    },
    next: { revalidate: 600 }
  });

  if (!response.ok) {
    throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
  }

  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object") {
    throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
  }

  const root = raw as Record<string, unknown>;
  const current =
    root.current && typeof root.current === "object"
      ? (root.current as Record<string, unknown>)
      : null;

  if (!current) {
    throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
  }

  const code = Math.round(finite(current.weather_code));
  const precipitation = finite(current.precipitation);

  const data: WeatherContext = {
    condition: weatherCondition(code),
    temperatureC: finite(current.temperature_2m),
    precipitationMm: precipitation,
    weatherCode: code,
    isDay: finite(current.is_day) === 1,
    observedAt:
      typeof current.time === "string"
        ? current.time
        : new Date().toISOString(),
    timezone:
      typeof root.timezone === "string" ? root.timezone : "auto",
    source: "Open-Meteo"
  };

  cache.set(key, {
    expiresAt: Date.now() + 10 * 60 * 1000,
    data
  });

  return data;
}
