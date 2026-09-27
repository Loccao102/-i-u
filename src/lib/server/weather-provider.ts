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

function optionalFinite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function baseUrl() {
  const apiKey = process.env.OPEN_METEO_API_KEY?.trim();
  return {
    apiKey,
    url: apiKey
      ? "https://customer-api.open-meteo.com/v1/forecast"
      : "https://api.open-meteo.com/v1/forecast"
  };
}

function localTimestampToEpoch(
  value: string,
  utcOffsetSeconds: number
) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;

  return (
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5])
    ) -
    utcOffsetSeconds * 1000
  );
}

function hourlyArray(
  hourly: Record<string, unknown>,
  key: string
): unknown[] {
  const value = hourly[key];
  return Array.isArray(value) ? value : [];
}

function nearestForecastIndex(
  times: unknown[],
  targetMs: number,
  utcOffsetSeconds: number
) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  times.forEach((value, index) => {
    if (typeof value !== "string") return;
    const epoch = localTimestampToEpoch(value, utcOffsetSeconds);
    if (!Number.isFinite(epoch)) return;

    const distance = Math.abs(epoch - targetMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export async function getWeatherContext(
  latitude: number,
  longitude: number,
  targetAt?: Date
): Promise<WeatherContext> {
  const targetMs = targetAt?.getTime();
  const forecastMode =
    targetAt instanceof Date && Number.isFinite(targetMs);

  const cacheTarget = forecastMode
    ? String(Math.round(targetMs! / (60 * 60 * 1000)))
    : "current";
  const key =
    latitude.toFixed(2) +
    "|" +
    longitude.toFixed(2) +
    "|" +
    cacheTarget;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const endpoint = baseUrl();
  const url = new URL(endpoint.url);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("timezone", "auto");

  if (forecastMode) {
    url.searchParams.set(
      "hourly",
      [
        "temperature_2m",
        "precipitation",
        "precipitation_probability",
        "weather_code",
        "is_day"
      ].join(",")
    );
    url.searchParams.set("forecast_hours", "36");
  } else {
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
    url.searchParams.set("forecast_days", "1");
  }

  if (endpoint.apiKey) {
    url.searchParams.set("apikey", endpoint.apiKey);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "DiDau/0.2 forecast-aware-planning"
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
  const timezone =
    typeof root.timezone === "string" ? root.timezone : "auto";

  let data: WeatherContext;

  if (forecastMode) {
    const hourly =
      root.hourly && typeof root.hourly === "object"
        ? (root.hourly as Record<string, unknown>)
        : null;

    if (!hourly) {
      throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
    }

    const times = hourlyArray(hourly, "time");
    const utcOffsetSeconds = finite(root.utc_offset_seconds);
    const index = nearestForecastIndex(
      times,
      targetMs!,
      utcOffsetSeconds
    );

    if (index < 0 || typeof times[index] !== "string") {
      throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
    }

    const codes = hourlyArray(hourly, "weather_code");
    const temperatures = hourlyArray(hourly, "temperature_2m");
    const precipitation = hourlyArray(hourly, "precipitation");
    const probability = hourlyArray(
      hourly,
      "precipitation_probability"
    );
    const isDay = hourlyArray(hourly, "is_day");
    const code = Math.round(finite(codes[index]));
    const forecastFor = String(times[index]);

    data = {
      condition: weatherCondition(code),
      temperatureC: finite(temperatures[index]),
      precipitationMm: finite(precipitation[index]),
      precipitationProbability: optionalFinite(probability[index]),
      weatherCode: code,
      isDay: finite(isDay[index]) === 1,
      observedAt: new Date().toISOString(),
      forecastFor,
      mode: "forecast",
      timezone,
      source: "Open-Meteo"
    };
  } else {
    const current =
      root.current && typeof root.current === "object"
        ? (root.current as Record<string, unknown>)
        : null;

    if (!current) {
      throw new Error("WEATHER_PROVIDER_UNAVAILABLE");
    }

    const code = Math.round(finite(current.weather_code));

    data = {
      condition: weatherCondition(code),
      temperatureC: finite(current.temperature_2m),
      precipitationMm: finite(current.precipitation),
      precipitationProbability: null,
      weatherCode: code,
      isDay: finite(current.is_day) === 1,
      observedAt:
        typeof current.time === "string"
          ? current.time
          : new Date().toISOString(),
      forecastFor: null,
      mode: "current",
      timezone,
      source: "Open-Meteo"
    };
  }

  cache.set(key, {
    expiresAt: Date.now() + 10 * 60 * 1000,
    data
  });

  return data;
}
