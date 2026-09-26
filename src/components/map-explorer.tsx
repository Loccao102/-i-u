"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";
import type {
  Map as MapLibreMap,
  Marker as MapLibreMarker
} from "maplibre-gl";
import {
  CloseIcon,
  HeartIcon,
  HistoryIcon,
  LocationIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  StarIcon
} from "./icons";
import { personalApi } from "@/lib/personal-api";
import { buildEveningPlan, suggestWhatNext } from "@/lib/planner";
import { places as seedPlaces, scenarioLabels } from "@/lib/places";
import {
  filterPlaces,
  pickSurprisePlace,
  recommendForCollection
} from "@/lib/search";
import type {
  Collection,
  EveningPlan,
  MapBounds,
  PersonalBackup,
  PersonalRating,
  Place,
  PoiSearchResult,
  RatingDraft,
  RecommendationContext,
  Scenario,
  UserLocation,
  VisitRecord,
  WeatherContext
} from "@/lib/types";
import {
  cleanPlainText,
  suggestScenarios,
  validateNewPlace
} from "@/lib/validation";

const defaultCenter: [number, number] = [105.8342, 21.0278];

const scenarios: Array<Scenario | "all"> = [
  "all",
  "date",
  "friends",
  "food",
  "coffee",
  "fun",
  "chill"
];

const scenarioEmoji: Record<Scenario, string> = {
  date: "♥",
  friends: "●●",
  food: "◉",
  coffee: "☕",
  fun: "◇",
  chill: "☾"
};

type PersonalView = "discover" | "saved" | "history" | "collections";

function distanceLabel(value: number) {
  if (value < 1) return Math.round(value * 1000) + " m";
  return value.toFixed(value < 10 ? 1 : 0) + " km";
}

function moneyLabel(value: number) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return (
      millions.toLocaleString("vi-VN", {
        maximumFractionDigits: millions % 1 === 0 ? 0 : 1
      }) + " triệu"
    );
  }
  return Math.round(value / 1000) + "k";
}

function priceText(price: Place["priceLabel"]) {
  return price === "$" ? "Tiết kiệm" : price === "$$" ? "Vừa phải" : "Cao";
}

function readableScenario(value: Scenario | "all") {
  return value === "all" ? "Tất cả" : scenarioLabels[value];
}

function formatVisitedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Không rõ";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function revisitLabel(value: RatingDraft["revisit"]) {
  if (value === "yes") return "Muốn quay lại";
  if (value === "maybe") return "Có thể quay lại";
  return "Không muốn quay lại";
}

function placeIcon(place: Pick<Place, "kind">) {
  if (place.kind.includes("Activity")) return "◇";
  if (place.kind.includes("Restaurant")) return "◉";
  if (place.kind.includes("Bar")) return "◐";
  return "☕";
}

function placeInsideBounds(place: Place, bounds: MapBounds) {
  const latitudeOk =
    place.latitude >= bounds.south && place.latitude <= bounds.north;
  const longitudeOk =
    bounds.west <= bounds.east
      ? place.longitude >= bounds.west && place.longitude <= bounds.east
      : place.longitude >= bounds.west || place.longitude <= bounds.east;

  return latitudeOk && longitudeOk;
}

function weatherLabel(weather: WeatherContext | null) {
  if (!weather) return null;
  const labels: Record<WeatherContext["condition"], string> = {
    clear: "Trời đẹp",
    cloudy: "Nhiều mây",
    fog: "Có sương",
    rain: "Có mưa",
    storm: "Dông",
    snow: "Tuyết"
  };
  return labels[weather.condition];
}

function weatherEmoji(weather: WeatherContext | null) {
  if (!weather) return "◌";
  const labels: Record<WeatherContext["condition"], string> = {
    clear: "☀",
    cloudy: "☁",
    fog: "≋",
    rain: "☂",
    storm: "ϟ",
    snow: "❄"
  };
  return labels[weather.condition];
}

function daypartLabel(hour: number) {
  if (hour >= 5 && hour < 11) return "Sáng";
  if (hour >= 11 && hour < 14) return "Trưa";
  if (hour >= 14 && hour < 18) return "Chiều";
  if (hour >= 18 && hour < 22) return "Tối";
  return "Muộn";
}

