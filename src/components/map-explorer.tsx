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
import {
  buildEveningPlan,
  suggestWhatNext,
  toActivePlanSnapshot
} from "@/lib/planner";
import { placeFromPoiResult, scenarioLabels } from "@/lib/places";
import { openingStatus } from "@/lib/opening-hours";
import {
  deriveTasteProfile,
  tasteProfileSummary
} from "@/lib/taste";
import {
  filterPlaces,
  pickSurprisePlace,
  recommendForCollection
} from "@/lib/search";
import type {
  ActivePersonalPlan,
  ActivePlanStopSnapshot,
  Collection,
  EveningPlan,
  MapBounds,
  PersonalBackup,
  PersonalRating,
  RecommendationFeedback,
  RecommendationFeedbackReason,
  ProviderPlaceDetails,
  Place,
  PlaceMedia,
  PoiDiscoveryFilters,
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

const emptyPlace: Place = {
  id: "",
  name: "",
  kind: "Địa điểm",
  description: "",
  latitude: defaultCenter[1],
  longitude: defaultCenter[0],
  distanceKm: 0,
  priceLabel: "$",
  averageForTwo: "Chưa có dữ liệu",
  publicRating: 0,
  match: 0,
  communityNote: "",
  openUntil: "Chưa rõ",
  bestTime: "Chưa có dữ liệu",
  noise: "Vừa",
  crowd: "Vừa",
  tags: [],
  scenarios: [],
  note: "",
  accent: "#d9ddd7"
};

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

const discoveryCategoryOptions: Array<{
  value: PoiDiscoveryFilters["category"];
  label: string;
}> = [
  { value: "all", label: "Tất cả loại" },
  { value: "food", label: "Ăn uống" },
  { value: "cafe", label: "Cafe" },
  { value: "drink", label: "Bar / Pub" },
  { value: "activity", label: "Vui chơi" }
];

const discoveryAmenityOptions: Array<{
  value: PoiDiscoveryFilters["amenity"];
  label: string;
}> = [
  { value: "any", label: "Mọi tiện ích" },
  { value: "wifi", label: "Có Wi-Fi" },
  { value: "wheelchair", label: "Hỗ trợ xe lăn" }
];

const discoveryRadiusOptions: Array<{
  value: PoiDiscoveryFilters["radiusKm"];
  label: string;
}> = [
  { value: 0, label: "Theo bản đồ" },
  { value: 1, label: "Trong 1 km" },
  { value: 3, label: "Trong 3 km" },
  { value: 5, label: "Trong 5 km" },
  { value: 10, label: "Trong 10 km" }
];

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

function parkingLabel(
  parking: ProviderPlaceDetails["parking"]
) {
  if (!parking) return null;

  const typeLabels: Record<string, string> = {
    surface: "Bãi đỗ ngoài trời",
    underground: "Hầm đỗ xe",
    "multi-storey": "Nhà để xe nhiều tầng",
    lane: "Đỗ ven đường",
    carports: "Mái che đỗ xe",
    rooftop: "Bãi đỗ trên mái"
  };

  const accessLabels: Record<string, string> = {
    customers: "Cho khách",
    private: "Riêng tư",
    permit: "Cần giấy phép",
    designated: "Theo khu chỉ định",
    permissive: "Được phép"
  };

  const parts = [
    parking.type ? typeLabels[parking.type] ?? parking.type : null,
    parking.fee === true
      ? "Có phí"
      : parking.fee === false
        ? "Miễn phí"
        : null,
    parking.access
      ? accessLabels[parking.access] ?? parking.access
      : null,
    parking.capacity ? parking.capacity + " chỗ" : null,
    parking.supervised === true ? "Có giám sát" : null
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0
    ? parts.join(" · ")
    : "Có thông tin bãi đỗ xe";
}

function priceText(place: Pick<Place, "priceLabel" | "averageForTwo">) {
  if (place.averageForTwo === "Chưa có dữ liệu") return "Chưa rõ";
  if (place.priceLabel.length === 1) return "Tiết kiệm";
  if (place.priceLabel.length === 2) return "Vừa phải";
  return "Cao";
}

function priceBadge(place: Pick<Place, "priceLabel" | "averageForTwo">) {
  return place.averageForTwo === "Chưa có dữ liệu"
    ? "Giá chưa rõ"
    : place.priceLabel;
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

const recommendationFeedbackLabels: Record<
  RecommendationFeedbackReason,
  string
> = {
  not_taste: "Không hợp gu",
  not_now: "Không phải lúc này",
  too_far: "Quá xa",
  too_expensive: "Quá đắt"
};

function feedbackLabel(feedback: RecommendationFeedback | undefined) {
  return feedback
    ? recommendationFeedbackLabels[feedback.reason]
    : null;
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

function nextPlanStartAt(value: string, now: Date) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(now);

  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);

  if (target.getTime() < now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target;
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
  const [recommendationFeedbacks, setRecommendationFeedbacks] = useState<
    Record<string, RecommendationFeedback>
  >({});
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [dataStatus, setDataStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const [view, setView] = useState<PersonalView>("discover");
  const [query, setQuery] = useState("");
  const [scenario, setScenario] = useState<Scenario | "all">("all");
  const [selectedId, setSelectedId] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);

  const [providerResults, setProviderResults] = useState<PoiSearchResult[]>([]);
  const [discoveredPoiResults, setDiscoveredPoiResults] =
    useState<PoiSearchResult[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryFilters, setDiscoveryFilters] =
    useState<PoiDiscoveryFilters>({
      category: "all",
      amenity: "any",
      radiusKm: 0,
      openNow: false
    });
  const [placeMedia, setPlaceMedia] = useState<PlaceMedia | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [providerDetails, setProviderDetails] =
    useState<ProviderPlaceDetails | null>(null);
  const [providerDetailsLoading, setProviderDetailsLoading] =
    useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [placeCovers, setPlaceCovers] = useState<Record<string, string>>({});
  const [shortlist, setShortlist] = useState<Place[]>([]);
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
  const [planWeather, setPlanWeather] = useState<WeatherContext | null>(null);
  const [planWeatherLoading, setPlanWeatherLoading] = useState(false);
  const [activePlan, setActivePlan] = useState<EveningPlan | null>(null);
  const [runningPlan, setRunningPlan] =
    useState<ActivePersonalPlan | null>(null);

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
  const compareDialogRef = useRef<HTMLDialogElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const placePhotoInputRef = useRef<HTMLInputElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const [snapshot, activeResult] = await Promise.all([
        personalApi.snapshot(),
        personalApi.activePlan.get()
      ]);
      setCustomPlaces(snapshot.customPlaces);
      setSaved(new Set(snapshot.savedIds));
      setRatings(snapshot.ratings);
      setRecommendationFeedbacks(snapshot.recommendationFeedbacks);
      setVisits(snapshot.visits);
      setCollections(snapshot.collections);
      setRunningPlan(activeResult.activePlan);
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

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("di-dau-shortlist");
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      setShortlist(
        parsed
          .filter(
            (item): item is Place =>
              Boolean(
                item &&
                  typeof item === "object" &&
                  "id" in item &&
                  typeof (item as { id?: unknown }).id === "string"
              )
          )
          .slice(0, 3)
      );
    } catch {
      window.sessionStorage.removeItem("di-dau-shortlist");
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(
      "di-dau-shortlist",
      JSON.stringify(shortlist)
    );
  }, [shortlist]);

  useEffect(() => {
    const ids = customPlaces.map((place) => place.id).slice(0, 50);
    if (ids.length === 0) {
      setPlaceCovers({});
      return;
    }

    let active = true;
    void personalApi
      .getPlaceCovers(ids)
      .then(({ covers }) => {
        if (active) setPlaceCovers(covers);
      })
      .catch(() => {
        if (active) setPlaceCovers({});
      });

    return () => {
      active = false;
    };
  }, [customPlaces]);

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

  const importedProviderIds = useMemo(
    () =>
      new Set(
        customPlaces
          .map((place) => place.providerId)
          .filter((value): value is string => Boolean(value))
      ),
    [customPlaces]
  );

  const discoveredPlaces = useMemo(
    () =>
      discoveredPoiResults
        .filter((item) => !importedProviderIds.has(item.providerId))
        .filter(
          (item) =>
            !discoveryFilters.openNow ||
            openingStatus(item.openingHours, clock).state === "open"
        )
        .map(placeFromPoiResult),
    [
      discoveredPoiResults,
      importedProviderIds,
      discoveryFilters.openNow,
      clock
    ]
  );

  const allPlaces = useMemo(
    () => [...customPlaces, ...discoveredPlaces],
    [customPlaces, discoveredPlaces]
  );

  const tasteProfile = useMemo(
    () =>
      deriveTasteProfile(
        allPlaces,
        ratings,
        visits,
        recommendationFeedbacks
      ),
    [allPlaces, ratings, visits, recommendationFeedbacks]
  );

  const customIds = useMemo(
    () => new Set(customPlaces.map((place) => place.id)),
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
      {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
      serverDistances,
      recommendationContext,
      tasteProfile
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
    recommendationFeedbacks,
    visits,
    view,
    selectedCollection,
    recentVisitByPlace,
    serverDistances,
    recommendationContext,
    viewportBounds,
    viewportPersonalIds,
    customIds,
    tasteProfile
  ]);

  const rankedAll = useMemo(
    () =>
      filterPlaces(
        allPlaces,
        "",
        "all",
        userLocation,
        {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
        serverDistances,
        recommendationContext,
        tasteProfile
      ),
    [
      allPlaces,
      userLocation,
      saved,
      ratings,
      recommendationFeedbacks,
      visits,
      serverDistances,
      recommendationContext,
      tasteProfile
    ]
  );

  const collectionSuggestions = useMemo(() => {
    if (!selectedCollection) return [];
    return recommendForCollection(
      selectedCollection,
      rankedAll,
      {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
      4
    );
  }, [
    selectedCollection,
    rankedAll,
    saved,
    ratings,
    recommendationFeedbacks,
    visits
  ]);

  const shortlistView = useMemo(
    () =>
      shortlist.map(
        (item) => rankedAll.find((place) => place.id === item.id) ?? item
      ),
    [shortlist, rankedAll]
  );

  const shortlistIds = useMemo(
    () => new Set(shortlist.map((item) => item.id)),
    [shortlist]
  );

  const runningCurrentStop =
    runningPlan?.plan.stops[runningPlan.currentStopIndex] ?? null;
  const runningNextStop =
    runningPlan?.plan.stops[runningPlan.currentStopIndex + 1] ?? null;

  const selected =
    visiblePlaces.find((place) => place.id === selectedId) ??
    rankedAll.find((place) => place.id === selectedId) ??
    visiblePlaces[0] ??
    rankedAll[0] ??
    emptyPlace;

  const hasSelectedPlace = Boolean(selected.id);
  const selectedPersonalRating = hasSelectedPlace
    ? ratings[selected.id] ?? null
    : null;
  const selectedOpening = openingStatus(
    providerDetails &&
      providerDetails.providerId === selected.providerId &&
      providerDetails.openingHours
      ? providerDetails.openingHours
      : selected.openUntil,
    clock
  );
  const selectedFeedback = hasSelectedPlace
    ? recommendationFeedbacks[selected.id]
    : undefined;
  const selectedVisit = recentVisitByPlace.get(selected.id) ?? null;
  const selectedVisitTime = selectedVisit
    ? new Date(selectedVisit.visitedAt).getTime()
    : Number.NaN;
  const selectedVisitedRecently =
    Number.isFinite(selectedVisitTime) &&
    clock.getTime() - selectedVisitTime >= 0 &&
    clock.getTime() - selectedVisitTime <= 8 * 60 * 60 * 1000;

  const whatNextSuggestions = useMemo(() => {
    const generic = selectedVisitedRecently
      ? suggestWhatNext({
          current: selected,
          places: rankedAll,
          signals: {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
          maxDistanceKm: 4,
          limit: 3,
          localHour: recommendationContext.localHour
        })
      : [];

    if (!runningNextStop) return generic;

    const plannedPlace = rankedAll.find(
      (place) => place.id === runningNextStop.placeId
    );
    if (!plannedPlace) return generic;

    const planned = {
      place: plannedPlace,
      distanceKm: runningNextStop.travelKmFromPrevious,
      estimatedTravelMinutes: runningNextStop.travelMinutesFromPrevious,
      estimatedCostForTwo: runningNextStop.estimatedCostForTwo,
      transitionLabel: "Theo plan · " + runningNextStop.stageLabel,
      reason: "Chặng tiếp theo đã chốt trong kế hoạch"
    };

    return [
      planned,
      ...generic.filter((item) => item.place.id !== plannedPlace.id)
    ].slice(0, 3);
  }, [
    selectedVisitedRecently,
    selected,
    rankedAll,
    saved,
    ratings,
    recommendationFeedbacks,
    visits,
    recommendationContext.localHour,
    runningNextStop
  ]);

  const isPersonalPlace =
    hasSelectedPlace && customIds.has(selected.id);
  const heroUserPhoto = placeMedia?.userPhotos[0] ?? null;
  const heroGooglePhoto = placeMedia?.google?.photos[0] ?? null;
  const heroPhotoUrl = heroUserPhoto?.url ?? heroGooglePhoto?.url ?? null;

  useEffect(() => {
    let active = true;

    if (!isPersonalPlace) {
      setPlaceMedia(null);
      setMediaLoading(false);
      return () => {
        active = false;
      };
    }

    setMediaLoading(true);
    setPlaceMedia(null);

    void personalApi
      .getPlaceMedia(selected.id)
      .then((media) => {
        if (active) setPlaceMedia(media);
      })
      .catch(() => {
        if (active) setPlaceMedia(null);
      })
      .finally(() => {
        if (active) setMediaLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selected.id, isPersonalPlace]);

  useEffect(() => {
    let active = true;
    const providerId = selected.providerId;

    if (
      !hasSelectedPlace ||
      !providerId?.startsWith("geoapify:")
    ) {
      setProviderDetails(null);
      setProviderDetailsLoading(false);
      return () => {
        active = false;
      };
    }

    setProviderDetailsLoading(true);
    setProviderDetails(null);

    void personalApi
      .getProviderPlaceDetails(providerId)
      .then((result) => {
        if (active) setProviderDetails(result.details);
      })
      .catch(() => {
        if (active) setProviderDetails(null);
      })
      .finally(() => {
        if (active) setProviderDetailsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selected.providerId, hasSelectedPlace]);

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
    if (!mapReady || !mapRef.current || view !== "discover") return;

    const timer = window.setTimeout(() => {
      const raw = mapRef.current?.getBounds();
      if (!raw) return;

      void refreshDiscovery(
        {
          west: raw.getWest(),
          south: raw.getSouth(),
          east: raw.getEast(),
          north: raw.getNorth()
        },
        false
      );
    }, 180);

    return () => window.clearTimeout(timer);
  }, [
    discoveryFilters.category,
    discoveryFilters.amenity,
    discoveryFilters.radiusKm,
    mapReady,
    view
  ]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const center = mapRef.current.getCenter();
    void refreshWeather({
      latitude: center.lat,
      longitude: center.lng
    });

    const raw = mapRef.current.getBounds();
    void refreshDiscovery(
      {
        west: raw.getWest(),
        south: raw.getSouth(),
        east: raw.getEast(),
        north: raw.getNorth()
      },
      false
    );
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
    if (!mapReady || !mapRef.current || !hasSelectedPlace) return;
    mapRef.current.flyTo({
      center: [selected.longitude, selected.latitude],
      zoom: 13,
      duration: 650,
      essential: true
    });
  }, [mapReady, selected, hasSelectedPlace]);

  useEffect(() => {
    if (
      visiblePlaces.length > 0 &&
      !visiblePlaces.some((place) => place.id === selectedId)
    ) {
      setSelectedId(visiblePlaces[0]!.id);
    }
  }, [visiblePlaces, selectedId]);

  function toggleShortlist(place: Place) {
    setShortlist((current) => {
      const exists = current.some((item) => item.id === place.id);
      if (exists) {
        return current.filter((item) => item.id !== place.id);
      }

      if (current.length >= 3) {
        setNotice("Shortlist tối đa 3 địa điểm để so sánh nhanh.");
        return current;
      }

      return [...current, place];
    });
  }

  function openCompare() {
    if (shortlist.length < 2) {
      setNotice("Chọn ít nhất 2 địa điểm để so sánh.");
      return;
    }
    compareDialogRef.current?.showModal();
  }

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
        mapRef.current?.once("moveend", () => {
          const raw = mapRef.current?.getBounds();
          if (!raw) return;
          void refreshDiscovery(
            {
              west: raw.getWest(),
              south: raw.getSouth(),
              east: raw.getEast(),
              north: raw.getNorth()
            },
            false
          );
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

  async function refreshDiscovery(
    bounds: MapBounds,
    announce = false
  ) {
    setDiscoveryLoading(true);
    try {
      const result = await personalApi.discoverPoi(
        bounds,
        discoveryFilters
      );
      setDiscoveredPoiResults(result.results);
      if (announce) {
        setNotice(
          result.results.length > 0
            ? "Đã tìm " + result.results.length + " địa điểm thật trong vùng."
            : "Chưa tìm thấy POI phù hợp trong vùng này."
        );
      }
    } catch (error) {
      if (announce) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Không thể tải địa điểm thật."
        );
      }
    } finally {
      setDiscoveryLoading(false);
    }
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
      const [viewportResult, discoveryResult] = await Promise.all([
        personalApi.viewport(bounds),
        personalApi.discoverPoi(bounds, discoveryFilters),
        refreshWeather({
          latitude: center.lat,
          longitude: center.lng
        })
      ]);

      setViewportPersonalIds(
        new Set(viewportResult.results.map((item) => item.placeId))
      );
      setDiscoveredPoiResults(discoveryResult.results);

      const cleaned = cleanPlainText(query, 120);
      if (cleaned.length >= 2) {
        await runPoiSearch(undefined, bounds);
      } else {
        setProviderResults([]);
      }

      setNotice(
        "Đã tìm " +
          discoveryResult.results.length +
          " địa điểm thật trong vùng bản đồ."
      );
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
      {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      }
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

  async function generatePlan(nextVariant = planVariant) {
    const origin = plannerOrigin();
    const targetAt = nextPlanStartAt(planStartTime, clock);
    setPlanWeatherLoading(true);

    let forecast: WeatherContext | null = null;
    try {
      const result = await personalApi.weather(
        origin,
        targetAt.toISOString()
      );
      forecast = result.weather;
      setPlanWeather(result.weather);
    } catch {
      setPlanWeather(null);
    }

    const planContext: RecommendationContext = {
      localHour: targetAt.getHours(),
      isWeekend:
        targetAt.getDay() === 0 || targetAt.getDay() === 6,
      weather: forecast ?? weather
    };

    const forecastRanked = filterPlaces(
      allPlaces,
      "",
      "all",
      origin,
      {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
      undefined,
      planContext,
      tasteProfile
    );

    const source = viewportBounds
      ? forecastRanked.filter((place) => {
          if (customIds.has(place.id) && viewportPersonalIds) {
            return viewportPersonalIds.has(place.id);
          }
          return placeInsideBounds(place, viewportBounds);
        })
      : forecastRanked;

    const result = buildEveningPlan({
      places: source,
      preferences: {
        scenario: planScenario,
        budgetForTwo: planBudget,
        maxDistanceKm: planDistance,
        durationHours: planDuration,
        startTime: planStartTime
      },
      signals: {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
      origin,
      variant: nextVariant
    });

    setPlanWeatherLoading(false);
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
    setPlanWeather(null);
    setPlanWeatherLoading(false);
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

  function focusRunningStop(stop: ActivePlanStopSnapshot) {
    setSelectedId(stop.placeId);
    mapRef.current?.flyTo({
      center: [stop.longitude, stop.latitude],
      zoom: 14,
      duration: 650,
      essential: true
    });
  }

  function openRunningStopRoute(stop: ActivePlanStopSnapshot) {
    const params = new URLSearchParams({
      api: "1",
      destination: stop.latitude + "," + stop.longitude,
      travelmode: "driving"
    });

    if (userLocation) {
      params.set(
        "origin",
        userLocation.latitude + "," + userLocation.longitude
      );
    }

    window.open(
      "https://www.google.com/maps/dir/?" + params.toString(),
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function startRunningPlan() {
    if (!activePlan) return;

    if (
      runningPlan &&
      !window.confirm(
        "Bạn đang có một plan đang đi. Thay bằng phương án mới?"
      )
    ) {
      return;
    }

    try {
      const persistedStops = [];
      for (const stop of activePlan.stops) {
        const place = await persistProviderPlace(stop.place);
        persistedStops.push({ ...stop, place });
      }

      const persistedPlan: EveningPlan = {
        ...activePlan,
        stops: persistedStops
      };

      await loadSnapshot();

      const result = await personalApi.activePlan.start(
        toActivePlanSnapshot(persistedPlan)
      );
      setRunningPlan(result.activePlan);
      planDialogRef.current?.close();

      const first = result.activePlan.plan.stops[0];
      if (first) focusRunningStop(first);

      setNotice(
        "Đã bắt đầu plan · " +
          result.activePlan.plan.stops.length +
          " chặng."
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể bắt đầu kế hoạch."
      );
    }
  }

  async function advanceRunningPlan(action: "complete" | "skip") {
    if (!runningPlan) return;

    try {
      const result = await personalApi.activePlan.advance(
        action,
        runningPlan.currentStopIndex
      );
      setRunningPlan(result.activePlan);

      if (result.stale) {
        setNotice(
          "Plan đã thay đổi ở tab khác. Đã đồng bộ về chặng hiện tại."
        );
        return;
      }

      if (result.recordedVisit) {
        const snapshot = await personalApi.snapshot();
        setCustomPlaces(snapshot.customPlaces);
        setSaved(new Set(snapshot.savedIds));
        setRatings(snapshot.ratings);
        setVisits(snapshot.visits);
        setCollections(snapshot.collections);
      }

      if (result.finished) {
        setNotice(
          action === "complete"
            ? "Đã hoàn thành plan. Lịch sử chuyến đi đã được cập nhật."
            : "Plan đã kết thúc."
        );
        return;
      }

      const next =
        result.activePlan?.plan.stops[
          result.activePlan.currentStopIndex
        ];
      if (next) {
        focusRunningStop(next);
        setNotice(
          action === "complete"
            ? "Xong chặng · tiếp theo: " + next.name
            : "Đã bỏ qua · chuyển sang: " + next.name
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật kế hoạch."
      );
    }
  }

  async function cancelRunningPlan() {
    if (!runningPlan) return;
    if (!window.confirm("Hủy plan đang đi? Lịch sử check-in vẫn được giữ.")) {
      return;
    }

    try {
      await personalApi.activePlan.cancel();
      setRunningPlan(null);
      setNotice("Đã hủy plan đang đi.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể hủy kế hoạch."
      );
    }
  }

  async function persistProviderPlace(place: Place) {
    if (customIds.has(place.id)) return place;

    if (place.source !== "provider" || !place.providerId) {
      throw new Error("Địa điểm này chưa thể lưu tự động.");
    }

    const imported = await personalApi.importProviderPlace(place);
    if (selected.id === place.id) {
      setSelectedId(imported.place.id);
    }
    return imported.place;
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
    const source =
      allPlaces.find((place) => place.id === placeId) ?? selected;
    const wasSaved = saved.has(placeId);

    try {
      const target = wasSaved
        ? source
        : await persistProviderPlace(source);
      await personalApi.setSaved(target.id, !wasSaved);
      await loadSnapshot();
      setSelectedId(target.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể lưu.");
    }
  }

  async function openRating() {
    if (!hasSelectedPlace) return;

    try {
      const target = await persistProviderPlace(selected);
      if (target.id !== selected.id) {
        await loadSnapshot();
        setSelectedId(target.id);
      }

      const current = ratings[target.id];
      setRatingStars(current?.stars ?? 5);
      setRatingRevisit(current?.revisit ?? "yes");
      setRatingContexts(
        current?.contexts.length
          ? current.contexts
          : target.scenarios.slice(0, 2)
      );
      setRatingNote(current?.note ?? "");
      ratingDialogRef.current?.showModal();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể chuẩn bị đánh giá."
      );
    }
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
    if (!hasSelectedPlace) return;

    try {
      const target = await persistProviderPlace(selected);
      await personalApi.checkIn(target.id);
      await loadSnapshot();
      setSelectedId(target.id);

      if (runningCurrentStop?.placeId === target.id) {
        setNotice(
          "Đã check-in chặng hiện tại · khi rời đi bấm Xong chặng."
        );
        return;
      }

      const next = suggestWhatNext({
        current: target,
        places: rankedAll,
        signals: {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits
      },
        maxDistanceKm: 4,
        limit: 1,
        localHour: recommendationContext.localHour
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

  async function setSelectedRecommendationFeedback(
    reason: RecommendationFeedbackReason
  ) {
    if (!hasSelectedPlace) return;

    try {
      const target = await persistProviderPlace(selected);
      await personalApi.setRecommendationFeedback(target.id, {
        reason,
        scenario: scenario === "all" ? null : scenario,
        distanceKm:
          Number.isFinite(target.distanceKm) && target.distanceKm > 0
            ? target.distanceKm
            : null
      });
      await loadSnapshot();
      setSelectedId(target.id);
      setNotice(
        "Đã ghi nhận: " + recommendationFeedbackLabels[reason] +
        ". Ranking đã được cập nhật."
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể lưu phản hồi gợi ý."
      );
    }
  }

  async function clearSelectedRecommendationFeedback() {
    if (!selectedFeedback) return;

    try {
      await personalApi.clearRecommendationFeedback(selected.id);
      await loadSnapshot();
      setNotice("Đã hoàn tác phản hồi gợi ý.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể hoàn tác phản hồi."
      );
    }
  }

  async function uploadSelectedPhoto(file: File) {
    if (!isPersonalPlace) return;

    setPhotoUploading(true);
    try {
      await personalApi.uploadPlacePhoto(selected.id, file);
      const media = await personalApi.getPlaceMedia(selected.id);
      setPlaceMedia(media);
      setPlaceCovers((current) => {
        const next = { ...current };
        const cover = media.userPhotos[0]?.url;
        if (cover) next[selected.id] = cover;
        else delete next[selected.id];
        return next;
      });
      setNotice("Đã thêm ảnh thật cho địa điểm.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể tải ảnh lên."
      );
    } finally {
      if (placePhotoInputRef.current) {
        placePhotoInputRef.current.value = "";
      }
      setPhotoUploading(false);
    }
  }

  async function deleteSelectedPhoto(photoId: string) {
    try {
      await personalApi.deletePlacePhoto(photoId);
      const media = await personalApi.getPlaceMedia(selected.id);
      setPlaceMedia(media);
      setPlaceCovers((current) => {
        const next = { ...current };
        const cover = media.userPhotos[0]?.url;
        if (cover) next[selected.id] = cover;
        else delete next[selected.id];
        return next;
      });
      setNotice("Đã xóa ảnh.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể xóa ảnh."
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
      setSelectedId("");
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
    try {
      const source =
        allPlaces.find((place) => place.id === placeId) ?? selected;
      const target = customIds.has(placeId)
        ? source
        : await persistProviderPlace(source);
      const included = !collection.placeIds.includes(target.id);

      await personalApi.setCollectionPlace(
        collection.id,
        target.id,
        included
      );
      await loadSnapshot();
      setSelectedId(target.id);
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
          <span className="legal-links">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
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

        {view === "discover" ? (
          <div className="discovery-filter-row">
            <label>
              <span>Loại</span>
              <select
                value={discoveryFilters.category}
                onChange={(event) =>
                  setDiscoveryFilters((current) => ({
                    ...current,
                    category: event.target
                      .value as PoiDiscoveryFilters["category"]
                  }))
                }
              >
                {discoveryCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Tiện ích</span>
              <select
                value={discoveryFilters.amenity}
                onChange={(event) =>
                  setDiscoveryFilters((current) => ({
                    ...current,
                    amenity: event.target
                      .value as PoiDiscoveryFilters["amenity"]
                  }))
                }
              >
                {discoveryAmenityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Bán kính</span>
              <select
                value={String(discoveryFilters.radiusKm)}
                onChange={(event) =>
                  setDiscoveryFilters((current) => ({
                    ...current,
                    radiusKm: Number(
                      event.target.value
                    ) as PoiDiscoveryFilters["radiusKm"]
                  }))
                }
              >
                {discoveryRadiusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={
                "discovery-open-toggle" +
                (discoveryFilters.openNow
                  ? " discovery-open-toggle--active"
                  : "")
              }
              onClick={() =>
                setDiscoveryFilters((current) => ({
                  ...current,
                  openNow: !current.openNow
                }))
              }
            >
              <span className="discovery-open-dot" />
              Đang mở
            </button>

            {discoveryFilters.category !== "all" ||
            discoveryFilters.amenity !== "any" ||
            discoveryFilters.radiusKm !== 0 ||
            discoveryFilters.openNow ? (
              <button
                type="button"
                className="discovery-filter-reset"
                onClick={() =>
                  setDiscoveryFilters({
                    category: "all",
                    amenity: "any",
                    radiusKm: 0,
                    openNow: false
                  })
                }
              >
                Xóa lọc
              </button>
            ) : null}
          </div>
        ) : null}

        {runningPlan && runningCurrentStop ? (
          <div className="active-plan-strip">
            <button
              type="button"
              className="active-plan-strip__main"
              onClick={() => focusRunningStop(runningCurrentStop)}
            >
              <span>
                Đang đi · Chặng {runningPlan.currentStopIndex + 1}/
                {runningPlan.plan.stops.length}
              </span>
              <strong>{runningCurrentStop.name}</strong>
              <small>
                {runningCurrentStop.startTime}–{runningCurrentStop.endTime} · ~
                {moneyLabel(runningCurrentStop.estimatedCostForTwo)}
              </small>
            </button>
            <div className="active-plan-strip__actions">
              <button
                type="button"
                onClick={() => openRunningStopRoute(runningCurrentStop)}
              >
                Chỉ đường
              </button>
              <button
                type="button"
                className="active-plan-strip__done"
                onClick={() => void advanceRunningPlan("complete")}
              >
                ✓ Xong
              </button>
              <button
                type="button"
                onClick={() => void advanceRunningPlan("skip")}
              >
                Bỏ qua
              </button>
              <button
                type="button"
                className="active-plan-strip__cancel"
                aria-label="Hủy plan"
                onClick={() => void cancelRunningPlan()}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

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

        {view === "discover" && tasteProfile.sampleSize >= 2 ? (
          <div className="taste-strip">
            <span>Gu đang học</span>
            <strong>{tasteProfileSummary(tasteProfile)}</strong>
            <small>
              {tasteProfile.sampleSize} nơi ·{" "}
              {Math.round(tasteProfile.confidence * 100)}% confidence
            </small>
          </div>
        ) : null}

        {providerResults.length > 0 ? (
          <div className="provider-results">
            <div className="provider-results__title">
              <strong>
                {providerResults[0]?.provider === "geoapify"
                  ? "Geoapify"
                  : "OpenStreetMap"}
              </strong>
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

        {(selectedVisitedRecently || Boolean(runningPlan)) &&
        whatNextSuggestions[0] ? (
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
                  : discoveryLoading && view === "discover"
                    ? "Đang tải địa điểm thật…"
                    : "Chưa có địa điểm trong chế độ này."}
              </strong>
              <span>
                {view === "collections"
                  ? "Tạo bộ sưu tập rồi thêm địa điểm từ phần chi tiết."
                  : discoveryLoading
                    ? "Đang lấy POI thật trong viewport hiện tại."
                    : "Pan/zoom bản đồ rồi bấm “Tìm khu vực này”, hoặc tìm theo tên ở ô phía trên."}
              </span>
            </div>
          ) : (
            visiblePlaces.map((place) => {
              const rating = ratings[place.id];
              const visit = recentVisitByPlace.get(place.id);
              const status = openingStatus(place.openUntil, clock);
              const cover = placeCovers[place.id];
              const shortlisted = shortlistIds.has(place.id);

              return (
                <div
                  key={place.id}
                  className={
                    "place-card" +
                    (selected.id === place.id ? " place-card--active" : "")
                  }
                >
                  <button
                    type="button"
                    className="place-card__main"
                    onClick={() => setSelectedId(place.id)}
                  >
                    <span
                      className={
                        "place-thumb" +
                        (cover ? " place-thumb--photo" : "")
                      }
                      style={{ "--place-accent": place.accent } as CSSProperties}
                      aria-hidden="true"
                    >
                      {cover ? (
                        <img src={cover} alt="" />
                      ) : (
                        placeIcon(place)
                      )}
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
                        <span>{priceBadge(place)}</span>
                      </span>

                      <span className="place-card__status-row">
                        <i
                          className={
                            "opening-badge opening-badge--" + status.state
                          }
                        >
                          {status.label}
                          {status.detail && status.state === "open"
                            ? " · " + status.detail
                            : ""}
                        </i>
                        {place.source === "provider" ? (
                          <em>
                            {place.providerId?.startsWith("geoapify:")
                              ? "Geoapify"
                              : "OSM"}
                          </em>
                        ) : null}
                      </span>

                      <span className="tag-line">
                        {visit ? (
                          <i>Đã đi {formatVisitedAt(visit.visitedAt)}</i>
                        ) : null}
                        {place.recommendationReasons?.[0] ? (
                          <i>{place.recommendationReasons[0]}</i>
                        ) : null}
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={
                      "shortlist-toggle" +
                      (shortlisted ? " shortlist-toggle--active" : "")
                    }
                    aria-label={
                      shortlisted
                        ? "Bỏ khỏi shortlist"
                        : "Thêm vào shortlist"
                    }
                    onClick={() => toggleShortlist(place)}
                  >
                    {shortlisted ? "✓" : "+"}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {shortlist.length > 0 ? (
          <div className="shortlist-tray">
            <div>
              <span>Shortlist</span>
              <strong>{shortlist.length}/3 địa điểm</strong>
            </div>
            <div className="shortlist-tray__names">
              {shortlistView.map((place) => (
                <button
                  type="button"
                  key={place.id}
                  onClick={() => setSelectedId(place.id)}
                >
                  {place.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="shortlist-tray__compare"
              disabled={shortlist.length < 2}
              onClick={openCompare}
            >
              So sánh
            </button>
            <button
              type="button"
              className="shortlist-tray__clear"
              aria-label="Xóa shortlist"
              onClick={() => setShortlist([])}
            >
              ×
            </button>
          </div>
        ) : null}

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
            disabled={viewportLoading || discoveryLoading}
          >
            {viewportLoading || discoveryLoading
              ? "Đang tìm…"
              : "Tìm khu vực này"}
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

        <a
          className="osm-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </section>

      <aside className="detail-pane" aria-label="Chi tiết địa điểm">
        {hasSelectedPlace ? (
          <>
        <div
          className={
            "detail-hero" +
            (heroPhotoUrl ? " detail-hero--photo" : "")
          }
          style={{ "--place-accent": selected.accent } as CSSProperties}
        >
          {heroPhotoUrl ? (
            <img
              className="detail-hero__image"
              src={heroPhotoUrl}
              alt={"Ảnh " + selected.name}
            />
          ) : (
            <span className="detail-hero__icon" aria-hidden="true">
              {placeIcon(selected)}
            </span>
          )}

          {heroGooglePhoto && !heroUserPhoto ? (
            <div className="google-photo-attribution">
              <strong>Google Maps</strong>
              {heroGooglePhoto.authorAttributions[0] ? (
                heroGooglePhoto.authorAttributions[0].uri ? (
                  <a
                    href={heroGooglePhoto.authorAttributions[0].uri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {heroGooglePhoto.authorAttributions[0].displayName}
                  </a>
                ) : (
                  <span>
                    {heroGooglePhoto.authorAttributions[0].displayName}
                  </span>
                )
              ) : null}
            </div>
          ) : null}

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
                {selected.source === "provider"
                  ? selected.providerId?.startsWith("geoapify:")
                    ? " · Geoapify"
                    : " · OSM"
                  : ""}
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
            <span>{priceBadge(selected)}</span>
          </div>

          <div className="detail-opening-row">
            {placeMedia?.google?.openNow !== null &&
            placeMedia?.google?.openNow !== undefined ? (
              <span
                className={
                  "opening-badge opening-badge--" +
                  (placeMedia.google.openNow ? "open" : "closed")
                }
              >
                {placeMedia.google.openNow ? "Đang mở" : "Đang đóng"} · Google
              </span>
            ) : (
              <span
                className={
                  "opening-badge opening-badge--" + selectedOpening.state
                }
              >
                {selectedOpening.label}
                {selectedOpening.detail && selectedOpening.state === "open"
                  ? " · " + selectedOpening.detail
                  : ""}
              </span>
            )}

            <button
              type="button"
              className={
                "detail-shortlist-button" +
                (shortlistIds.has(selected.id)
                  ? " detail-shortlist-button--active"
                  : "")
              }
              onClick={() => toggleShortlist(selected)}
            >
              {shortlistIds.has(selected.id)
                ? "✓ Đã shortlist"
                : "+ Shortlist"}
            </button>
          </div>

          {selected.address ? (
            <p className="place-address">{selected.address}</p>
          ) : null}

          {providerDetailsLoading &&
          selected.providerId?.startsWith("geoapify:") ? (
            <section className="provider-detail-card provider-detail-card--loading">
              <span className="eyebrow">Thông tin địa điểm</span>
              <strong>Đang tải dữ liệu thực tế…</strong>
            </section>
          ) : providerDetails ? (
            <section className="provider-detail-card">
              <div className="provider-detail-card__head">
                <div>
                  <span className="eyebrow">Thông tin địa điểm</span>
                  <strong>
                    {providerDetails.brand ?? selected.name}
                  </strong>
                </div>
                <span className="provider-source-badge">Geoapify</span>
              </div>

              {providerDetails.description ? (
                <p className="provider-detail-description">
                  {providerDetails.description}
                </p>
              ) : null}

              {providerDetails.categories.length > 0 ||
              providerDetails.facilities.length > 0 ? (
                <div className="provider-detail-chips">
                  {providerDetails.categories.map((item) => (
                    <i key={"category-" + item}>{item}</i>
                  ))}
                  {providerDetails.facilities.map((item) => (
                    <i
                      className="provider-detail-chip--facility"
                      key={"facility-" + item}
                    >
                      {item}
                    </i>
                  ))}
                </div>
              ) : null}

              {providerDetails.openingHours ||
              providerDetails.parking ||
              providerDetails.wheelchairNote ? (
                <dl className="provider-fact-grid">
                  {providerDetails.openingHours ? (
                    <div>
                      <dt>Giờ mở cửa</dt>
                      <dd>{providerDetails.openingHours}</dd>
                    </div>
                  ) : null}
                  {providerDetails.parking ? (
                    <div>
                      <dt>Đỗ xe</dt>
                      <dd>{parkingLabel(providerDetails.parking)}</dd>
                    </div>
                  ) : null}
                  {providerDetails.wheelchairNote ? (
                    <div>
                      <dt>Tiếp cận</dt>
                      <dd>{providerDetails.wheelchairNote}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              <div className="provider-detail-links">
                {providerDetails.website ? (
                  <a
                    href={providerDetails.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Website
                  </a>
                ) : null}
                {providerDetails.phone ? (
                  <a href={"tel:" + providerDetails.phone}>
                    Gọi điện
                  </a>
                ) : null}
                {providerDetails.email ? (
                  <a href={"mailto:" + providerDetails.email}>
                    Email
                  </a>
                ) : null}
                <a
                  href={
                    "https://www.google.com/maps/search/?api=1&query=" +
                    encodeURIComponent(
                      selected.latitude + "," + selected.longitude
                    )
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Xem Google Maps
                </a>
              </div>

              <small className="provider-detail-note">
                Dữ liệu nhà cung cấp có thể chưa đầy đủ hoặc thay đổi theo thời gian.
              </small>
            </section>
          ) : null}

          {isPersonalPlace ? (
            <section className="place-media-block">
              <div className="place-media-block__head">
                <div>
                  <span className="eyebrow">Ảnh thật</span>
                  <strong>
                    {mediaLoading
                      ? "Đang tìm ảnh…"
                      : placeMedia?.userPhotos.length
                        ? placeMedia.userPhotos.length + " ảnh của bạn"
                        : placeMedia?.google?.photos.length
                          ? "Có ảnh Google Maps"
                          : "Chưa có ảnh"}
                  </strong>
                </div>

                <button
                  type="button"
                  disabled={photoUploading}
                  onClick={() => placePhotoInputRef.current?.click()}
                >
                  {photoUploading ? "Đang tải…" : "+ Thêm ảnh"}
                </button>
                <input
                  ref={placePhotoInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadSelectedPhoto(file);
                  }}
                />
              </div>

              {placeMedia &&
              (placeMedia.userPhotos.length > 0 ||
                (placeMedia.google?.photos.length ?? 0) > 0) ? (
                <div className="place-photo-grid">
                  {placeMedia.userPhotos.slice(0, 4).map((photo) => (
                    <figure className="place-photo-card" key={photo.id}>
                      <img src={photo.url} alt={"Ảnh " + selected.name} />
                      <figcaption>
                        <span>Ảnh của bạn</span>
                        <button
                          type="button"
                          aria-label="Xóa ảnh"
                          onClick={() => void deleteSelectedPhoto(photo.id)}
                        >
                          ×
                        </button>
                      </figcaption>
                    </figure>
                  ))}

                  {placeMedia.google?.photos
                    .slice(0, Math.max(0, 4 - placeMedia.userPhotos.length))
                    .map((photo, index) => (
                      <figure
                        className="place-photo-card place-photo-card--google"
                        key={"google-" + index}
                      >
                        <img
                          src={photo.url}
                          alt={"Ảnh Google Maps của " + selected.name}
                        />
                        <figcaption>
                          <span>Google Maps</span>
                          {photo.authorAttributions[0] ? (
                            photo.authorAttributions[0].uri ? (
                              <a
                                href={photo.authorAttributions[0].uri}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {photo.authorAttributions[0].displayName}
                              </a>
                            ) : (
                              <small>
                                {photo.authorAttributions[0].displayName}
                              </small>
                            )
                          ) : null}
                        </figcaption>
                      </figure>
                    ))}
                </div>
              ) : null}

              {placeMedia?.google ? (
                <div className="google-live-strip">
                  <div>
                    <strong>Google Maps</strong>
                    <span>
                      {placeMedia.google.rating !== null
                        ? "★ " +
                          placeMedia.google.rating.toFixed(1) +
                          (placeMedia.google.userRatingCount !== null
                            ? " · " +
                              placeMedia.google.userRatingCount.toLocaleString(
                                "vi-VN"
                              ) +
                              " đánh giá"
                            : "")
                        : "Thông tin live"}
                    </span>
                  </div>
                  <div>
                    {placeMedia.google.openNow !== null ? (
                      <b
                        className={
                          placeMedia.google.openNow
                            ? "is-open"
                            : "is-closed"
                        }
                      >
                        {placeMedia.google.openNow ? "Đang mở" : "Đang đóng"}
                      </b>
                    ) : null}
                    <a
                      href={placeMedia.google.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Xem trên Google Maps
                    </a>
                  </div>
                </div>
              ) : null}
            </section>
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
            <button type="button" className="secondary-button" onClick={() => void openRating()}>
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

            <div className="recommendation-feedback">
              <div className="recommendation-feedback__head">
                <div>
                  <strong>Gợi ý này chưa đúng?</strong>
                  <span>
                    Phản hồi giúp ĐiĐâu học mà không cần chờ bạn check-in.
                  </span>
                </div>
                {selectedFeedback ? (
                  <button
                    type="button"
                    onClick={() =>
                      void clearSelectedRecommendationFeedback()
                    }
                  >
                    Hoàn tác
                  </button>
                ) : null}
              </div>

              <div className="recommendation-feedback__options">
                {(Object.keys(
                  recommendationFeedbackLabels
                ) as RecommendationFeedbackReason[]).map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className={
                      selectedFeedback?.reason === reason
                        ? "is-active"
                        : ""
                    }
                    onClick={() =>
                      void setSelectedRecommendationFeedback(reason)
                    }
                  >
                    {recommendationFeedbackLabels[reason]}
                  </button>
                ))}
              </div>

              {selectedFeedback ? (
                <small>
                  Đang áp dụng: {feedbackLabel(selectedFeedback)}
                  {selectedFeedback.reason === "not_now"
                    ? " · tự giảm tác động theo thời gian"
                    : selectedFeedback.reason === "too_far"
                      ? " · tự nhẹ đi khi bạn ở gần hơn"
                      : ""}
                </small>
              ) : null}
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
                <button type="button" onClick={() => void openRating()}>Thêm đánh giá</button>
              </div>
            )}
          </section>

          {(selectedVisitedRecently || Boolean(runningPlan)) &&
          whatNextSuggestions.length > 0 ? (
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
                    <small>
                      {item.reason} · ~{moneyLabel(item.estimatedCostForTwo)}
                    </small>
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
              <div><dt>Khoảng giá</dt><dd>{priceText(selected)}</dd></div>
              <div><dt>Không gian</dt><dd>{selected.noise}</dd></div>
              <div><dt>Đông đúc</dt><dd>{selected.crowd}</dd></div>
              <div><dt>Đi đẹp nhất</dt><dd>{selected.bestTime}</dd></div>
              <div>
                <dt>Giờ mở cửa</dt>
                <dd>
                  {selectedOpening.label}
                  {selectedOpening.detail
                    ? " · " + selectedOpening.detail
                    : ""}
                </dd>
              </div>
            </dl>
            {selected.note ? <blockquote>“{selected.note}”</blockquote> : null}
          </section>
        </div>
          </>
        ) : (
          <div className="detail-empty-state">
            <span className="detail-empty-state__icon">⌖</span>
            <strong>
              {discoveryLoading
                ? "Đang tìm địa điểm thật…"
                : "Chọn một địa điểm trên bản đồ"}
            </strong>
            <span>
              ĐiĐâu lấy POI thật trong vùng đang nhìn. Pan/zoom bản đồ rồi bấm
              “Tìm khu vực này” nếu bạn muốn đổi khu vực.
            </span>
          </div>
        )}
      </aside>

      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button className="icon-button" type="button" onClick={() => setNotice(null)} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <dialog className="app-dialog app-dialog--compare" ref={compareDialogRef}>
        <div className="dialog-card compare-dialog-card">
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Chọn nhanh</span>
              <h2>So sánh shortlist</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => compareDialogRef.current?.close()}
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            So sánh tối đa 3 chỗ theo đúng context hiện tại. Shortlist chỉ sống
            trong phiên trình duyệt, không tạo thêm dữ liệu dài hạn.
          </p>

          <div
            className="compare-grid"
            style={{
              gridTemplateColumns:
                "repeat(" + Math.max(1, shortlistView.length) + ", minmax(0, 1fr))"
            }}
          >
            {shortlistView.map((place) => {
              const status = openingStatus(place.openUntil, clock);
              const rating = ratings[place.id];
              const cover = placeCovers[place.id];

              return (
                <article className="compare-card" key={place.id}>
                  <div
                    className={
                      "compare-card__hero" +
                      (cover ? " compare-card__hero--photo" : "")
                    }
                    style={{ "--place-accent": place.accent } as CSSProperties}
                  >
                    {cover ? (
                      <img src={cover} alt={"Ảnh " + place.name} />
                    ) : (
                      <span>{placeIcon(place)}</span>
                    )}
                    <b>{place.match}%</b>
                  </div>

                  <div className="compare-card__body">
                    <span className="eyebrow">
                      {place.kind}
                      {place.source === "provider"
                        ? place.providerId?.startsWith("geoapify:")
                          ? " · Geoapify"
                          : " · OSM"
                        : ""}
                    </span>
                    <h3>{place.name}</h3>

                    <dl>
                      <div>
                        <dt>Khoảng cách</dt>
                        <dd>{distanceLabel(place.distanceKm)}</dd>
                      </div>
                      <div>
                        <dt>Giá</dt>
                        <dd>{priceBadge(place)}</dd>
                      </div>
                      <div>
                        <dt>Mở cửa</dt>
                        <dd>
                          <span
                            className={
                              "opening-badge opening-badge--" + status.state
                            }
                          >
                            {status.label}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Rating</dt>
                        <dd>
                          {rating
                            ? "★ " + rating.stars.toFixed(1) + " của bạn"
                            : place.publicRating > 0
                              ? "★ " + place.publicRating.toFixed(1)
                              : "Chưa có"}
                        </dd>
                      </div>
                    </dl>

                    <p>
                      {place.recommendationReasons?.[0] ??
                        "Phù hợp với bối cảnh hiện tại"}
                    </p>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        setSelectedId(place.id);
                        compareDialogRef.current?.close();
                        mapRef.current?.flyTo({
                          center: [place.longitude, place.latitude],
                          zoom: 14,
                          duration: 650,
                          essential: true
                        });
                      }}
                    >
                      Chọn chỗ này
                    </button>
                    <button
                      type="button"
                      className="compare-card__remove"
                      onClick={() => toggleShortlist(place)}
                    >
                      Bỏ khỏi shortlist
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </dialog>

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
            Ghép các chặng gần nhau theo gu, budget, mood và dự báo thời tiết đúng giờ bạn định đi.
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
                  setPlanWeather(null);
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
                  setPlanWeather(null);
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
                  setPlanWeather(null);
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
                  setPlanWeather(null);
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
                  setPlanWeather(null);
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
            disabled={planWeatherLoading}
            onClick={() => void generatePlan(0)}
          >
            {planWeatherLoading ? "Đang xem dự báo…" : "Tạo kế hoạch"}
          </button>

          {planWeather ? (
            <div className="plan-weather-card">
              <span className="plan-weather-card__icon">
                {weatherEmoji(planWeather)}
              </span>
              <div>
                <span className="eyebrow">
                  Dự báo lúc {planStartTime}
                </span>
                <strong>
                  {weatherLabel(planWeather)} ·{" "}
                  {Math.round(planWeather.temperatureC)}°C
                </strong>
                <small>
                  {planWeather.precipitationProbability !== null
                    ? planWeather.precipitationProbability +
                      "% khả năng mưa"
                    : planWeather.precipitationMm > 0
                      ? planWeather.precipitationMm.toFixed(1) + " mm mưa"
                      : "Không có xác suất mưa"}
                  {" · "}Open-Meteo
                </small>
              </div>
            </div>
          ) : null}

          {activePlan ? (
            <div className="plan-result">
              <div className="plan-result__summary">
                <div>
                  <span className="eyebrow">Phương án đề xuất</span>
                  <strong>{activePlan.summary}</strong>
                </div>
                <b>{activePlan.averageMatch}%</b>
              </div>

              {!activePlan.complete ? (
                <div className="plan-warning">
                  Chưa ghép đủ mọi chặng trong khung bạn đặt. Thiếu:{" "}
                  {activePlan.missingStages
                    .map((stage) =>
                      stage === "food"
                        ? "Ăn uống"
                        : stage === "activity"
                          ? "Vui chơi"
                          : "Cafe / chill"
                    )
                    .join(", ")}
                  . App giữ phương án khả thi thay vì phá budget/thời lượng.
                </div>
              ) : !activePlan.withinBudget ? (
                <div className="plan-warning">
                  Không có phương án đủ chặng nằm hoàn toàn trong budget; đây là fallback gần nhất.
                </div>
              ) : null}

              {!activePlan.withinDuration ? (
                <div className="plan-warning">
                  Thời lượng ước tính vượt khung đã chọn. Hãy giảm bán kính hoặc đổi phương án.
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
                          {stop.startTime}–{stop.endTime} · {stop.stageLabel}
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
                            " · ~" +
                            stop.travelMinutesFromPrevious +
                            " phút di chuyển"
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
                  <small>
                    {activePlan.budgetRemainingForTwo >= 0
                      ? "Còn " + moneyLabel(activePlan.budgetRemainingForTwo)
                      : "Vượt " +
                        moneyLabel(Math.abs(activePlan.budgetRemainingForTwo))}
                  </small>
                </div>
                <div>
                  <span>Thời lượng</span>
                  <strong>
                    {Math.floor(activePlan.totalDurationMinutes / 60)}h{" "}
                    {activePlan.totalDurationMinutes % 60}p
                  </strong>
                  <small>
                    {activePlan.routeKm.toFixed(1)} km · leg xa nhất{" "}
                    {activePlan.maxLegKm.toFixed(1)} km
                  </small>
                </div>
              </div>

              <div className="plan-actions plan-actions--three">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={planWeatherLoading}
                  onClick={() => void generatePlan(planVariant + 1)}
                >
                  Đổi phương án
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={openPlanRoute}
                >
                  <LocationIcon /> Xem tuyến
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void startRunningPlan()}
                >
                  Bắt đầu plan
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </dialog>
    </main>
  );
}