export function MapExplorer() {
  const [customPlaces, setCustomPlaces] = useState<Place[]>([]);
  const [saved, setSaved] = useState(() => new Set<string>());
  const [ratings, setRatings] = useState<Record<string, PersonalRating>>({});
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [dataStatus, setDataStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [view, setView] = useState<PersonalView>("discover");
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<Scenario | "all">("all");
  const [selectedId, setSelectedId] = useState(seedPlaces[0]!.id);
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);

  const [providerResults, setProviderResults] = useState<PoiSearchResult[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [serverDistances, setServerDistances] = useState<Record<string, number>>({});
  const [backupLoading, setBackupLoading] = useState(false);
  const [viewportBounds, setViewportBounds] = useState<MapBounds | null>(null);
  const [viewportPersonalIds, setViewportPersonalIds] =
    useState<Set<string> | null>(null);
  const [viewportLoading, setViewportLoading] = useState(false);
  const [weather, setWeather] = useState<WeatherContext | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const [planScenario, setPlanScenario] = useState<Scenario>("date");
  const [planBudget, setPlanBudget] = useState(700_000);
  const [planDistance, setPlanDistance] = useState(5);
  const [planDuration, setPlanDuration] = useState<2 | 3 | 4>(4);
  const [planStartTime, setPlanStartTime] = useState("19:00");
  const [planVariant, setPlanVariant] = useState(0);
  const [activePlan, setActivePlan] = useState<EveningPlan | null>(null);

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [mapReady, setMapReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [ratingStars, setRatingStars] = useState(5);
  const [ratingRevisit, setRatingRevisit] =
    useState<RatingDraft["revisit"]>("yes");
  const [ratingContexts, setRatingContexts] = useState<Scenario[]>(["date"]);
  const [ratingNote, setRatingNote] = useState("");

  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPrice, setEditPrice] = useState<Place["priceLabel"]>("$$");
  const [editBestTime, setEditBestTime] = useState("");
  const [editOpenUntil, setEditOpenUntil] = useState("");

  const [collectionEditingId, setCollectionEditingId] =
    useState<string | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  const editDialogRef = useRef<HTMLDialogElement | null>(null);
  const ratingDialogRef = useRef<HTMLDialogElement | null>(null);
  const collectionDialogRef = useRef<HTMLDialogElement | null>(null);
  const planDialogRef = useRef<HTMLDialogElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const snapshot = await personalApi.snapshot();
      setCustomPlaces(snapshot.customPlaces);
      setSaved(new Set(snapshot.savedIds));
      setRatings(snapshot.ratings);
      setVisits(snapshot.visits);
      setCollections(snapshot.collections);
      setDataStatus("ready");
    } catch (error) {
      setDataStatus("error");
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể tải dữ liệu cá nhân."
      );
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshWeather = useCallback(async (point: UserLocation) => {
    setWeatherLoading(true);
    try {
      const result = await personalApi.weather(point);
      setWeather(result.weather);
    } catch {
      setWeather(null);
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  const allPlaces = useMemo(
    () => [...customPlaces, ...seedPlaces],
    [customPlaces]
  );

  const customIds = useMemo(
    () => new Set(customPlaces.map((place) => place.id)),
    [customPlaces]
  );

  const importedProviderIds = useMemo(
    () =>
      new Set(
        customPlaces
          .map((place) => place.providerId)
          .filter((value): value is string => Boolean(value))
      ),
    [customPlaces]
  );

  const recentVisitByPlace = useMemo(() => {
    const result = new Map<string, VisitRecord>();
    const ordered = [...visits].sort((a, b) =>
      b.visitedAt.localeCompare(a.visitedAt)
    );
    for (const visit of ordered) {
      if (!result.has(visit.placeId)) result.set(visit.placeId, visit);
    }
    return result;
  }, [visits]);

  const selectedCollection =
    collections.find((item) => item.id === selectedCollectionId) ?? null;

  const recommendationContext = useMemo<RecommendationContext>(
    () => ({
      localHour: clock.getHours(),
      isWeekend: clock.getDay() === 0 || clock.getDay() === 6,
      weather
    }),
    [clock, weather]
  );

  const visiblePlaces = useMemo(() => {
    const contextual = filterPlaces(
      allPlaces,
      query,
      scenario,
      userLocation,
      { savedIds: saved, ratings, visits },
      serverDistances,
      recommendationContext
    );

    const filtered = viewportBounds
      ? contextual.filter((place) => {
          if (customIds.has(place.id) && viewportPersonalIds) {
            return viewportPersonalIds.has(place.id);
          }
          return placeInsideBounds(place, viewportBounds);
        })
      : contextual;

    if (view === "saved") {
      return filtered.filter((place) => saved.has(place.id));
    }

    if (view === "history") {
      return filtered
        .filter((place) => recentVisitByPlace.has(place.id))
        .sort((a, b) => {
          const aDate = recentVisitByPlace.get(a.id)?.visitedAt ?? "";
          const bDate = recentVisitByPlace.get(b.id)?.visitedAt ?? "";
          return bDate.localeCompare(aDate);
        });
    }

    if (view === "collections") {
      if (!selectedCollection) return [];
      const ids = new Set(selectedCollection.placeIds);
      return filtered.filter((place) => ids.has(place.id));
    }

    return filtered;
  }, [
    allPlaces,
    query,
    scenario,
    userLocation,
    saved,
    ratings,
    visits,
    view,
    selectedCollection,
    recentVisitByPlace,
    serverDistances,
    recommendationContext,
    viewportBounds,
    viewportPersonalIds,
    customIds
  ]);

  const rankedAll = useMemo(
    () =>
      filterPlaces(
        allPlaces,
        "",
        "all",
        userLocation,
        { savedIds: saved, ratings, visits },
        serverDistances,
        recommendationContext
      ),
    [
      allPlaces,
      userLocation,
      saved,
      ratings,
      visits,
      serverDistances,
      recommendationContext
    ]
  );

  const collectionSuggestions = useMemo(() => {
    if (!selectedCollection) return [];
    return recommendForCollection(
      selectedCollection,
      rankedAll,
      { savedIds: saved, ratings, visits },
      4
    );
  }, [selectedCollection, rankedAll, saved, ratings, visits]);

  const selected =
    visiblePlaces.find((place) => place.id === selectedId) ??
    rankedAll.find((place) => place.id === selectedId) ??
    visiblePlaces[0] ??
    rankedAll[0] ??
    seedPlaces[0]!;

  const selectedPersonalRating = ratings[selected.id] ?? null;
  const selectedVisit = recentVisitByPlace.get(selected.id) ?? null;
  const selectedVisitTime = selectedVisit
    ? new Date(selectedVisit.visitedAt).getTime()
    : Number.NaN;
  const selectedVisitedRecently =
    Number.isFinite(selectedVisitTime) &&
    clock.getTime() - selectedVisitTime >= 0 &&
    clock.getTime() - selectedVisitTime <= 8 * 60 * 60 * 1000;

  const whatNextSuggestions = useMemo(
    () =>
      selectedVisitedRecently
        ? suggestWhatNext({
            current: selected,
            places: rankedAll,
            signals: { savedIds: saved, ratings, visits },
            maxDistanceKm: 4,
            limit: 3
          })
        : [],
    [
      selectedVisitedRecently,
      selected,
      rankedAll,
      saved,
      ratings,
      visits
    ]
  );

  const isPersonalPlace = customIds.has(selected.id);

  useEffect(() => {
    let active = true;

    void import("maplibre-gl").then((maplibre) => {
      if (!active || !mapNodeRef.current || mapRef.current) return;

      const map = new maplibre.Map({
        container: mapNodeRef.current,
        style:
          process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
          "https://demotiles.maplibre.org/style.json",
        center: defaultCenter,
        zoom: 11.8,
        attributionControl: false
      });

      map.addControl(
        new maplibre.NavigationControl({
          showCompass: false,
          visualizePitch: false
        }),
        "bottom-right"
      );

      map.on("load", () => {
        if (active) setMapReady(true);
      });

      mapRef.current = map;
    });

    return () => {
      active = false;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const center = mapRef.current.getCenter();
    void refreshWeather({
      latitude: center.lat,
      longitude: center.lng
    });
  }, [mapReady, refreshWeather]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    void import("maplibre-gl").then((maplibre) => {
      if (!mapRef.current) return;

      for (const place of visiblePlaces) {
        const element = document.createElement("button");
        element.type = "button";
        element.className =
          "map-marker" +
          (place.id === selectedId ? " map-marker--active" : "");
        element.setAttribute("aria-label", "Mở " + place.name);
        element.textContent = place.match + "%";
        element.style.setProperty("--marker-accent", place.accent);
        element.addEventListener("click", () => setSelectedId(place.id));

        const marker = new maplibre.Marker({
          element,
          anchor: "bottom"
        })
          .setLngLat([place.longitude, place.latitude])
          .addTo(mapRef.current);

        markerRefs.current.push(marker);
      }

      if (userLocation) {
        const dot = document.createElement("div");
        dot.className = "map-user-dot";
        dot.setAttribute("aria-label", "Vị trí hiện tại");
        markerRefs.current.push(
          new maplibre.Marker({ element: dot })
            .setLngLat([userLocation.longitude, userLocation.latitude])
            .addTo(mapRef.current)
        );
      }
    });
  }, [mapReady, visiblePlaces, selectedId, userLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !selected) return;
    mapRef.current.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: 13,
      duration: 650,
      essential: true
    });
  }, [mapReady, selected]);

  useEffect(() => {
    if (
      visiblePlaces.length > 0 &&
      !visiblePlaces.some((place) => place.id === selectedId)
    ) {
      setSelectedId(visiblePlaces[0]!.id);
    }
  }, [visiblePlaces, selectedId]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setNotice("Trình duyệt này không hỗ trợ vị trí.");
      return;
    }

    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        setUserLocation(next);
        setLocationStatus("ready");
        mapRef.current?.flyTo({
          center: [next.longitude, next.latitude],
          zoom: 13,
          duration: 700
        });
        setNotice(
          "GPS chỉ dùng trong phiên hiện tại và không được ghi vào Supabase."
        );

        void refreshWeather(next);

        void personalApi
          .nearby(next, 500)
          .then(({ results }) => {
            setServerDistances(
              Object.fromEntries(
                results.map((item) => [item.placeId, item.distanceKm])
              )
            );
          })
          .catch(() => {
            setServerDistances({});
          });
      },
      () => {
        setLocationStatus("denied");
        setNotice("Không lấy được vị trí. Bản đồ vẫn dùng bình thường.");
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000
      }
    );
  }

  function switchView(next: PersonalView) {
    setView(next);
    setQuery("");
    setScenario("all");
    setProviderResults([]);
    if (next === "collections" && !selectedCollectionId && collections[0]) {
      setSelectedCollectionId(collections[0].id);
    }
  }

  async function runPoiSearch(
    event?: FormEvent,
    boundsOverride?: MapBounds | null
  ) {
    event?.preventDefault();
    const cleaned = cleanPlainText(query, 120);
    if (cleaned.length < 2) {
      setProviderResults([]);
      return;
    }

    setProviderLoading(true);
    try {
      const result = await personalApi.searchPoi(
        cleaned,
        userLocation,
        boundsOverride === undefined ? viewportBounds : boundsOverride
      );
      setProviderResults(result.results);
      if (result.results.length === 0) {
        setNotice("Không tìm thấy POI ngoài cho từ khóa này.");
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể tìm POI."
      );
    } finally {
      setProviderLoading(false);
    }
  }

  async function searchCurrentArea() {
    if (!mapRef.current) return;

    const raw = mapRef.current.getBounds();
    const bounds: MapBounds = {
      west: raw.getWest(),
      south: raw.getSouth(),
      east: raw.getEast(),
      north: raw.getNorth()
    };
    const center = mapRef.current.getCenter();

    setViewportLoading(true);
    setViewportBounds(bounds);
    setViewportPersonalIds(null);

    try {
      const [viewportResult] = await Promise.all([
        personalApi.viewport(bounds),
        refreshWeather({
          latitude: center.lat,
          longitude: center.lng
        })
      ]);

      setViewportPersonalIds(
        new Set(viewportResult.results.map((item) => item.placeId))
      );

      const cleaned = cleanPlainText(query, 120);
      if (cleaned.length >= 2) {
        await runPoiSearch(undefined, bounds);
      } else {
        setProviderResults([]);
      }

      setNotice("Đã lọc theo vùng bản đồ đang nhìn.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể tìm trong khu vực này."
      );
    } finally {
      setViewportLoading(false);
    }
  }

  function clearViewportFilter() {
    setViewportBounds(null);
    setViewportPersonalIds(null);
    setProviderResults([]);
    setNotice("Đã bỏ giới hạn khu vực bản đồ.");
  }

  function surpriseMe() {
    const picked = pickSurprisePlace(
      visiblePlaces.length > 0 ? visiblePlaces : rankedAll,
      { savedIds: saved, ratings, visits }
    );

    if (!picked) {
      setNotice("Chưa có địa điểm phù hợp để chọn bất ngờ.");
      return;
    }

    setSelectedId(picked.id);
    mapRef.current?.flyTo({
      center: [picked.longitude, picked.latitude],
      zoom: 14,
      duration: 700,
      essential: true
    });

    const reason =
      picked.recommendationReasons?.[0] ?? "phù hợp với gu hiện tại";
    setNotice("🎯 " + picked.name + " · " + reason);
  }

  function plannerOrigin(): UserLocation {
    if (userLocation) return userLocation;
    const center = mapRef.current?.getCenter();
    return center
      ? { latitude: center.lat, longitude: center.lng }
      : { latitude: defaultCenter[1], longitude: defaultCenter[0] };
  }

  function generatePlan(nextVariant = planVariant) {
    const source = viewportBounds
      ? rankedAll.filter((place) => {
          if (customIds.has(place.id) && viewportPersonalIds) {
            return viewportPersonalIds.has(place.id);
          }
          return placeInsideBounds(place, viewportBounds);
        })
      : rankedAll;

    const result = buildEveningPlan({
      places: source,
      preferences: {
        scenario: planScenario,
        budgetForTwo: planBudget,
        maxDistanceKm: planDistance,
        durationHours: planDuration,
        startTime: planStartTime
      },
      signals: { savedIds: saved, ratings, visits },
      origin: plannerOrigin(),
      variant: nextVariant
    });

    setPlanVariant(nextVariant);
    setActivePlan(result);

    if (!result) {
      setNotice(
        "Chưa đủ địa điểm phù hợp. Thử tăng bán kính hoặc đổi mood."
      );
    }
  }

  function openPlanBuilder() {
    setPlanScenario(scenario === "all" ? "date" : scenario);
    setPlanVariant(0);
    setActivePlan(null);
    planDialogRef.current?.showModal();
  }

  function openPlanRoute() {
    if (!activePlan || activePlan.stops.length === 0) return;

    if (activePlan.stops.length === 1) {
      const only = activePlan.stops[0]!.place;
      const url = userLocation
        ? "https://www.google.com/maps/dir/?api=1&origin=" +
          encodeURIComponent(
            userLocation.latitude + "," + userLocation.longitude
          ) +
          "&destination=" +
          encodeURIComponent(only.latitude + "," + only.longitude) +
          "&travelmode=driving"
        : "https://www.google.com/maps/search/?api=1&query=" +
          encodeURIComponent(only.latitude + "," + only.longitude);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const origin = userLocation
      ? userLocation.latitude + "," + userLocation.longitude
      : activePlan.stops[0]!.place.latitude +
        "," +
        activePlan.stops[0]!.place.longitude;

    const last = activePlan.stops[activePlan.stops.length - 1]!.place;
    const waypointStops = userLocation
      ? activePlan.stops.slice(0, -1)
      : activePlan.stops.slice(1, -1);

    const params = new URLSearchParams({
      api: "1",
      origin,
      destination: last.latitude + "," + last.longitude,
      travelmode: "driving"
    });

    if (waypointStops.length > 0) {
      params.set(
        "waypoints",
        waypointStops
          .map(
            (stop) =>
              stop.place.latitude + "," + stop.place.longitude
          )
          .join("|")
      );
    }

    window.open(
      "https://www.google.com/maps/dir/?" + params.toString(),
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function importPoi(result: PoiSearchResult) {
    try {
      const imported = await personalApi.importPoi(result);
      await loadSnapshot();
      setSelectedId(imported.place.id);
      setProviderResults((current) =>
        current.filter((item) => item.providerId !== result.providerId)
      );
      setNotice(
        imported.duplicate
          ? "Địa điểm này đã có trong dữ liệu cá nhân."
          : "Đã nhập địa điểm vào Supabase cá nhân."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể nhập POI.");
    }
  }

  async function exportBackup() {
    setBackupLoading(true);
    try {
      const backup = await personalApi.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        "di-dau-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("Đã xuất bản sao lưu cá nhân.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể xuất backup."
      );
    } finally {
      setBackupLoading(false);
    }
  }

  async function importBackupFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setNotice("File backup quá lớn. Giới hạn hiện tại là 5 MB.");
      return;
    }

    setBackupLoading(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await personalApi.importBackup(parsed as PersonalBackup);
      await loadSnapshot();
      setNotice(
        "Đã merge backup: " +
          result.places +
          " địa điểm, " +
          result.ratings +
          " rating, " +
          result.collections +
          " bộ sưu tập."
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể nhập backup."
      );
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = "";
      setBackupLoading(false);
    }
  }

  async function toggleSaved(placeId: string) {
    const next = !saved.has(placeId);
    try {
      await personalApi.setSaved(placeId, next);
      await loadSnapshot();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể lưu.");
    }
  }

  function openRating() {
    const current = ratings[selected.id];
    setRatingStars(current?.stars ?? 5);
    setRatingRevisit(current?.revisit ?? "yes");
    setRatingContexts(
      current?.contexts.length ? current.contexts : selected.scenarios.slice(0, 2)
    );
    setRatingNote(current?.note ?? "");
    ratingDialogRef.current?.showModal();
  }

  async function submitRating(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await personalApi.saveRating(selected.id, {
        stars: ratingStars,
        revisit: ratingRevisit,
        contexts: ratingContexts,
        note: ratingNote,
        recordVisit: !selectedVisit
      });
      await loadSnapshot();
      ratingDialogRef.current?.close();
      setNotice("Đã lưu đánh giá và cập nhật ranking cá nhân.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể lưu đánh giá."
      );
    }
  }

  async function checkIn() {
    try {
      await personalApi.checkIn(selected.id);
      await loadSnapshot();

      const next = suggestWhatNext({
        current: selected,
        places: rankedAll,
        signals: { savedIds: saved, ratings, visits },
        maxDistanceKm: 4,
        limit: 1
      })[0];

      setNotice(
        next
          ? "Đã check-in · Đi tiếp: " +
              next.place.name +
              " (" +
              distanceLabel(next.distanceKm) +
              ")"
          : "Đã check-in. Bạn có thể đánh giá sau."
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể check-in."
      );
    }
  }

  async function submitNewPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const center = mapRef.current?.getCenter();

    const validated = validateNewPlace({
      name: String(data.get("name") ?? ""),
      note: String(data.get("note") ?? ""),
      latitude: String(center?.lat ?? defaultCenter[1]),
      longitude: String(center?.lng ?? defaultCenter[0])
    });

    if (!validated.ok) {
      setNotice(validated.error);
      return;
    }

    const detected = suggestScenarios(validated.value.note);
    const place: Place = {
      id: crypto.randomUUID(),
      name: validated.value.name,
      kind: "Địa điểm của bạn",
      description: validated.value.note,
      latitude: validated.value.latitude,
      longitude: validated.value.longitude,
      distanceKm: 0,
      priceLabel: "$$",
      averageForTwo: "Chưa có dữ liệu",
      publicRating: 0,
      match: 75,
      communityNote: "Địa điểm cá nhân",
      openUntil: "Chưa rõ",
      bestTime: "Chưa có dữ liệu",
      noise: "Vừa",
      crowd: "Vừa",
      tags: detected.map((item) => scenarioLabels[item]),
      scenarios: detected,
      note: validated.value.note,
      accent: "#ff6b5e",
      source: "personal"
    };

    try {
      const created = await personalApi.createPlace(place);
      await loadSnapshot();
      setSelectedId(created.id);
      addDialogRef.current?.close();
      event.currentTarget.reset();
      setNotice("Đã lưu địa điểm vào Supabase.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể thêm địa điểm."
      );
    }
  }

  function openEditPlace() {
    setEditName(selected.name);
    setEditNote(selected.note);
    setEditAddress(selected.address ?? "");
    setEditPrice(selected.priceLabel);
    setEditBestTime(selected.bestTime);
    setEditOpenUntil(selected.openUntil);
    editDialogRef.current?.showModal();
  }

  async function submitEditPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPersonalPlace) return;

    try {
      const updated: Place = {
        ...selected,
        name: cleanPlainText(editName, 100),
        note: cleanPlainText(editNote, 500),
        description: cleanPlainText(editNote, 500) || selected.description,
        address: cleanPlainText(editAddress, 260) || undefined,
        priceLabel: editPrice,
        bestTime: cleanPlainText(editBestTime, 100) || "Chưa có dữ liệu",
        openUntil: cleanPlainText(editOpenUntil, 60) || "Chưa rõ",
        scenarios: suggestScenarios(editNote || selected.kind),
        tags: suggestScenarios(editNote || selected.kind).map(
          (item) => scenarioLabels[item]
        )
      };
      await personalApi.updatePlace(selected.id, updated);
      await loadSnapshot();
      editDialogRef.current?.close();
      setNotice("Đã cập nhật địa điểm.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể sửa địa điểm."
      );
    }
  }

  async function deleteSelectedPlace() {
    if (!isPersonalPlace) return;
    if (!window.confirm("Xóa địa điểm này và dữ liệu cá nhân liên quan?")) {
      return;
    }

    try {
      await personalApi.deletePlace(selected.id);
      setSelectedId(seedPlaces[0]!.id);
      await loadSnapshot();
      setNotice("Đã xóa địa điểm cá nhân.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể xóa địa điểm."
      );
    }
  }

  function openCreateCollection() {
    setCollectionEditingId(null);
    setCollectionName("");
    setCollectionDescription("");
    collectionDialogRef.current?.showModal();
  }

  function openEditCollection(collection: Collection) {
    setCollectionEditingId(collection.id);
    setCollectionName(collection.name);
    setCollectionDescription(collection.description);
    collectionDialogRef.current?.showModal();
  }

  async function submitCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (collectionEditingId) {
        await personalApi.updateCollection(collectionEditingId, {
          name: collectionName,
          description: collectionDescription
        });
      } else {
        const created = await personalApi.createCollection({
          name: collectionName,
          description: collectionDescription
        });
        setSelectedCollectionId(created.id);
      }
      await loadSnapshot();
      collectionDialogRef.current?.close();
      setView("collections");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể lưu bộ sưu tập."
      );
    }
  }

  async function deleteSelectedCollection() {
    if (!selectedCollection) return;
    if (!window.confirm("Xóa bộ sưu tập này? Địa điểm bên trong không bị xóa.")) {
      return;
    }
    try {
      await personalApi.deleteCollection(selectedCollection.id);
      setSelectedCollectionId(null);
      await loadSnapshot();
      setNotice("Đã xóa bộ sưu tập.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể xóa bộ sưu tập."
      );
    }
  }

  async function toggleCollectionPlace(
    collection: Collection,
    placeId = selected.id
  ) {
    const included = !collection.placeIds.includes(placeId);
    try {
      await personalApi.setCollectionPlace(
        collection.id,
        placeId,
        included
      );
      await loadSnapshot();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật bộ sưu tập."
      );
    }
  }

  function toggleRatingContext(context: Scenario) {
    setRatingContexts((current) =>
      current.includes(context)
        ? current.filter((item) => item !== context)
        : [...current, context]
    );
  }

  const heading =
    view === "saved"
      ? visiblePlaces.length + " địa điểm đã lưu"
      : view === "history"
        ? visiblePlaces.length + " nơi bạn đã đi"
        : view === "collections"
          ? selectedCollection?.name ?? "Bộ sưu tập"
          : visiblePlaces.length + " địa điểm phù hợp";

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="Điều hướng chính">
        <div className="rail-brand">
          <span className="rail-brand__mark"><PinIcon /></span>
          <strong>ĐiĐâu</strong>
        </div>

        <nav className="rail-nav">
          <button
            className={"rail-action" + (view === "discover" ? " rail-action--active" : "")}
            type="button"
            onClick={() => switchView("discover")}
          >
            <PinIcon /><span>Bản đồ</span>
          </button>
          <button
            className={"rail-action" + (view === "saved" ? " rail-action--active" : "")}
            type="button"
            onClick={() => switchView("saved")}
          >
            <HeartIcon /><span>Đã lưu</span>
          </button>
          <button
            className={"rail-action" + (view === "history" ? " rail-action--active" : "")}
            type="button"
            onClick={() => switchView("history")}
          >
            <HistoryIcon /><span>Lịch sử</span>
          </button>
          <button
            className={"rail-action" + (view === "collections" ? " rail-action--active" : "")}
            type="button"
            onClick={() => switchView("collections")}
          >
            <StarIcon /><span>Bộ sưu tập</span>
          </button>
        </nav>

        <button
          className="rail-add"
          type="button"
          onClick={() => addDialogRef.current?.showModal()}
        >
          <PlusIcon /><span>Thêm</span>
        </button>
      </aside>

      <header className="topbar">
        <form className="topbar-search" onSubmit={(event) => void runPoiSearch(event)}>
          <SearchIcon />
          <input
            aria-label="Tìm địa điểm"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 120))}
            placeholder="Tìm quanh đây hoặc gõ: cafe yên tĩnh…"
          />
          {query ? (
            <button
              className="icon-button"
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => {
                setQuery("");
                setProviderResults([]);
              }}
            >
              <CloseIcon />
            </button>
          ) : null}
          <button className="search-submit" type="submit" disabled={providerLoading}>
            {providerLoading ? "..." : "Tìm"}
          </button>
        </form>

        <div className="topbar-actions">
          <span
            className={
              "personal-mode-badge" +
              (dataStatus === "error" ? " personal-mode-badge--error" : "")
            }
          >
            <span className="privacy-dot" />
            {dataStatus === "loading"
              ? "Đang mở Supabase…"
              : dataStatus === "error"
                ? "Không tải được dữ liệu"
                : "Cá nhân · Supabase"}
          </span>

          <button
            className="backup-button"
            type="button"
            disabled={backupLoading}
            onClick={() => void exportBackup()}
          >
            Xuất
          </button>
          <button
            className="backup-button"
            type="button"
            disabled={backupLoading}
            onClick={() => backupInputRef.current?.click()}
          >
            Nhập
          </button>
          <input
            ref={backupInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importBackupFile(file);
            }}
          />

          <button
            className={
              "location-button" +
              (locationStatus === "ready" ? " location-button--ready" : "")
            }
            type="button"
            onClick={requestLocation}
            disabled={locationStatus === "loading"}
          >
            <LocationIcon />
            <span>
              {locationStatus === "loading"
                ? "Đang lấy vị trí…"
                : locationStatus === "ready"
                  ? "Gần tôi"
                  : "Vị trí của tôi"}
            </span>
          </button>
        </div>
      </header>

      <section className="results-pane" aria-label="Danh sách địa điểm">
        <div className="scenario-row">
          {scenarios.map((item) => (
            <button
              type="button"
              key={item}
              className={
                "scenario-chip" +
                (scenario === item ? " scenario-chip--active" : "")
              }
              onClick={() => setScenario(item)}
            >
              {item !== "all" ? <span>{scenarioEmoji[item]}</span> : null}
              {readableScenario(item)}
            </button>
          ))}
        </div>

        {view === "collections" ? (
          <div className="collection-strip">
            <div className="collection-strip__scroll">
              {collections.map((collection) => (
                <button
                  type="button"
                  key={collection.id}
                  className={
                    "collection-chip" +
                    (collection.id === selectedCollectionId
                      ? " collection-chip--active"
                      : "")
                  }
                  onClick={() => setSelectedCollectionId(collection.id)}
                >
                  {collection.name}
                  <small>{collection.placeIds.length}</small>
                </button>
              ))}
            </div>
            <button type="button" className="mini-add" onClick={openCreateCollection}>
              +
            </button>
          </div>
        ) : null}

        <div className="results-heading">
          <div>
            <span className="eyebrow">
              {view === "history"
                ? "Trải nghiệm của bạn"
                : view === "collections"
                  ? selectedCollection?.description || "Bộ sưu tập cá nhân"
                  : "Gợi ý cá nhân"}
            </span>
            <h1>{heading}</h1>
          </div>
          {view === "collections" && selectedCollection ? (
            <div className="small-actions">
              <button type="button" onClick={() => openEditCollection(selectedCollection)}>
                Sửa
              </button>
              <button type="button" onClick={() => void deleteSelectedCollection()}>
                Xóa
              </button>
            </div>
          ) : (
            <span className="sort-label">Phù hợp nhất</span>
          )}
        </div>

        {providerResults.length > 0 ? (
          <div className="provider-results">
            <div className="provider-results__title">
              <strong>OpenStreetMap</strong>
              <span>{providerResults.length} kết quả ngoài</span>
            </div>
            {providerResults.slice(0, 4).map((item) => {
              const imported = importedProviderIds.has(item.providerId);
              return (
                <div className="provider-card" key={item.providerId}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.displayName}</span>
                  </div>
                  <button
                    type="button"
                    disabled={imported}
                    onClick={() => void importPoi(item)}
                  >
                    {imported ? "Đã lưu" : "+ Lưu"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {view === "collections" &&
        selectedCollection &&
        collectionSuggestions.length > 0 ? (
          <div className="collection-suggestions">
            <div className="provider-results__title">
              <strong>Gợi ý thêm</strong>
              <span>Theo gu của bộ sưu tập</span>
            </div>
            {collectionSuggestions.map((place) => (
              <div className="collection-suggestion" key={place.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(place.id)}
                >
                  <strong>{place.name}</strong>
                  <span>
                    {place.collectionReasons[0] ?? "Có điểm tương đồng"}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={"Thêm " + place.name + " vào bộ sưu tập"}
                  onClick={() =>
                    void toggleCollectionPlace(selectedCollection, place.id)
                  }
                >
                  +
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {selectedVisitedRecently && whatNextSuggestions[0] ? (
          <div className="what-next-strip">
            <div>
              <span className="eyebrow">Đi đâu tiếp?</span>
              <small>Từ {selected.name}</small>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = whatNextSuggestions[0]!;
                setSelectedId(next.place.id);
                mapRef.current?.flyTo({
                  center: [
                    next.place.longitude,
                    next.place.latitude
                  ],
                  zoom: 14,
                  duration: 650,
                  essential: true
                });
              }}
            >
              <strong>{whatNextSuggestions[0].place.name}</strong>
              <span>
                {whatNextSuggestions[0].transitionLabel} ·{" "}
                {distanceLabel(whatNextSuggestions[0].distanceKm)}
              </span>
            </button>
          </div>
        ) : null}

        <div className="place-list">
          {visiblePlaces.length === 0 ? (
            <div className="empty-state">
              <strong>
                {view === "collections" && collections.length === 0
                  ? "Chưa có bộ sưu tập."
                  : "Chưa có địa điểm trong chế độ này."}
              </strong>
              <span>
                {view === "collections"
                  ? "Tạo bộ sưu tập rồi thêm địa điểm từ phần chi tiết."
                  : "Thử đổi bộ lọc hoặc tìm POI thật ở ô phía trên."}
              </span>
            </div>
          ) : (
            visiblePlaces.map((place) => {
              const rating = ratings[place.id];
              const visit = recentVisitByPlace.get(place.id);
              return (
                <button
                  type="button"
                  key={place.id}
                  className={
                    "place-card" +
                    (selected.id === place.id ? " place-card--active" : "")
                  }
                  onClick={() => setSelectedId(place.id)}
                >
                  <span
                    className="place-thumb"
                    style={{ "--place-accent": place.accent } as CSSProperties}
                    aria-hidden="true"
                  >
                    {placeIcon(place)}
                  </span>
                  <span className="place-card__content">
                    <span className="place-card__top">
                      <strong>{place.name}</strong>
                      <small>{place.match}%</small>
                    </span>
                    <span className="place-card__meta">
                      <b>
                        ★{" "}
                        {rating
                          ? rating.stars.toFixed(1) + " của bạn"
                          : place.publicRating > 0
                            ? place.publicRating.toFixed(1)
                            : "Mới"}
                      </b>
                      <span>·</span>
                      <span>{distanceLabel(place.distanceKm)}</span>
                      <span>·</span>
                      <span>{place.priceLabel}</span>
                    </span>
                    <span className="tag-line">
                      {visit ? <i>Đã đi {formatVisitedAt(visit.visitedAt)}</i> : null}
                      {place.recommendationReasons?.[0] ? (
                        <i>{place.recommendationReasons[0]}</i>
                      ) : null}
                      {place.tags.slice(0, 1).map((tag) => <i key={tag}>{tag}</i>)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          className="wide-secondary"
          type="button"
          onClick={() => addDialogRef.current?.showModal()}
        >
          <PlusIcon />
          Thêm địa điểm thủ công
        </button>
      </section>

      <section className="map-pane" aria-label="Bản đồ">
        <div ref={mapNodeRef} className="map-canvas" />
        <div className="map-floating-top">
          <span>
            {viewportBounds
              ? "Đang lọc khu vực bản đồ"
              : view === "discover"
                ? "Ranking theo gu + bối cảnh hiện tại"
                : view === "collections"
                  ? "Bộ sưu tập cá nhân"
                  : view === "history"
                    ? "Lịch sử đã đi"
                    : "Địa điểm đã lưu"}
          </span>
          <button
            type="button"
            className="plan-button"
            onClick={openPlanBuilder}
          >
            ◫ Kế hoạch
          </button>
          <button
            type="button"
            className="surprise-button"
            onClick={surpriseMe}
          >
            ✨ Bất ngờ
          </button>
          {viewportBounds ? (
            <button
              type="button"
              className="map-secondary-action"
              onClick={clearViewportFilter}
            >
              Bỏ vùng
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void searchCurrentArea()}
            disabled={viewportLoading}
          >
            {viewportLoading ? "Đang tìm…" : "Tìm khu vực này"}
          </button>
        </div>

        <div className="weather-pill">
          <span>{weatherEmoji(weather)}</span>
          <strong>
            {weatherLoading
              ? "Đang xem thời tiết…"
              : weather
                ? weatherLabel(weather) +
                  " · " +
                  Math.round(weather.temperatureC) +
                  "°C"
                : daypartLabel(recommendationContext.localHour)}
          </strong>
          {weather ? (
            <small>
              {daypartLabel(recommendationContext.localHour)} · Open-Meteo
            </small>
          ) : null}
        </div>

        <div className="privacy-pill">
          <span className="privacy-dot" />
          {userLocation
            ? "GPS chỉ sống trong phiên"
            : "Supabase không lưu GPS hiện tại"}
        </div>
      </section>

      <aside className="detail-pane" aria-label="Chi tiết địa điểm">
        <div
          className="detail-hero"
          style={{ "--place-accent": selected.accent } as CSSProperties}
        >
          <span className="detail-hero__icon" aria-hidden="true">
            {placeIcon(selected)}
          </span>
          <div className="detail-hero__match">
            <strong>{selected.match}%</strong>
            <span>match cá nhân</span>
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-title-row">
            <div>
              <span className="eyebrow">
                {selected.kind}
                {selected.source === "provider" ? " · OSM" : ""}
              </span>
              <h2>{selected.name}</h2>
            </div>
            <button
              className={
                "save-button" +
                (saved.has(selected.id) ? " save-button--active" : "")
              }
              type="button"
              onClick={() => void toggleSaved(selected.id)}
              aria-label={saved.has(selected.id) ? "Bỏ lưu" : "Lưu"}
            >
              <HeartIcon />
            </button>
          </div>

          <div className="detail-score-line">
            <span>
              <b>
                ★{" "}
                {selectedPersonalRating
                  ? selectedPersonalRating.stars.toFixed(1)
                  : selected.publicRating > 0
                    ? selected.publicRating.toFixed(1)
                    : "Mới"}
              </b>{" "}
              {selectedPersonalRating ? "của bạn" : "tham khảo"}
            </span>
            <span>·</span>
            <span>{distanceLabel(selected.distanceKm)}</span>
            <span>·</span>
            <span>{selected.priceLabel}</span>
          </div>

          {selected.address ? (
            <p className="place-address">{selected.address}</p>
          ) : null}

          <div className="tag-line tag-line--large">
            {selected.tags.map((tag) => <i key={tag}>{tag}</i>)}
          </div>

          <div className="primary-actions primary-actions--three">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const url =
                  "https://www.google.com/maps/dir/?api=1&destination=" +
                  encodeURIComponent(
                    selected.latitude + "," + selected.longitude
                  );
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              <LocationIcon /> Chỉ đường
            </button>
            <button type="button" className="secondary-button" onClick={() => void checkIn()}>
              <PinIcon /> Check-in
            </button>
            <button type="button" className="secondary-button" onClick={openRating}>
              <StarIcon /> Đánh giá
            </button>
          </div>

          {isPersonalPlace ? (
            <div className="owner-actions">
              <button type="button" onClick={openEditPlace}>Sửa địa điểm</button>
              <button className="danger-text" type="button" onClick={() => void deleteSelectedPlace()}>
                Xóa
              </button>
            </div>
          ) : null}

          <section className="detail-section">
            <span className="eyebrow">Vì sao được gợi ý</span>
            <div className="recommendation-reasons">
              {(selected.recommendationReasons?.length
                ? selected.recommendationReasons
                : ["Phù hợp với bộ lọc hiện tại"]
              ).map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
          </section>

          <section className="detail-section">
            <span className="eyebrow">Trải nghiệm của bạn</span>
            {selectedPersonalRating ? (
              <div className="personal-summary">
                <div>
                  <strong>★ {selectedPersonalRating.stars.toFixed(1)}</strong>
                  <span>{revisitLabel(selectedPersonalRating.revisit)}</span>
                </div>
                <div>
                  <strong>
                    {selectedVisit
                      ? formatVisitedAt(selectedVisit.visitedAt)
                      : formatVisitedAt(selectedPersonalRating.visitedAt)}
                  </strong>
                  <span>Lần gần nhất</span>
                </div>
                {selectedPersonalRating.note ? (
                  <blockquote>“{selectedPersonalRating.note}”</blockquote>
                ) : null}
              </div>
            ) : (
              <div className="personal-empty">
                <strong>Chưa có rating cá nhân.</strong>
                <span>Check-in trước, hoặc đánh giá luôn sau khi đi.</span>
                <button type="button" onClick={openRating}>Thêm đánh giá</button>
              </div>
            )}
          </section>

          {selectedVisitedRecently && whatNextSuggestions.length > 0 ? (
            <section className="detail-section">
              <span className="eyebrow">Đi đâu tiếp?</span>
              <div className="what-next-list">
                {whatNextSuggestions.map((item) => (
                  <button
                    type="button"
                    key={item.place.id}
                    onClick={() => {
                      setSelectedId(item.place.id);
                      mapRef.current?.flyTo({
                        center: [
                          item.place.longitude,
                          item.place.latitude
                        ],
                        zoom: 14,
                        duration: 650,
                        essential: true
                      });
                    }}
                  >
                    <span className="what-next-list__top">
                      <strong>{item.place.name}</strong>
                      <b>{item.place.match}%</b>
                    </span>
                    <span>
                      {item.transitionLabel} · {distanceLabel(item.distanceKm)}
                    </span>
                    <small>{item.reason}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="detail-section">
            <span className="eyebrow">Bộ sưu tập</span>
            {collections.length === 0 ? (
              <div className="personal-empty">
                <strong>Chưa có bộ sưu tập.</strong>
                <button type="button" onClick={openCreateCollection}>Tạo bộ sưu tập</button>
              </div>
            ) : (
              <div className="collection-memberships">
                {collections.map((collection) => {
                  const included = collection.placeIds.includes(selected.id);
                  return (
                    <button
                      type="button"
                      key={collection.id}
                      className={included ? "is-included" : ""}
                      onClick={() => void toggleCollectionPlace(collection)}
                    >
                      <span>{collection.name}</span>
                      <b>{included ? "✓" : "+"}</b>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="detail-section">
            <span className="eyebrow">Cần biết</span>
            <dl className="fact-grid">
              <div><dt>Giá tham khảo</dt><dd>{selected.averageForTwo}</dd></div>
              <div><dt>Khoảng giá</dt><dd>{priceText(selected.priceLabel)}</dd></div>
              <div><dt>Không gian</dt><dd>{selected.noise}</dd></div>
              <div><dt>Đông đúc</dt><dd>{selected.crowd}</dd></div>
              <div><dt>Đi đẹp nhất</dt><dd>{selected.bestTime}</dd></div>
              <div><dt>Đóng cửa</dt><dd>{selected.openUntil}</dd></div>
            </dl>
            {selected.note ? <blockquote>“{selected.note}”</blockquote> : null}
          </section>
        </div>
      </aside>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button className="icon-button" type="button" onClick={() => setNotice(null)} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <dialog className="app-dialog" ref={addDialogRef}>
        <form className="dialog-card" onSubmit={submitNewPlace}>
          <div className="dialog-header">
            <div><span className="eyebrow">Supabase cá nhân</span><h2>Thêm địa điểm</h2></div>
            <button className="icon-button" type="button" onClick={() => addDialogRef.current?.close()}><CloseIcon /></button>
          </div>
          <p className="dialog-copy">
            Pin được đặt tại tâm bản đồ. App tự suy ra context từ ghi chú.
          </p>
          <label className="field">
            <span>Tên</span>
            <input name="name" required minLength={2} maxLength={80} />
          </label>
          <label className="field">
            <span>Ghi chú</span>
            <textarea name="note" rows={4} maxLength={300} placeholder="Yên, hợp date, đi tối đẹp…" />
          </label>
          <button className="primary-button primary-button--wide" type="submit">
            Lưu địa điểm
          </button>
        </form>
      </dialog>

      <dialog className="app-dialog" ref={editDialogRef}>
        <form className="dialog-card" onSubmit={submitEditPlace}>
          <div className="dialog-header">
            <div><span className="eyebrow">Quản lý địa điểm</span><h2>Sửa {selected.name}</h2></div>
            <button className="icon-button" type="button" onClick={() => editDialogRef.current?.close()}><CloseIcon /></button>
          </div>
          <label className="field"><span>Tên</span><input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={100} required /></label>
          <label className="field"><span>Địa chỉ</span><input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} maxLength={260} /></label>
          <div className="two-fields">
            <label className="field"><span>Giá</span><select value={editPrice} onChange={(e) => setEditPrice(e.target.value as Place["priceLabel"])}><option value="$">$</option><option value="$$">$$</option><option value="$$$">$$$</option></select></label>
            <label className="field"><span>Đóng cửa</span><input value={editOpenUntil} onChange={(e) => setEditOpenUntil(e.target.value)} maxLength={60} /></label>
          </div>
          <label className="field"><span>Thời gian đẹp nhất</span><input value={editBestTime} onChange={(e) => setEditBestTime(e.target.value)} maxLength={100} /></label>
          <label className="field"><span>Ghi chú</span><textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={4} maxLength={500} /></label>
          <button className="primary-button primary-button--wide" type="submit">Lưu thay đổi</button>
        </form>
      </dialog>

      <dialog className="app-dialog" ref={ratingDialogRef}>
        <form className="dialog-card" onSubmit={submitRating}>
          <div className="dialog-header">
            <div><span className="eyebrow">Tín hiệu ranking</span><h2>Đánh giá {selected.name}</h2></div>
            <button className="icon-button" type="button" onClick={() => ratingDialogRef.current?.close()}><CloseIcon /></button>
          </div>
          <div className="rating-stars">
            {[1,2,3,4,5].map((star) => (
              <button
                key={star}
                type="button"
                className={ratingStars >= star ? "rating-star rating-star--active" : "rating-star"}
                onClick={() => setRatingStars(star)}
              >
                <StarIcon />
              </button>
            ))}
          </div>
          <fieldset className="dialog-fieldset">
            <legend>Hợp với</legend>
            <div className="scenario-row scenario-row--wrap">
              {scenarios.filter((item): item is Scenario => item !== "all").map((item) => (
                <button
                  type="button"
                  key={item}
                  className={"scenario-chip" + (ratingContexts.includes(item) ? " scenario-chip--active" : "")}
                  onClick={() => toggleRatingContext(item)}
                >
                  {scenarioLabels[item]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="dialog-fieldset">
            <legend>Có quay lại không?</legend>
            <div className="segmented">
              {([["yes","Có"],["maybe","Có thể"],["no","Không"]] as const).map(([value,label]) => (
                <button type="button" key={value} className={ratingRevisit === value ? "is-active" : ""} onClick={() => setRatingRevisit(value)}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>Một điều nên nhớ?</span>
            <textarea value={ratingNote} onChange={(e) => setRatingNote(e.target.value.slice(0,240))} rows={3} />
          </label>
          <button className="primary-button primary-button--wide" type="submit">Lưu đánh giá</button>
        </form>
      </dialog>

      <dialog className="app-dialog" ref={collectionDialogRef}>
        <form className="dialog-card" onSubmit={submitCollection}>
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Bộ sưu tập</span>
              <h2>{collectionEditingId ? "Sửa bộ sưu tập" : "Tạo bộ sưu tập"}</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => collectionDialogRef.current?.close()}><CloseIcon /></button>
          </div>
          <label className="field"><span>Tên</span><input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} maxLength={60} required placeholder="Date tối, Cafe yên…" /></label>
          <label className="field"><span>Mô tả</span><textarea value={collectionDescription} onChange={(e) => setCollectionDescription(e.target.value)} maxLength={180} rows={3} /></label>
          <button className="primary-button primary-button--wide" type="submit">
            {collectionEditingId ? "Lưu thay đổi" : "Tạo bộ sưu tập"}
          </button>
        </form>
      </dialog>

      <dialog className="app-dialog app-dialog--plan" ref={planDialogRef}>
        <div className="dialog-card plan-dialog-card">
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Tối nay đi đâu?</span>
              <h2>Lên một plan vừa đủ</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => planDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            Ghép các chặng gần nhau từ chính ranking cá nhân, budget và mood hiện tại.
          </p>

          <fieldset className="dialog-fieldset">
            <legend>Mood</legend>
            <div className="scenario-row scenario-row--wrap">
              {(["date", "friends", "fun", "chill", "food", "coffee"] as Scenario[]).map(
                (item) => (
                  <button
                    type="button"
                    key={item}
                    className={
                      "scenario-chip" +
                      (planScenario === item ? " scenario-chip--active" : "")
                    }
                    onClick={() => {
                      setPlanScenario(item);
                      setActivePlan(null);
                    }}
                  >
                    <span>{scenarioEmoji[item]}</span>
                    {scenarioLabels[item]}
                  </button>
                )
              )}
            </div>
          </fieldset>

          <div className="plan-control-grid">
            <label className="field">
              <span>Bắt đầu</span>
              <input
                type="time"
                value={planStartTime}
                onChange={(event) => {
                  setPlanStartTime(event.target.value);
                  setActivePlan(null);
                }}
              />
            </label>

            <label className="field">
              <span>Budget / 2 người</span>
              <select
                value={planBudget}
                onChange={(event) => {
                  setPlanBudget(Number(event.target.value));
                  setActivePlan(null);
                }}
              >
                <option value={400000}>400k</option>
                <option value={700000}>700k</option>
                <option value={1000000}>1 triệu</option>
                <option value={1500000}>1,5 triệu</option>
              </select>
            </label>

            <label className="field">
              <span>Thời lượng</span>
              <select
                value={planDuration}
                onChange={(event) => {
                  setPlanDuration(Number(event.target.value) as 2 | 3 | 4);
                  setActivePlan(null);
                }}
              >
                <option value={2}>2 giờ</option>
                <option value={3}>3 giờ</option>
                <option value={4}>4 giờ</option>
              </select>
            </label>

            <label className="field">
              <span>Bán kính</span>
              <select
                value={planDistance}
                onChange={(event) => {
                  setPlanDistance(Number(event.target.value));
                  setActivePlan(null);
                }}
              >
                <option value={3}>3 km</option>
                <option value={5}>5 km</option>
                <option value={8}>8 km</option>
                <option value={12}>12 km</option>
              </select>
            </label>
          </div>

          <button
            className="primary-button primary-button--wide"
            type="button"
            onClick={() => generatePlan(0)}
          >
            Tạo kế hoạch
          </button>

          {activePlan ? (
            <div className="plan-result">
              <div className="plan-result__summary">
                <div>
                  <span className="eyebrow">Phương án đề xuất</span>
                  <strong>{activePlan.summary}</strong>
                </div>
                <b>{activePlan.averageMatch}%</b>
              </div>

              {!activePlan.withinBudget ? (
                <div className="plan-warning">
                  Tổng ước lượng đang vượt budget một chút. App vẫn giữ phương án vì độ phù hợp cao nhất trong vùng đã chọn.
                </div>
              ) : null}

              <div className="plan-timeline">
                {activePlan.stops.map((stop, index) => (
                  <div className="plan-stop" key={stop.place.id}>
                    <div className="plan-stop__rail">
                      <span>{index + 1}</span>
                    </div>
                    <button
                      type="button"
                      className="plan-stop__content"
                      onClick={() => {
                        setSelectedId(stop.place.id);
                        mapRef.current?.flyTo({
                          center: [
                            stop.place.longitude,
                            stop.place.latitude
                          ],
                          zoom: 14,
                          duration: 650,
                          essential: true
                        });
                        planDialogRef.current?.close();
                      }}
                    >
                      <span className="plan-stop__top">
                        <small>
                          {stop.startTime} · {stop.stageLabel}
                        </small>
                        <b>{stop.place.match}%</b>
                      </span>
                      <strong>{stop.place.name}</strong>
                      <span className="plan-stop__reason">{stop.reason}</span>
                      <span className="plan-stop__meta">
                        ~{moneyLabel(stop.estimatedCostForTwo)}
                        {index > 0
                          ? " · " +
                            distanceLabel(stop.travelKmFromPrevious) +
                            " từ chặng trước"
                          : ""}
                      </span>
                    </button>
                  </div>
                ))}
              </div>

              <div className="plan-result__footer">
                <div>
                  <span>Tổng ước lượng</span>
                  <strong>
                    ~{moneyLabel(activePlan.totalEstimatedCostForTwo)}
                  </strong>
                </div>
                <div>
                  <span>Di chuyển</span>
                  <strong>{activePlan.routeKm.toFixed(1)} km</strong>
                </div>
              </div>

              <div className="plan-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => generatePlan(planVariant + 1)}
                >
                  Đổi phương án
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={openPlanRoute}
                >
                  <LocationIcon /> Mở tuyến đường
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </dialog>
    </main>
  );
}
