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
import {
  groupPollPlannerScenario,
  parseGroupPollPlanAnchor
} from "@/lib/group-poll-handoff";
import { personalApi } from "@/lib/personal-api";
import {
  costBadgeLabel,
  deriveProviderCostCalibration,
  priceLabelForCost
} from "@/lib/cost-estimation";
import {
  buildEveningPlan,
  derivePlannerCostProfile,
  estimateCostForTwo,
  plannerRoutingCandidates,
  suggestWhatNext,
  toActivePlanSnapshot
} from "@/lib/planner";
import { placeFromPoiResult, scenarioLabels } from "@/lib/places";
import { comparisonCost, comparisonHighlights, sortComparisonPlaces, type ComparisonSort } from "@/lib/comparison";
import { filterLibraryPlaces, librarySourceCounts, librarySourceOf, type LibrarySource } from "@/lib/place-library";
import { derivePlanOutcomeProfile } from "@/lib/plan-outcomes";
import { deriveDataRepairPrompts } from "@/lib/data-quality";
import { analyzePlanQuality } from "@/lib/plan-quality";
import { derivePlannerHealth } from "@/lib/planner-health";
import { openingStatus } from "@/lib/opening-hours";
import {
  deriveTasteProfile,
  tasteProfileSummary
} from "@/lib/taste";
import {
  filterPlaces,
  pickDailyDiscoveryPlace,
  pickSurprisePlace,
  recommendForCollection
} from "@/lib/search";
import type {
  ActivePersonalPlan,
  ActivePlanSnapshot,
  ActivePlanStopSnapshot,
  Collection,
  CompletedPersonalPlan,
  DailyDiscoveryRecord,
  EveningPlan,
  ItineraryShareSource,
  MapBounds,
  OwnedItineraryShare,
  PersonalBackup,
  PersonalRating,
  PlannerReplayTemplate,
  PlannerMetricsSummary,
  PlannerTravelMatrix,
  RecommendationFeedback,
  RecommendationFeedbackReason,
  ProviderPlaceDetails,
  RoutingMode,
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

// Collapse dense, nearby markers into one interactive cluster at lower zooms.
// The selected place is always shown separately, so it remains discoverable.
function groupVisibleMapPlaces(places: Place[], selectedId: string, map: MapLibreMap) {
  const zoom = map.getZoom();
  const cells = new Map<string, Place[]>();
  const radius = 76;

  for (const place of places) {
    const point = map.project([place.longitude, place.latitude]);
    const key =
      zoom >= 16 || place.id === selectedId
        ? "place:" + place.id
        : Math.floor(point.x / radius) + ":" + Math.floor(point.y / radius);
    const entries = cells.get(key) ?? [];
    entries.push(place);
    cells.set(key, entries);
  }

  return [...cells.values()].sort((a, b) => {
    const activeA = a.some((place) => place.id === selectedId);
    const activeB = b.some((place) => place.id === selectedId);
    return Number(activeA) - Number(activeB);
  });
}

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
  costSource: "unknown",
  costConfidence: 0,
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

const routingModeLabels: Record<RoutingMode, string> = {
  motorcycle: "Xe máy",
  drive: "Ô tô",
  walk: "Đi bộ"
};


type PersonalView = "discover" | "saved" | "history" | "collections" | "mine";

type ExcelRow = {
  row: number; name: string; area: string; mapsUrl: string; note: string; cost: string;
};
type ExcelCandidate = {
  id: string; name: string; address: string; latitude: number;
  longitude: number; mapsUrl: string; confidence: number;
  source: "geoapify" | "openstreetmap";
};
type ExcelPreviewRow = {
  row: ExcelRow; candidates: ExcelCandidate[]; error: string | null;
  needsRetry?: boolean;
};

async function excelApiResponse(response: Response) {
  const json: unknown = await response.json();
  if (!json || typeof json !== "object") throw new Error("Phản hồi máy chủ không hợp lệ.");
  const data = json as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Import Excel không thành công.");
  }
  return data;
}

const discoveryCategoryOptions: Array<{
  value: PoiDiscoveryFilters["category"];
  label: string;
}> = [
  { value: "all", label: "Tất cả loại" },
  { value: "food", label: "Ăn uống" },
  { value: "cafe", label: "Cafe" },
  { value: "drink", label: "Bar / Pub" },
  { value: "activity", label: "Vui chơi" },
  { value: "outdoor", label: "Đi dạo / Công viên" },
  { value: "culture", label: "Văn hóa / Bảo tàng" },
  { value: "sport", label: "Thể thao" },
  { value: "shopping", label: "Mua sắm" }
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

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function dailyPlaceKey(place: Place) {
  return place.providerId ?? place.id;
}

function dailyHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recentDailyDiscoveries(
  entries: ReadonlyArray<DailyDiscoveryRecord>,
  now: Date,
  days: number
) {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - Math.max(0, days - 1)
  );
  const minDay = localDateKey(start);
  const maxDay = localDateKey(now);

  return entries.filter(
    (item) => item.day >= minDay && item.day <= maxDay
  );
}

function mergeDailyDiscovery(
  current: ReadonlyArray<DailyDiscoveryRecord>,
  record: DailyDiscoveryRecord
) {
  return [
    record,
    ...current.filter(
      (item) =>
        !(item.day === record.day && item.kind === record.kind)
    )
  ]
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        b.updatedAt.localeCompare(a.updatedAt)
    )
    .slice(0, 60);
}

function suggestedDailyRouteStartTime(now: Date) {
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour < 18 || (hour === 18 && minute < 15)) {
    return "19:00";
  }

  if (hour < 22) {
    const target = new Date(now.getTime() + 60 * 60 * 1000);
    const roundedMinutes = Math.ceil(target.getMinutes() / 15) * 15;
    if (roundedMinutes >= 60) {
      target.setHours(target.getHours() + 1, 0, 0, 0);
    } else {
      target.setMinutes(roundedMinutes, 0, 0);
    }
    return (
      String(target.getHours()).padStart(2, "0") +
      ":" +
      String(target.getMinutes()).padStart(2, "0")
    );
  }

  return "19:00";
}

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

function priceText(
  place: Pick<
    Place,
    "priceLabel" | "averageForTwo" | "costSource" | "costConfidence"
  >
) {
  if (place.averageForTwo === "Chưa có dữ liệu") return "Chưa rõ";

  if (place.costSource === "provider_estimate") {
    return "Ước tính theo loại địa điểm";
  }

  if (place.priceLabel.length === 1) return "Tiết kiệm";
  if (place.priceLabel.length === 2) return "Vừa phải";
  return "Cao";
}

function priceBadge(
  place: Pick<Place, "priceLabel" | "averageForTwo" | "costSource">
) {
  return costBadgeLabel(place);
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
  if (place.kind.includes("Outdoor")) return "♧";
  if (place.kind.includes("Culture")) return "◆";
  if (place.kind.includes("Sport")) return "◎";
  if (place.kind.includes("Shopping")) return "▣";
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
  const [librarySource, setLibrarySource] = useState<LibrarySource>("all");
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(() => new Set());
  const [libraryTargetCollection, setLibraryTargetCollection] = useState("");
  const [libraryNewCollectionName, setLibraryNewCollectionName] = useState("");
  const [librarySaving, setLibrarySaving] = useState(false);

  const [providerResults, setProviderResults] = useState<PoiSearchResult[]>([]);
  const [discoveredPoiResults, setDiscoveredPoiResults] =
    useState<PoiSearchResult[]>([]);
  const [discoveryNextOffset, setDiscoveryNextOffset] =
    useState<number | null>(null);
  const [discoveryQueryBounds, setDiscoveryQueryBounds] =
    useState<MapBounds | null>(null);
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
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [placeCovers, setPlaceCovers] = useState<Record<string, string>>({});
  const [shortlist, setShortlist] = useState<Place[]>([]);
  const [dailyPlace, setDailyPlace] = useState<Place | null>(null);
  const [dailyDiscoveries, setDailyDiscoveries] =
    useState<DailyDiscoveryRecord[]>([]);
  const [completedPlans, setCompletedPlans] =
    useState<CompletedPersonalPlan[]>([]);
  const [itineraryShares, setItineraryShares] =
    useState<OwnedItineraryShare[]>([]);
  const [serverDistances, setServerDistances] = useState<Record<string, number>>({});
  const [backupLoading, setBackupLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelFileName, setExcelFileName] = useState("");
  const [excelPreview, setExcelPreview] = useState<ExcelPreviewRow[]>([]);
  const [excelSelected, setExcelSelected] = useState<Record<number, string>>({});
  const [excelImportResult, setExcelImportResult] = useState<string | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [groupPollLoading, setGroupPollLoading] = useState(false);
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>("match");
  const [profileTransferLoading, setProfileTransferLoading] = useState(false);
  const [profileTransferCode, setProfileTransferCode] = useState("");
  const [profileTransferExpiresAt, setProfileTransferExpiresAt] =
    useState<string | null>(null);
  const [profileTransferInput, setProfileTransferInput] = useState("");
  const [profileResetConfirm, setProfileResetConfirm] = useState("");
  const [profileResetLoading, setProfileResetLoading] = useState(false);
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
  const [planRoutingMode, setPlanRoutingMode] =
    useState<RoutingMode>("motorcycle");
  const [planVariant, setPlanVariant] = useState(0);
  const [planWeather, setPlanWeather] = useState<WeatherContext | null>(null);
  const [planWeatherLoading, setPlanWeatherLoading] = useState(false);
  const [planStartLoading, setPlanStartLoading] = useState(false);
  const [planReplayTemplate, setPlanReplayTemplate] =
    useState<PlannerReplayTemplate | null>(null);
  const [planAnchor, setPlanAnchor] = useState<Place | null>(null);
  const [plannerMetrics, setPlannerMetrics] =
    useState<PlannerMetricsSummary | null>(null);
  const [activePlan, setActivePlan] = useState<EveningPlan | null>(null);
  const [runningPlan, setRunningPlan] =
    useState<ActivePersonalPlan | null>(null);
  const [whatNextTravelMatrix, setWhatNextTravelMatrix] =
    useState<PlannerTravelMatrix | undefined>(undefined);

  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");
  const [mapReady, setMapReady] = useState(false);
  const [mapViewRevision, setMapViewRevision] = useState(0);
  const [mapPreviewId, setMapPreviewId] = useState<string | null>(null);
  const [mapTheme, setMapTheme] = useState<"streets" | "minimal">("streets");
  const [mapLoadError, setMapLoadError] = useState(false);
  const [mapFocus, setMapFocus] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"map" | "list">("map");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [ratingStars, setRatingStars] = useState(5);
  const [ratingRevisit, setRatingRevisit] =
    useState<RatingDraft["revisit"]>("yes");
  const [ratingContexts, setRatingContexts] = useState<Scenario[]>(["date"]);
  const [ratingNote, setRatingNote] = useState("");
  const [pendingPlanFeedbackId, setPendingPlanFeedbackId] =
    useState<string | null>(null);
  const [planOutcomeRating, setPlanOutcomeRating] = useState(5);
  const [planWouldRepeat, setPlanWouldRepeat] =
    useState<boolean | null>(true);
  const [planFeedbackNote, setPlanFeedbackNote] = useState("");

  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPrice, setEditPrice] = useState<Place["priceLabel"]>("$");
  const [editAverageForTwo, setEditAverageForTwo] = useState("");
  const [editBestTime, setEditBestTime] = useState("");
  const [editOpenUntil, setEditOpenUntil] = useState("");

  const [collectionEditingId, setCollectionEditingId] =
    useState<string | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");

  const planStartInFlightRef = useRef(false);
  const checkInInFlightRef = useRef(false);
  const pollHandoffHandledRef = useRef(false);
  const planAnchorDiscoveryStartedRef = useRef(false);
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);
  const excelDialogRef = useRef<HTMLDialogElement | null>(null);
  const editDialogRef = useRef<HTMLDialogElement | null>(null);
  const ratingDialogRef = useRef<HTMLDialogElement | null>(null);
  const planFeedbackDialogRef = useRef<HTMLDialogElement | null>(null);
  const collectionDialogRef = useRef<HTMLDialogElement | null>(null);
  const planDialogRef = useRef<HTMLDialogElement | null>(null);
  const dailyDialogRef = useRef<HTMLDialogElement | null>(null);
  const compareDialogRef = useRef<HTMLDialogElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const profileTransferDialogRef = useRef<HTMLDialogElement | null>(null);
  const shareManagerDialogRef = useRef<HTMLDialogElement | null>(null);
  const placePhotoInputRef = useRef<HTMLInputElement | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const [snapshot, activeResult, shareResult, metricsResult] =
        await Promise.all([
          personalApi.snapshot(),
          personalApi.activePlan.get(),
          personalApi.listItineraryShares(),
          personalApi.plannerMetrics
            .get()
            .catch(() => ({ metrics: null }))
        ]);
      setCustomPlaces(snapshot.customPlaces);
      setSaved(new Set(snapshot.savedIds));
      setRatings(snapshot.ratings);
      setRecommendationFeedbacks(snapshot.recommendationFeedbacks);
      setVisits(snapshot.visits);
      setCollections(snapshot.collections);
      setDailyDiscoveries(snapshot.dailyDiscoveries ?? []);
      setCompletedPlans(snapshot.completedPlans ?? []);
      setItineraryShares(shareResult.shares);
      if (metricsResult.metrics) {
        setPlannerMetrics(metricsResult.metrics);
      }
      if (snapshot.plannerDefaults) {
        setPlanRoutingMode(snapshot.plannerDefaults.routeMode);
        setPlanBudget(snapshot.plannerDefaults.budgetForTwo);
        setPlanDistance(snapshot.plannerDefaults.maxDistanceKm);
        setPlanDuration(snapshot.plannerDefaults.durationHours);
      }
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
    if (dataStatus !== "ready" || pollHandoffHandledRef.current) return;

    pollHandoffHandledRef.current = true;
    const anchor = parseGroupPollPlanAnchor(
      new URLSearchParams(window.location.search)
    );
    if (!anchor) return;

    setPlanAnchor(anchor);
    setView("discover");
    setScenario("all");
    setSelectedId(anchor.id);
    setPlanReplayTemplate(null);
    setPlanVariant(0);
    setPlanWeather(null);
    setActivePlan(null);
    setPlanScenario(groupPollPlannerScenario(anchor));
    setNotice(
      "Đã nhận lựa chọn từ poll · đang tìm thêm địa điểm quanh " +
        anchor.name +
        "."
    );

    planDialogRef.current?.showModal();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.hash
    );
  }, [dataStatus]);

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

  const providerCostCalibration = useMemo(
    () => deriveProviderCostCalibration(customPlaces),
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

  const discoveredPlaces = useMemo(
    () =>
      discoveredPoiResults
        .filter((item) => !importedProviderIds.has(item.providerId))
        .filter(
          (item) =>
            !discoveryFilters.openNow ||
            openingStatus(item.openingHours, clock).state === "open"
        )
        .map((item) =>
          placeFromPoiResult(item, providerCostCalibration)
        ),
    [
      discoveredPoiResults,
      importedProviderIds,
      discoveryFilters.openNow,
      clock,
      providerCostCalibration
    ]
  );

  const allPlaces = useMemo(() => {
    const base = [...customPlaces, ...discoveredPlaces];
    if (!planAnchor || base.some((place) => place.id === planAnchor.id)) {
      return base;
    }
    return [...base, planAnchor];
  }, [customPlaces, discoveredPlaces, planAnchor]);

  const plannerCostProfile = useMemo(
    () => derivePlannerCostProfile(customPlaces),
    [customPlaces]
  );

  const planOutcomeProfile = useMemo(
    () => derivePlanOutcomeProfile(completedPlans, clock.getTime()),
    [completedPlans, clock]
  );

  const activePlanQuality = useMemo(
    () => (activePlan ? analyzePlanQuality(activePlan) : null),
    [activePlan]
  );

  const plannerHealth = useMemo(
    () => (plannerMetrics ? derivePlannerHealth(plannerMetrics) : null),
    [plannerMetrics]
  );

  const dataRepairPrompts = useMemo(
    () =>
      deriveDataRepairPrompts(
        customPlaces,
        saved,
        completedPlans,
        clock.getTime()
      ),
    [customPlaces, saved, completedPlans, clock]
  );

  const activePlanRepairPrompts = useMemo(() => {
    if (!activePlan || !activePlanQuality || activePlanQuality.level === "high") {
      return [];
    }

    const ids = new Set(activePlan.stops.map((stop) => stop.place.id));
    return dataRepairPrompts
      .filter((item) => ids.has(item.placeId))
      .slice(0, 3);
  }, [activePlan, activePlanQuality, dataRepairPrompts]);

  const completedPlanQualityStats = useMemo(() => {
    const scored = completedPlans
      .map((item) => item.plan.quality?.score)
      .filter((score): score is number => typeof score === "number");

    if (scored.length === 0) {
      return { sampleSize: 0, average: null, lowCount: 0 };
    }

    return {
      sampleSize: scored.length,
      average: Math.round(
        scored.reduce((sum, score) => sum + score, 0) / scored.length
      ),
      lowCount: scored.filter((score) => score < 65).length
    };
  }, [completedPlans]);

  const recentDailyActivity = useMemo(
    () => recentDailyDiscoveries(dailyDiscoveries, clock, 7),
    [dailyDiscoveries, clock]
  );

  const dailyInsights = useMemo(() => {
    const days = new Set(
      recentDailyActivity.map((item) => item.day)
    ).size;
    const uniquePlaces = new Set(
      recentDailyActivity.flatMap((item) => item.placeKeys)
    ).size;
    const routes = recentDailyActivity.filter(
      (item) => item.kind === "route"
    ).length;

    return { days, uniquePlaces, routes };
  }, [recentDailyActivity]);

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
  const libraryCounts = useMemo(() => librarySourceCounts(customPlaces), [customPlaces]);
  const filteredLibraryIds = useMemo(
    () => new Set(filterLibraryPlaces(customPlaces, librarySource).map(place => place.id)),
    [customPlaces, librarySource]
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

  // When GPS is not enabled, the map search area's center is the only
  // meaningful distance reference. Do not present these as GPS distances.
  const searchAreaCenter = useMemo<UserLocation>(
    () => discoveryQueryBounds
      ? {
          latitude: (discoveryQueryBounds.north + discoveryQueryBounds.south) / 2,
          longitude: (discoveryQueryBounds.east + discoveryQueryBounds.west) / 2
        }
      : { latitude: defaultCenter[1], longitude: defaultCenter[0] },
    [discoveryQueryBounds]
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
        visits,
        planOutcomes: planOutcomeProfile
      },
      serverDistances,
      recommendationContext,
      tasteProfile,
      searchAreaCenter
    );

    const filtered = viewportBounds && view !== "mine"
      ? contextual.filter((place) => {
          if (customIds.has(place.id) && viewportPersonalIds) {
            return viewportPersonalIds.has(place.id);
          }
          return placeInsideBounds(place, viewportBounds);
        })
      : contextual;

    if (view === "mine") {
      return filtered.filter(place => filteredLibraryIds.has(place.id));
    }

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
    planOutcomeProfile,
    viewportBounds,
    viewportPersonalIds,
    customIds,
    tasteProfile,
    searchAreaCenter,
    filteredLibraryIds
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
        visits,
        planOutcomes: planOutcomeProfile
      },
        serverDistances,
        recommendationContext,
        tasteProfile,
        searchAreaCenter
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
      tasteProfile,
      planOutcomeProfile,
      searchAreaCenter
    ]
  );

  const weeklyFavoriteScenario = useMemo(() => {
    const counts = new Map<Scenario, number>();

    for (const item of recentDailyActivity) {
      if (item.kind !== "route" || !item.scenario) continue;
      counts.set(
        item.scenario,
        (counts.get(item.scenario) ?? 0) + 1
      );
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [recentDailyActivity]);

  const weeklyRevisitCandidate = useMemo(() => {
    const now = clock.getTime();
    const candidates: Array<{
      place: Place;
      daysSinceVisit: number;
      stars: number;
      score: number;
    }> = [];

    for (const place of rankedAll) {
      const rating = ratings[place.id];
      const visit = recentVisitByPlace.get(place.id);
      if (!rating || !visit) continue;
      if (rating.stars < 4 || rating.revisit === "no") continue;

      const visitedAt = new Date(visit.visitedAt).getTime();
      if (!Number.isFinite(visitedAt)) continue;

      const daysSinceVisit = Math.floor(
        Math.max(0, now - visitedAt) / (24 * 60 * 60 * 1000)
      );
      if (daysSinceVisit < 7) continue;

      const revisitBonus = rating.revisit === "yes" ? 14 : 4;
      candidates.push({
        place,
        daysSinceVisit,
        stars: rating.stars,
        score:
          place.match +
          rating.stars * 8 +
          revisitBonus +
          Math.min(20, daysSinceVisit / 2)
      });
    }

    return (
      candidates.sort(
        (a, b) =>
          b.score - a.score ||
          b.stars - a.stars ||
          b.daysSinceVisit - a.daysSinceVisit
      )[0] ?? null
    );
  }, [rankedAll, ratings, recentVisitByPlace, clock]);

  const collectionSuggestions = useMemo(() => {
    if (!selectedCollection) return [];
    return recommendForCollection(
      selectedCollection,
      rankedAll,
      {
        savedIds: saved,
        ratings,
        feedbacks: recommendationFeedbacks,
        visits,
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

  const comparisonPlaces = useMemo(
    () => sortComparisonPlaces(shortlistView, comparisonSort),
    [shortlistView, comparisonSort]
  );
  const comparisonWinners = useMemo(
    () => comparisonHighlights(shortlistView),
    [shortlistView]
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
  const mapPreviewPlace = mapPreviewId === selected.id && hasSelectedPlace ? selected : null;
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
  const dailyOpening = dailyPlace
    ? openingStatus(dailyPlace.openUntil, clock)
    : null;
  const dailyPlaceVisited = dailyPlace
    ? visits.some((visit) => visit.placeId === dailyPlace.id)
    : false;

  const selectedProviderCost =
    selected.costSource === "provider_estimate"
      ? estimateCostForTwo(selected)
      : null;
  const selectedCostChoices = useMemo(() => {
    if (selectedProviderCost === null) return [];

    const factors = [0.75, 1, 1.25];
    return Array.from(
      new Set(
        factors.map((factor) =>
          Math.max(
            20_000,
            Math.round((selectedProviderCost * factor) / 10_000) *
              10_000
          )
        )
      )
    );
  }, [selectedProviderCost]);

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

  const whatNextRoutingMode =
    runningPlan?.plan.routeMode ?? planRoutingMode;

  const whatNextHeuristicCandidates = useMemo(
    () =>
      selectedVisitedRecently
        ? suggestWhatNext({
            current: selected,
            places: rankedAll,
            signals: {
              savedIds: saved,
              ratings,
              feedbacks: recommendationFeedbacks,
              visits,
              costProfile: plannerCostProfile,
              planOutcomes: planOutcomeProfile
            },
            maxDistanceKm: 4,
            limit: 4,
            localHour: recommendationContext.localHour,
            routeMode: whatNextRoutingMode
          })
        : [],
    [
      selectedVisitedRecently,
      selected,
      rankedAll,
      saved,
      ratings,
      recommendationFeedbacks,
      visits,
      plannerCostProfile,
      planOutcomeProfile,
      recommendationContext.localHour,
      whatNextRoutingMode
    ]
  );

  useEffect(() => {
    let active = true;
    setWhatNextTravelMatrix(undefined);

    if (
      !selectedVisitedRecently ||
      !selected.id ||
      whatNextHeuristicCandidates.length === 0
    ) {
      return () => {
        active = false;
      };
    }

    const candidates = whatNextHeuristicCandidates.slice(0, 4);

    void personalApi
      .routeMatrix(
        [
          {
            key: selected.id,
            latitude: selected.latitude,
            longitude: selected.longitude
          },
          ...candidates.map((item) => ({
            key: item.place.id,
            latitude: item.place.latitude,
            longitude: item.place.longitude
          }))
        ],
        whatNextRoutingMode
      )
      .then((result) => {
        if (active) {
          setWhatNextTravelMatrix(result.matrix ?? undefined);
        }
      })
      .catch(() => {
        if (active) setWhatNextTravelMatrix(undefined);
      });

    return () => {
      active = false;
    };
  }, [
    selectedVisitedRecently,
    selected.id,
    selected.latitude,
    selected.longitude,
    whatNextHeuristicCandidates,
    whatNextRoutingMode
  ]);

  const whatNextSuggestions = useMemo(() => {
    const generic = selectedVisitedRecently
      ? suggestWhatNext({
          current: selected,
          places: rankedAll,
          signals: {
            savedIds: saved,
            ratings,
            feedbacks: recommendationFeedbacks,
            visits,
            costProfile: plannerCostProfile,
            planOutcomes: planOutcomeProfile
          },
          maxDistanceKm: 4,
          limit: 3,
          localHour: recommendationContext.localHour,
          travelMatrix: whatNextTravelMatrix,
          routeMode: whatNextRoutingMode
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
      travelSource: undefined,
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
    runningNextStop,
    plannerCostProfile,
    planOutcomeProfile,
    whatNextTravelMatrix,
    whatNextRoutingMode
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
        style: {
          version: 8,
          sources: {
            streets: {
              type: "raster",
              tiles: ["/api/map/tiles/{z}/{x}/{y}?style=osm-bright"],
              tileSize: 256,
              attribution: "Powered by Geoapify | © OpenStreetMap contributors | © OpenMapTiles"
            }
          },
          layers: [{ id: "streets", type: "raster", source: "streets" }]
        },
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

      map.on("moveend", () => {
        if (active) setMapViewRevision((revision) => revision + 1);
      });

      map.on("load", () => {
        if (active) {
          setMapReady(true);
          setMapLoadError(false);
        }
      });

      map.on("error", (event) => {
        if (active) {
          console.error("[di-dau] Map tile or style failed to load", event.error);
          setMapLoadError(true);
        }
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
    const map = mapRef.current;
    let disposed = false;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || mapRef.current !== map) return;

      const groups = groupVisibleMapPlaces(visiblePlaces, selectedId, map);
      for (const places of groups) {
        const selectedPlace = places.find((place) => place.id === selectedId);
        const place = selectedPlace ?? places[0];
        if (!place) continue;

        const element = document.createElement("button");
        element.type = "button";
        element.className = "map-marker" +
          (places.length > 1 ? " map-marker--cluster" : "") +
          (selectedPlace ? " map-marker--active" : "");
        element.style.setProperty("--marker-accent", place.accent);

        if (places.length > 1) {
          element.textContent = String(places.length);
          element.setAttribute("aria-label", places.length + " địa điểm gần nhau. Nhấn để phóng to");
          element.title = places.length + " địa điểm · Nhấn để xem gần hơn";
          element.addEventListener("click", () => {
            const lng = places.reduce((sum, item) => sum + item.longitude, 0) / places.length;
            const lat = places.reduce((sum, item) => sum + item.latitude, 0) / places.length;
            map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 17), duration: 450 });
          });
        } else {
          const score = document.createElement("span");
          score.className = "map-marker__score";
          score.textContent = place.match + "%";
          element.append(score);
          if (selectedPlace) {
            const label = document.createElement("span");
            label.className = "map-marker__name";
            label.textContent = place.name;
            element.append(label);
          }
          element.setAttribute("aria-label", "Mở " + place.name);
          element.title = place.name;
          element.addEventListener("click", () => {
            setSelectedId(place.id);
            setMapPreviewId(place.id);
          });
        }

        const longitude = places.reduce((sum, item) => sum + item.longitude, 0) / places.length;
        const latitude = places.reduce((sum, item) => sum + item.latitude, 0) / places.length;
        const marker = new maplibre.Marker({ element, anchor: "bottom" })
          .setLngLat([longitude, latitude])
          .addTo(map);
        markerRefs.current.push(marker);
      }

      if (userLocation) {
        const dot = document.createElement("div");
        dot.className = "map-user-dot";
        dot.setAttribute("aria-label", "Vị trí hiện tại");
        markerRefs.current.push(
          new maplibre.Marker({ element: dot })
            .setLngLat([userLocation.longitude, userLocation.latitude])
            .addTo(map)
        );
      }
    });

    return () => {
      disposed = true;
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
    };
  }, [mapReady, mapViewRevision, visiblePlaces, selectedId, userLocation]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const mapSource = mapRef.current.getSource("streets") as
      | { setTiles: (tiles: string[]) => void }
      | undefined;
    mapSource?.setTiles([
      "/api/map/tiles/{z}/{x}/{y}?style=" +
        (mapTheme === "streets" ? "osm-bright" : "positron")
    ]);
  }, [mapTheme, mapReady]);

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

  async function createGroupPollFromShortlist() {
    if (shortlist.length < 2 || groupPollLoading) {
      if (shortlist.length < 2) {
        setNotice("Chọn ít nhất 2 địa điểm để tạo poll nhóm.");
      }
      return;
    }

    setGroupPollLoading(true);
    try {
      const { poll } = await personalApi.createGroupPoll(
        shortlist,
        "Cả nhóm đi đâu?"
      );
      const url = window.location.origin + "/g/" + poll.slug;

      try {
        await navigator.clipboard.writeText(url);
        setNotice("Đã tạo poll 24 giờ và copy link vào clipboard.");
      } catch {
        setNotice("Đã tạo poll 24 giờ. Link đã mở ở tab mới.");
      }

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể tạo phiên bình chọn nhóm."
      );
    } finally {
      setGroupPollLoading(false);
    }
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
    announce = false,
    append = false
  ) {
    if (append && discoveryNextOffset === null) return;

    setDiscoveryLoading(true);
    try {
      const offset = append ? discoveryNextOffset ?? 0 : 0;
      const result = await personalApi.discoverPoi(
        bounds,
        discoveryFilters,
        offset
      );

      setDiscoveredPoiResults((current) => {
        if (!append) return result.results;

        const merged = new Map(
          current.map((item) => [item.providerId, item])
        );
        for (const item of result.results) {
          merged.set(item.providerId, item);
        }
        return Array.from(merged.values());
      });
      setDiscoveryNextOffset(result.nextOffset);
      if (!append) setDiscoveryQueryBounds(bounds);

      if (announce) {
        setNotice(
          result.results.length > 0
            ? append
              ? "Đã nạp thêm " +
                result.results.length +
                " địa điểm."
              : "Đã tìm " +
                result.results.length +
                " địa điểm thật trong vùng."
            : append
              ? "Không còn địa điểm mới trong vùng này."
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

  async function loadMoreDiscovery() {
    if (!discoveryQueryBounds || discoveryNextOffset === null) {
      return;
    }
    await refreshDiscovery(discoveryQueryBounds, true, true);
  }

  // MapLibre must recalculate its canvas when sidebars or mobile sheets move.
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const frame = window.requestAnimationFrame(() => map.resize());
    const delayed = window.setTimeout(() => map.resize(), 280);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
    };
  }, [mapFocus, mobilePanel]);

  function switchView(next: PersonalView) {
    setView(next);
    setMobilePanel(next === "discover" ? "map" : "list");
    setMapFocus(false);
    setLibrarySelectedIds(new Set());
    setQuery("");
    setScenario("all");
    setProviderResults([]);
    if (next === "collections" && !selectedCollectionId && collections[0]) {
      setSelectedCollectionId(collections[0].id);
    }
  }

  function toggleLibrarySelection(placeId: string) {
    setLibrarySelectedIds(current => {
      const next = new Set(current);
      if (next.has(placeId)) next.delete(placeId);
      else if (next.size < 20) next.add(placeId);
      else setNotice("Chỉ chọn tối đa 20 địa điểm mỗi lượt.");
      return next;
    });
  }

  function selectVisibleLibraryPlaces() {
    setLibrarySelectedIds(new Set(visiblePlaces.slice(0, 20).map(place => place.id)));
  }

  async function addLibrarySelectionToCollection() {
    if (librarySaving) return;
    const ids = [...librarySelectedIds].filter(id => customIds.has(id));
    if (ids.length === 0) {
      setNotice("Chọn địa điểm trong thư viện trước.");
      return;
    }
    const newName = cleanPlainText(libraryNewCollectionName, 60);
    if (!newName && !libraryTargetCollection) {
      setNotice("Chọn một bộ sưu tập hoặc nhập tên bộ sưu tập mới.");
      return;
    }
    setLibrarySaving(true);
    let added = 0;
    try {
      const target = newName
        ? await personalApi.createCollection({
            name: newName,
            description: "Danh sách địa điểm từ thư viện ĐiĐâu"
          })
        : collections.find(collection => collection.id === libraryTargetCollection);
      if (!target) throw new Error("Bộ sưu tập đã chọn không còn tồn tại.");
      const alreadyIncluded = new Set(target.placeIds);
      const pending = ids.filter(id => !alreadyIncluded.has(id));
      let failure: string | null = null;
      for (const id of pending) {
        try {
          await personalApi.setCollectionPlace(target.id, id, true);
          added += 1;
        } catch (error) {
          failure = error instanceof Error ? error.message : "Có địa điểm không thể lưu.";
          break;
        }
      }
      await loadSnapshot();
      setLibrarySelectedIds(new Set());
      setLibraryNewCollectionName("");
      setLibraryTargetCollection(target.id);
      setSelectedCollectionId(target.id);
      if (failure) {
        setNotice("Đã thêm " + added + "/" + pending.length + " địa điểm. " + failure);
      } else {
        setQuery("");
        setScenario("all");
        setViewportBounds(null);
        setViewportPersonalIds(null);
        setView("collections");
        setNotice("Đã thêm " + added + " địa điểm vào “" + target.name + "”" +
          (pending.length === 0 ? " (tất cả đã có sẵn)." : "."));
      }
    } catch (error) {
      await loadSnapshot().catch(() => undefined);
      setNotice((error instanceof Error ? error.message : "Không thể lưu bộ sưu tập.") +
        (added > 0 ? " Đã lưu được " + added + " địa điểm." : ""));
    } finally {
      setLibrarySaving(false);
    }
  }

  function shortlistFromLibrary() {
    const places = customPlaces.filter(place => librarySelectedIds.has(place.id));
    if (places.length < 2 || places.length > 3) {
      setNotice("Chọn 2 hoặc 3 địa điểm để so sánh.");
      return;
    }
    setShortlist(places);
    compareDialogRef.current?.showModal();
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
        personalApi.discoverPoi(bounds, discoveryFilters, 0),
        refreshWeather({
          latitude: center.lat,
          longitude: center.lng
        })
      ]);

      setViewportPersonalIds(
        new Set(viewportResult.results.map((item) => item.placeId))
      );
      setDiscoveredPoiResults(discoveryResult.results);
      setDiscoveryNextOffset(discoveryResult.nextOffset);
      setDiscoveryQueryBounds(bounds);

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

  useEffect(() => {
    if (
      !mapReady ||
      !mapRef.current ||
      !planAnchor ||
      planAnchorDiscoveryStartedRef.current
    ) {
      return;
    }

    planAnchorDiscoveryStartedRef.current = true;
    mapRef.current.flyTo({
      center: [planAnchor.longitude, planAnchor.latitude],
      zoom: 14,
      duration: 650,
      essential: true
    });
    mapRef.current.once("moveend", () => {
      void searchCurrentArea();
    });
  }, [mapReady, planAnchor]);

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

  async function openDailyDiscovery() {
    const today = localDateKey(clock);
    const todaysEntry = dailyDiscoveries.find(
      (item) => item.kind === "place" && item.day === today
    );

    const cafeOrFood = rankedAll.filter(
      (place) =>
        place.scenarios.includes("coffee") ||
        place.scenarios.includes("food") ||
        /cafe|coffee|restaurant|bar/i.test(place.kind)
    );
    const source = cafeOrFood.length >= 3 ? cafeOrFood : rankedAll;

    let picked: Place | null = todaysEntry
      ? source.find((place) =>
          todaysEntry.placeKeys.includes(dailyPlaceKey(place))
        ) ?? null
      : null;

    if (!picked) {
      const avoidPlaceKeys = new Set(
        dailyDiscoveries
          .filter(
            (item) =>
              item.kind === "place" && item.day !== today
          )
          .slice(0, 14)
          .flatMap((item) => item.placeKeys)
      );

      picked = pickDailyDiscoveryPlace(
        source,
        {
          savedIds: saved,
          ratings,
          feedbacks: recommendationFeedbacks,
          visits
        },
        {
          seed: today + ":place",
          avoidPlaceKeys
        }
      );

      if (picked) {
        try {
          const record = await personalApi.saveDailyDiscovery({
            day: today,
            kind: "place",
            placeKeys: [dailyPlaceKey(picked)],
            scenario: null
          });
          setDailyDiscoveries((current) =>
            mergeDailyDiscovery(current, record)
          );
        } catch {
          setNotice(
            "Đã chọn quán hôm nay nhưng chưa đồng bộ được lịch sử chống lặp."
          );
        }
      }
    }

    setDailyPlace(picked);
    dailyDialogRef.current?.showModal();
  }

  function focusDailyPlace() {
    if (!dailyPlace) return;

    setSelectedId(dailyPlace.id);
    mapRef.current?.flyTo({
      center: [dailyPlace.longitude, dailyPlace.latitude],
      zoom: 14,
      duration: 700,
      essential: true
    });
    dailyDialogRef.current?.close();

    const reason =
      dailyPlace.recommendationReasons?.[0] ??
      "ưu tiên một nơi mới hợp gu của bạn";
    setNotice("☀ Quán hôm nay · " + dailyPlace.name + " · " + reason);
  }

  async function openDailyRoute() {
    const today = localDateKey(clock);
    const seed = dailyHash(today + ":route");
    const dailyScenarios: Scenario[] = [
      "date",
      "friends",
      "food",
      "coffee",
      "fun",
      "chill"
    ];
    const routeScenario =
      scenario === "all"
        ? dailyScenarios[seed % dailyScenarios.length]!
        : scenario;
    const routeStartTime = suggestedDailyRouteStartTime(clock);
    const variant = seed % 10_000;
    const recentRouteKeys = new Set(
      recentDailyDiscoveries(dailyDiscoveries, clock, 7)
        .filter(
          (item) =>
            item.kind === "route" && item.day !== today
        )
        .flatMap((item) => item.placeKeys)
    );

    setPlanScenario(routeScenario);
    setPlanStartTime(routeStartTime);
    setPlanVariant(variant);
    setPlanWeather(null);
    setActivePlan(null);

    dailyDialogRef.current?.close();
    planDialogRef.current?.showModal();

    const result = await generatePlan(
      variant,
      routeScenario,
      routeStartTime,
      recentRouteKeys,
      null,
      "generated_initial"
    );

    if (!result || result.stops.length === 0) return;

    try {
      const record = await personalApi.saveDailyDiscovery({
        day: today,
        kind: "route",
        placeKeys: result.stops
          .map((stop) => dailyPlaceKey(stop.place))
          .slice(0, 3),
        scenario: routeScenario
      });
      setDailyDiscoveries((current) =>
        mergeDailyDiscovery(current, record)
      );
    } catch {
      setNotice(
        "Route đã tạo nhưng chưa lưu được lịch sử chống lặp."
      );
    }
  }

  function focusWeeklyRevisit() {
    if (!weeklyRevisitCandidate) return;

    const place = weeklyRevisitCandidate.place;
    setSelectedId(place.id);
    mapRef.current?.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 14,
      duration: 700,
      essential: true
    });
    dailyDialogRef.current?.close();
    setNotice(
      "↻ Gợi ý quay lại · " +
        place.name +
        " · bạn từng chấm " +
        weeklyRevisitCandidate.stars +
        "/5."
    );
  }

  async function persistPlannerDefaults(input: {
    routeMode?: RoutingMode;
    budgetForTwo?: number;
    maxDistanceKm?: 3 | 5 | 8 | 12;
    durationHours?: 2 | 3 | 4;
  }) {
    const next = {
      routeMode: input.routeMode ?? planRoutingMode,
      budgetForTwo: input.budgetForTwo ?? planBudget,
      maxDistanceKm:
        input.maxDistanceKm ??
        (planDistance as 3 | 5 | 8 | 12),
      durationHours: input.durationHours ?? planDuration
    };

    try {
      await personalApi.savePlannerDefaults(next);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể lưu thiết lập planner."
      );
    }
  }

  function plannerOrigin(): UserLocation {
    if (planAnchor) {
      return {
        latitude: planAnchor.latitude,
        longitude: planAnchor.longitude
      };
    }
    if (userLocation) return userLocation;
    const center = mapRef.current?.getCenter();
    return center
      ? { latitude: center.lat, longitude: center.lng }
      : { latitude: defaultCenter[1], longitude: defaultCenter[0] };
  }

  async function generatePlan(
    nextVariant = planVariant,
    scenarioOverride: Scenario = planScenario,
    startTimeOverride = planStartTime,
    avoidPlaceKeys?: ReadonlySet<string>,
    replayTemplateOverride?: PlannerReplayTemplate | null,
    telemetryKind: "generated_initial" | "rerolled" =
      nextVariant === 0 ? "generated_initial" : "rerolled"
  ) {
    const replayTemplate =
      replayTemplateOverride === undefined
        ? planReplayTemplate
        : replayTemplateOverride;
    const origin = plannerOrigin();
    const targetAt = nextPlanStartAt(startTimeOverride, clock);
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
        visits,
        planOutcomes: planOutcomeProfile
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

    const preferredSource =
      avoidPlaceKeys && avoidPlaceKeys.size > 0
        ? source.filter(
            (place) => !avoidPlaceKeys.has(dailyPlaceKey(place))
          )
        : source;

    const preferences = {
      scenario: scenarioOverride,
      routeMode: planRoutingMode,
      budgetForTwo: planBudget,
      maxDistanceKm: planDistance,
      durationHours: planDuration,
      startTime: startTimeOverride,
      startAt: targetAt.toISOString()
    } as const;

    let travelMatrix: PlannerTravelMatrix | undefined;
    const routingSource =
      preferredSource.length > 0 ? preferredSource : source;
    let routingCandidates = plannerRoutingCandidates(
      routingSource,
      preferences,
      6,
      replayTemplate
    );
    if (planAnchor) {
      const anchorCandidate = routingSource.find(
        (place) => place.id === planAnchor.id
      );
      if (
        anchorCandidate &&
        !routingCandidates.some((place) => place.id === anchorCandidate.id)
      ) {
        routingCandidates = [
          anchorCandidate,
          ...routingCandidates
        ].slice(0, 6);
      }
    }

    if (routingCandidates.length > 0) {
      try {
        const routing = await personalApi.routeMatrix(
          [
            {
              key: "__origin__",
              latitude: origin.latitude,
              longitude: origin.longitude
            },
            ...routingCandidates.map((place) => ({
              key: place.id,
              latitude: place.latitude,
              longitude: place.longitude
            }))
          ],
          planRoutingMode
        );
        travelMatrix = routing.matrix ?? undefined;
      } catch {
        travelMatrix = undefined;
      }
    }

    const build = (places: Place[]) =>
      buildEveningPlan({
        places,
        preferences,
        signals: {
          savedIds: saved,
          ratings,
          feedbacks: recommendationFeedbacks,
          visits,
          costProfile: plannerCostProfile,
          planOutcomes: planOutcomeProfile
        },
        origin,
        variant: nextVariant,
        travelMatrix,
        replayTemplate,
        anchorPlaceId: planAnchor?.id ?? null
      });

    let result = build(preferredSource);

    if (
      preferredSource.length < source.length &&
      (!result || !result.complete)
    ) {
      const relaxedNoveltyResult = build(source);
      if (
        !result ||
        (relaxedNoveltyResult &&
          relaxedNoveltyResult.stops.length > result.stops.length)
      ) {
        result = relaxedNoveltyResult;
      }
    }

    setPlanWeatherLoading(false);
    setPlanVariant(nextVariant);
    setActivePlan(result);

    if (
      result &&
      planAnchor &&
      !result.stops.some((stop) => stop.place.id === planAnchor.id)
    ) {
      setNotice(
        "Mốc nhóm không vượt qua guardrail hiện tại (giờ mở cửa, khoảng cách, budget hoặc thời lượng), nên planner không ép chèn vào route."
      );
    }

    if (result) {
      void personalApi.plannerMetrics
        .recordGeneration(telemetryKind)
        .then(({ metrics }) => setPlannerMetrics(metrics))
        .catch(() => undefined);
    }

    if (!result) {
      void personalApi.plannerMetrics
        .recordGeneration("generation_failed")
        .then(({ metrics }) => setPlannerMetrics(metrics))
        .catch(() => undefined);
      setNotice(
        "Chưa đủ địa điểm phù hợp. Thử tăng bán kính hoặc đổi mood."
      );
    }

    return result;
  }

  function openPlanBuilder() {
    setPlanReplayTemplate(null);
    setPlanScenario(scenario === "all" ? "date" : scenario);
    setPlanVariant(0);
    setPlanWeather(null);
    setPlanWeatherLoading(false);
    setActivePlan(null);
    planDialogRef.current?.showModal();
  }

  function openPlanRoute() {
    if (!activePlan || activePlan.stops.length === 0) return;

    const mapsTravelMode =
      activePlan.routeMode === "walk" ? "walking" : "driving";

    if (activePlan.stops.length === 1) {
      const only = activePlan.stops[0]!.place;
      const url = userLocation
        ? "https://www.google.com/maps/dir/?api=1&origin=" +
          encodeURIComponent(
            userLocation.latitude + "," + userLocation.longitude
          ) +
          "&destination=" +
          encodeURIComponent(only.latitude + "," + only.longitude) +
          "&travelmode=" + mapsTravelMode
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
      travelmode: mapsTravelMode
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
    const mapsTravelMode =
      runningPlan?.plan.routeMode === "walk"
        ? "walking"
        : "driving";
    const params = new URLSearchParams({
      api: "1",
      destination: stop.latitude + "," + stop.longitude,
      travelmode: mapsTravelMode
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
    if (!activePlan || planStartInFlightRef.current) return;

    if (
      runningPlan &&
      !window.confirm(
        "Bạn đang có một plan đang đi. Thay bằng phương án mới?"
      )
    ) {
      return;
    }

    planStartInFlightRef.current = true;
    setPlanStartLoading(true);

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
        toActivePlanSnapshot(persistedPlan),
        Boolean(activePlan.replay)
      );
      setRunningPlan(result.activePlan);
      void personalApi.plannerMetrics
        .get()
        .then(({ metrics }) => setPlannerMetrics(metrics))
        .catch(() => undefined);
      planDialogRef.current?.close();

      const first = result.activePlan.plan.stops[0];
      if (first) focusRunningStop(first);

      setNotice(
        result.created
          ? "Đã bắt đầu plan · " +
              result.activePlan.plan.stops.length +
              " chặng."
          : "Plan này đã được bắt đầu trước đó · đã đồng bộ lại."
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể bắt đầu kế hoạch."
      );
    } finally {
      planStartInFlightRef.current = false;
      setPlanStartLoading(false);
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

      if (result.recordedVisit || result.finished) {
        await loadSnapshot();
      }

      if (result.finished) {
        const finishedPlanId = runningPlan.id;
        setPendingPlanFeedbackId(finishedPlanId);
        setPlanOutcomeRating(5);
        setPlanWouldRepeat(true);
        setPlanFeedbackNote("");
        setNotice(
          action === "complete"
            ? "Đã hoàn thành plan. Cho ĐiĐâu biết buổi này có thực sự ổn không nhé."
            : "Plan đã kết thúc. Feedback cuối buổi giúp planner học chính xác hơn."
        );
        window.setTimeout(
          () => planFeedbackDialogRef.current?.showModal(),
          0
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

  async function submitPlanFeedback(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!pendingPlanFeedbackId) return;

    try {
      const result = await personalApi.saveCompletedPlanFeedback(
        pendingPlanFeedbackId,
        {
          outcomeRating: planOutcomeRating,
          wouldRepeat: planWouldRepeat,
          feedbackNote: cleanPlainText(planFeedbackNote, 300)
        }
      );

      setCompletedPlans((current) => [
        result.completedPlan,
        ...current.filter(
          (item) => item.id !== result.completedPlan.id
        )
      ]);
      setPendingPlanFeedbackId(null);
      planFeedbackDialogRef.current?.close();
      setNotice(
        "Đã ghi nhận cảm nhận về buổi đi. Outcome learning sẽ dùng tín hiệu này ở mức nhẹ."
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể lưu đánh giá buổi đi."
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

    if (
      planAnchor &&
      place.id === planAnchor.id &&
      (place.source !== "provider" || !place.providerId)
    ) {
      const created = await personalApi.createPlace({
        ...place,
        source: "personal",
        providerId: undefined
      });
      setPlanAnchor(created);
      return created;
    }

    if (place.source !== "provider" || !place.providerId) {
      throw new Error("Địa điểm này chưa thể lưu tự động.");
    }

    const imported = await personalApi.importProviderPlace(place);
    if (selected.id === place.id) {
      setSelectedId(imported.place.id);
    }
    return imported.place;
  }

  async function confirmSelectedCost(amountForTwo: number) {
    if (!hasSelectedPlace) return;

    try {
      const target = await persistProviderPlace(selected);
      const updated: Place = {
        ...target,
        averageForTwo: moneyLabel(amountForTwo),
        priceLabel: priceLabelForCost(amountForTwo),
        costSource: "user",
        costConfidence: 100
      };

      await personalApi.updatePlace(target.id, updated);
      await loadSnapshot();
      setSelectedId(target.id);
      setNotice(
        "Đã ghi nhận chi phí thực tế ~" +
          moneyLabel(amountForTwo) +
          " cho 2 người."
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể cập nhật chi phí."
      );
    }
  }

  async function importPoi(result: PoiSearchResult) {
    try {
      const imported = await personalApi.importPoi(
        result,
        providerCostCalibration
      );
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

  async function createProfileTransfer() {
    setProfileTransferLoading(true);
    try {
      const result = await personalApi.profileTransfer.create();
      setProfileTransferCode(result.code);
      setProfileTransferExpiresAt(result.expiresAt);
      setNotice("Đã tạo mã chuyển profile dùng một lần.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể tạo mã chuyển profile."
      );
    } finally {
      setProfileTransferLoading(false);
    }
  }

  async function redeemProfileTransfer() {
    const code = profileTransferInput.trim();
    if (!code) {
      setNotice("Nhập mã chuyển profile trước.");
      return;
    }

    setProfileTransferLoading(true);
    try {
      await personalApi.profileTransfer.redeem(code);
      setNotice("Đã chuyển profile. Đang tải lại dữ liệu…");
      window.location.reload();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể dùng mã chuyển profile."
      );
    } finally {
      setProfileTransferLoading(false);
    }
  }

  async function resetCurrentProfile() {
    if (profileResetConfirm.trim().toUpperCase() !== "XOA") {
      setNotice("Nhập XOA để xác nhận reset profile.");
      return;
    }

    if (
      !window.confirm(
        "Xóa vĩnh viễn toàn bộ dữ liệu profile này? Places, lịch sử, plan, ảnh, link chia sẻ và metrics đều sẽ bị xóa."
      )
    ) {
      return;
    }

    setProfileResetLoading(true);
    try {
      const result = await personalApi.resetProfile();
      window.sessionStorage.removeItem("di-dau-shortlist");
      setNotice(
        "Đã xóa profile" +
          (result.removedPhotoObjects > 0
            ? " và " + result.removedPhotoObjects + " ảnh."
            : ".") +
          " Đang tạo profile mới…"
      );
      window.location.reload();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể reset profile."
      );
    } finally {
      setProfileResetLoading(false);
    }
  }

  async function sharePlanSnapshot(
    plan: ActivePlanSnapshot,
    sourceKind: ItineraryShareSource,
    sourcePlanId?: string | null
  ) {
    setShareLoading(true);

    try {
      const result = await personalApi.createItineraryShare({
        plan,
        sourceKind,
        sourcePlanId
      });
      const shareResult = await personalApi.listItineraryShares();
      setItineraryShares(shareResult.shares);
      const url = new URL(
        "/s/" + result.share.slug,
        window.location.origin
      ).toString();
      const title =
        (plan.scenario ? scenarioLabels[plan.scenario] : "Itinerary") +
        " · ĐiĐâu";

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title,
            text: plan.summary,
            url
          });
          setNotice("Đã mở chia sẻ itinerary.");
          return;
        } catch (error) {
          if (
            error instanceof DOMException &&
            error.name === "AbortError"
          ) {
            return;
          }
        }
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setNotice("Đã copy link itinerary.");
      } else {
        window.prompt("Copy link itinerary:", url);
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể tạo link chia sẻ itinerary."
      );
    } finally {
      setShareLoading(false);
    }
  }

  function itineraryShareUrl(slug: string) {
    return new URL("/s/" + slug, window.location.origin).toString();
  }

  async function copyItineraryShare(slug: string) {
    const url = itineraryShareUrl(slug);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setNotice("Đã copy link itinerary.");
      } else {
        window.prompt("Copy link itinerary:", url);
      }
    } catch {
      window.prompt("Copy link itinerary:", url);
    }
  }

  async function revokeOwnedItineraryShare(slug: string) {
    if (!window.confirm("Thu hồi link này? Người có link sẽ không mở được nữa.")) {
      return;
    }

    setShareLoading(true);
    try {
      await personalApi.revokeItineraryShare(slug);
      setItineraryShares((current) =>
        current.filter((item) => item.slug !== slug)
      );
      setNotice("Đã thu hồi link itinerary.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể thu hồi link itinerary."
      );
    } finally {
      setShareLoading(false);
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
          " bộ sưu tập, " +
          result.dailyDiscoveries +
          " bản ghi khám phá, " +
          result.completedPlans +
          " plan đã hoàn thành."
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
      setMapPreviewId(target.id);
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
    if (!hasSelectedPlace || checkInInFlightRef.current) return;

    checkInInFlightRef.current = true;
    setCheckInLoading(true);

    try {
      const target = await persistProviderPlace(selected);
      const result = await personalApi.checkIn(target.id);
      await loadSnapshot();
      setSelectedId(target.id);

      if (!result.created) {
        setNotice(
          "Bạn đã check-in địa điểm này trong 2 giờ gần nhất · không tạo bản ghi trùng."
        );
        return;
      }

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
        visits,
        costProfile: plannerCostProfile
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
    } finally {
      checkInInFlightRef.current = false;
      setCheckInLoading(false);
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

  function openExcelDialog() {
    addDialogRef.current?.close();
    setExcelError(null);
    excelDialogRef.current?.showModal();
  }

  async function previewExcelFile(file: File) {
    if (!/\.xlsx$/i.test(file.name) || file.size > 1024 * 1024) {
      setExcelError("Chỉ nhận file .xlsx dưới 1 MB.");
      return;
    }
    setExcelLoading(true);
    setExcelError(null);
    setExcelImportResult(null);
    setExcelPreview([]);
    setExcelSelected({});
    setExcelFileName(file.name);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/personal/import-excel", {
        method: "POST", body: form, credentials: "same-origin", cache: "no-store"
      });
      const data = await excelApiResponse(response);
      const results = (data.results ?? []) as ExcelPreviewRow[];
      setExcelPreview(results);
      // Preview does not silently select matches: the user confirms each POI.
      setExcelSelected({});
    } catch (error) {
      setExcelError(error instanceof Error ? error.message : "Không thể đọc Excel.");
    } finally {
      setExcelLoading(false);
    }
  }

  function changeExcelRow(rowNumber: number, field: "name" | "area", value: string) {
    setExcelPreview(previous => previous.map(item =>
      item.row.row === rowNumber
        ? {
            ...item,
            row: { ...item.row, [field]: value },
            candidates: [],
            error: null,
            needsRetry: true
          }
        : item
    ));
    setExcelSelected(previous => {
      const next = { ...previous };
      delete next[rowNumber];
      return next;
    });
  }

  async function retryExcelMatch(rowNumber: number) {
    const item = excelPreview.find(entry => entry.row.row === rowNumber);
    if (!item) return;
    if (item.row.name.trim().length < 2) {
      setExcelError("Dòng " + rowNumber + ": nhập tên địa điểm có ít nhất 2 ký tự.");
      return;
    }
    setExcelError(null);
    setExcelLoading(true);
    try {
      const response = await fetch("/api/personal/import-excel", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row: item.row }),
        cache: "no-store"
      });
      const result = await excelApiResponse(response);
      setExcelPreview(previous => previous.map(entry =>
        entry.row.row === rowNumber
          ? { ...entry, candidates: (result.candidates ?? []) as ExcelCandidate[], error: null, needsRetry: false }
          : entry
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể đối chiếu.";
      setExcelPreview(previous => previous.map(entry =>
        entry.row.row === rowNumber ? { ...entry, error: message, needsRetry: true } : entry
      ));
    } finally {
      setExcelLoading(false);
    }
  }

  async function confirmExcelImport() {
    const items = excelPreview.flatMap(({ row }) =>
      excelSelected[row.row] ? [{ row, selectedId: excelSelected[row.row] }] : []
    );
    if (!items.length) {
      setExcelError("Hãy kiểm tra và chọn ít nhất một kết quả từ Geoapify/OpenStreetMap.");
      return;
    }
    setExcelLoading(true);
    setExcelError(null);
    try {
      const response = await fetch("/api/personal/import-excel", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        cache: "no-store"
      });
      const data = await excelApiResponse(response);
      const results = (data.results ?? []) as Array<{ row: number; status: string; error?: string }>;
      const added = results.filter(item => item.status === "added").length;
      const duplicate = results.filter(item => item.status === "duplicate").length;
      const failed = results.filter(item => item.status === "error");
      setExcelImportResult("Đã lưu " + added + " địa điểm, bỏ qua " + duplicate +
        " địa điểm trùng" + (failed.length ? ", lỗi " + failed.length + " dòng." : "."));
      if (failed.length) setExcelError(failed.map(v => "Dòng " + v.row + ": " + (v.error || "Không thể nhập")).join(" · "));
      if (added > 0) {
        await loadSnapshot();
        setNotice("Đã thêm " + added + " địa điểm từ Excel vào Supabase cá nhân.");
      }
      setExcelSelected({});
    } catch (error) {
      setExcelError(error instanceof Error ? error.message : "Không thể lưu địa điểm.");
    } finally {
      setExcelLoading(false);
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
    const enteredCost = cleanPlainText(
      String(data.get("averageForTwo") ?? ""),
      100
    );
    const place: Place = {
      id: crypto.randomUUID(),
      name: validated.value.name,
      kind: "Địa điểm của bạn",
      description: validated.value.note,
      latitude: validated.value.latitude,
      longitude: validated.value.longitude,
      distanceKm: 0,
      priceLabel: "$",
      averageForTwo: enteredCost || "Chưa có dữ liệu",
      costSource: enteredCost ? "user" : "unknown",
      costConfidence: enteredCost ? 100 : 0,
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

  function openPlaceEditor(place: Place) {
    setSelectedId(place.id);
    setEditName(place.name);
    setEditNote(place.note);
    setEditAddress(place.address ?? "");
    setEditPrice(place.priceLabel);
    setEditAverageForTwo(
      place.averageForTwo === "Chưa có dữ liệu"
        ? ""
        : place.averageForTwo
    );
    setEditBestTime(place.bestTime);
    setEditOpenUntil(place.openUntil);
    editDialogRef.current?.showModal();
  }

  function openEditPlace() {
    openPlaceEditor(selected);
  }

  async function refreshPlaceOpeningHours(placeId: string) {
    const place = customPlaces.find((item) => item.id === placeId);
    if (!place) return;

    const providerId = place.providerId;
    if (!providerId?.startsWith("geoapify:")) {
      openPlaceEditor(place);
      setNotice(
        "Địa điểm này không có Geoapify details; hãy nhập giờ mở cửa thủ công."
      );
      return;
    }

    try {
      const result = await personalApi.getProviderPlaceDetails(providerId);
      const openingHours = result.details?.openingHours?.trim();

      if (!openingHours) {
        openPlaceEditor(place);
        setNotice(
          "Geoapify chưa có giờ mở cửa cho địa điểm này. Bạn có thể nhập thủ công."
        );
        return;
      }

      await personalApi.updatePlace(place.id, {
        ...place,
        openUntil: openingHours
      });
      await loadSnapshot();
      setSelectedId(place.id);
      setNotice("Đã cập nhật giờ mở cửa từ Geoapify.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Không thể làm mới giờ mở cửa."
      );
    }
  }

  function repairPlaceCost(placeId: string) {
    const place = customPlaces.find((item) => item.id === placeId);
    if (!place) return;
    openPlaceEditor(place);
    setNotice(
      "Nhập “Chi phí 2 người” gần thực tế nhất để tăng độ tin cậy cho planner."
    );
  }

  async function submitEditPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPersonalPlace) return;

    try {
      const editedCost = cleanPlainText(editAverageForTwo, 100);
      const averageForTwo = editedCost || "Chưa có dữ liệu";
      const costUnchanged =
        averageForTwo === selected.averageForTwo &&
        selected.costSource === "provider_estimate";

      const updated: Place = {
        ...selected,
        name: cleanPlainText(editName, 100),
        note: cleanPlainText(editNote, 500),
        description: cleanPlainText(editNote, 500) || selected.description,
        address: cleanPlainText(editAddress, 260) || undefined,
        priceLabel: editPrice,
        averageForTwo,
        costSource:
          averageForTwo === "Chưa có dữ liệu"
            ? "unknown"
            : costUnchanged
              ? "provider_estimate"
              : "user",
        costConfidence:
          averageForTwo === "Chưa có dữ liệu"
            ? 0
            : costUnchanged
              ? selected.costConfidence ?? 40
              : 100,
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

  async function replayCompletedPlan(
    plan: CompletedPersonalPlan
  ) {
    const template: PlannerReplayTemplate = {
      sourcePlanId: plan.id,
      stops: plan.plan.stops.map((stop) => ({
        placeId: stop.placeId,
        name: stop.name,
        stage: stop.stage
      }))
    };

    const originalBudget = Math.max(
      100_000,
      plan.plan.totalEstimatedCostForTwo +
        Math.max(0, plan.plan.budgetRemainingForTwo)
    );
    const budgetOptions = [400_000, 700_000, 1_000_000, 1_500_000];
    const replayBudget =
      budgetOptions.find((value) => value >= originalBudget) ??
      budgetOptions[budgetOptions.length - 1]!;

    const maxLegKm = plan.plan.stops.reduce(
      (max, stop) => Math.max(max, stop.travelKmFromPrevious),
      0
    );
    const replayDistance: 3 | 5 | 8 | 12 =
      maxLegKm <= 3 ? 3 : maxLegKm <= 5 ? 5 : maxLegKm <= 8 ? 8 : 12;

    const replayDuration: 2 | 3 | 4 =
      plan.plan.totalDurationMinutes <= 120
        ? 2
        : plan.plan.totalDurationMinutes <= 180
          ? 3
          : 4;
    const replayScenario = plan.plan.scenario ?? "date";
    const replayStartTime = suggestedDailyRouteStartTime(clock);

    let refreshed = 0;
    const updates: Array<Promise<void>> = [];

    for (const stop of plan.plan.stops) {
      const place = customPlaces.find(
        (item) => item.id === stop.placeId
      );
      if (!place?.providerId?.startsWith("geoapify:")) continue;

      updates.push(
        personalApi
          .getProviderPlaceDetails(place.providerId)
          .then(async (result) => {
            const openingHours = result.details?.openingHours?.trim();
            if (!openingHours || openingHours === place.openUntil) return;

            await personalApi.updatePlace(place.id, {
              ...place,
              openUntil: openingHours
            });
            refreshed += 1;
          })
          .catch(() => undefined)
      );
    }

    if (updates.length > 0) {
      setNotice("Đang làm mới dữ liệu các chặng cũ…");
      await Promise.all(updates);
      if (refreshed > 0) {
        await loadSnapshot();
      }
    }

    setPlanReplayTemplate(template);
    setPlanScenario(replayScenario);
    setPlanRoutingMode(plan.plan.routeMode);
    setPlanBudget(replayBudget);
    setPlanDistance(replayDistance);
    setPlanDuration(replayDuration);
    setPlanStartTime(replayStartTime);
    setPlanVariant(0);
    setPlanWeather(null);
    setPlanWeatherLoading(false);
    setActivePlan(null);

    planDialogRef.current?.showModal();
    setNotice(
      "Đã nạp " +
        plan.plan.stops.length +
        " chặng cũ làm template" +
        (refreshed > 0
          ? " · đã làm mới giờ mở cửa của " + refreshed + " nơi."
          : ".")
    );
  }

  function focusCompletedPlan(plan: CompletedPersonalPlan) {
    const first = plan.plan.stops[0];
    if (!first) return;

    const place =
      rankedAll.find((item) => item.id === first.placeId) ??
      customPlaces.find((item) => item.id === first.placeId);

    if (place) {
      setSelectedId(place.id);
      mapRef.current?.flyTo({
        center: [place.longitude, place.latitude],
        zoom: 13.5,
        duration: 650,
        essential: true
      });
    }

    setNotice(
      "↺ Plan " +
        formatVisitedAt(plan.completedAt) +
        " · " +
        plan.plan.summary
    );
  }

  function toggleRatingContext(context: Scenario) {
    setRatingContexts((current) =>
      current.includes(context)
        ? current.filter((item) => item !== context)
        : [...current, context]
    );
  }

  const activeFilterCount =
    Number(discoveryFilters.category !== "all") +
    Number(discoveryFilters.amenity !== "any") +
    Number(discoveryFilters.radiusKm !== 0) +
    Number(discoveryFilters.openNow);
  const activeScenarioLabel = readableScenario(scenario);
  const locationReference = userLocation
    ? "Từ vị trí của bạn"
    : "Từ tâm khu vực tìm kiếm";

  const heading =
    view === "mine"
      ? visiblePlaces.length + " địa điểm trong thư viện"
      : view === "saved"
      ? visiblePlaces.length + " địa điểm đã lưu"
      : view === "history"
        ? visiblePlaces.length +
          " nơi đã đi · " +
          completedPlans.length +
          " plan"
        : view === "collections"
          ? selectedCollection?.name ?? "Bộ sưu tập"
          : visiblePlaces.length + " địa điểm phù hợp";

  return (
    <main
      className={
        "app-shell" +
        (mapFocus ? " app-shell--map-focus" : "") +
        (mobilePanel === "list" ? " app-shell--mobile-list" : "")
      }
    >
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
            className={"rail-action" + (view === "mine" ? " rail-action--active" : "")}
            type="button"
            onClick={() => switchView("mine")}
          >
            <StarIcon /><span>Thư viện</span>
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
          <details className="topbar-tools">
            <summary aria-label="Mở công cụ dữ liệu và tài khoản">
              <span aria-hidden="true">☰</span>
              <span>Công cụ</span>
            </summary>
            <div className="topbar-tools__menu">
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
          <button
            className="backup-button"
            type="button"
            onClick={() => profileTransferDialogRef.current?.showModal()}
          >
            Chuyển
          </button>
          <button
            className="backup-button"
            type="button"
            onClick={() => shareManagerDialogRef.current?.showModal()}
          >
            Links{itineraryShares.length > 0 ? " " + itineraryShares.length : ""}
          </button>

            </div>
          </details>
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
        <div className="discovery-welcome">
          <div>
            <strong>{view === "discover" ? "Khám phá quanh bạn" : view === "mine" ? "Thư viện của tôi" : "Địa điểm của tôi"}</strong>
            <span>Chọn một địa điểm để xem, lưu hoặc lên lịch trình.</span>
          </div>
          {view === "discover" ? (
            <button
              type="button"
              className="discovery-filter-trigger"
              aria-expanded={showAdvancedFilters}
              aria-controls="discovery-advanced-filters"
              onClick={() => setShowAdvancedFilters(value => !value)}
            >
              <span aria-hidden="true">⚙</span>
              Bộ lọc{activeFilterCount ? " · " + activeFilterCount : ""}
              <span aria-hidden="true">{showAdvancedFilters ? "⌃" : "⌄"}</span>
            </button>
          ) : null}
        </div>
        <div className="scenario-row" role="group" aria-label="Chọn phong cách đi chơi">
          {scenarios.map((item) => (
            <button
              type="button"
              key={item}
              className={
                "scenario-chip" +
                (scenario === item ? " scenario-chip--active" : "")
              }
              aria-pressed={scenario === item}
              onClick={() => setScenario(item)}
            >
              {item !== "all" ? <span>{scenarioEmoji[item]}</span> : null}
              {readableScenario(item)}
            </button>
          ))}
        </div>

        {view === "discover" && showAdvancedFilters ? (
          <div className="discovery-filter-row" id="discovery-advanced-filters">
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

        {view === "discover" ? (
          <div className="discovery-context-bar" aria-label="Bộ lọc đang áp dụng">
            <span className="discovery-context-bar__count">{visiblePlaces.length} địa điểm</span>
            {scenario !== "all" ? (
              <button type="button" onClick={() => setScenario("all")} aria-label={"Bỏ mood " + activeScenarioLabel}>
                {activeScenarioLabel} ×
              </button>
            ) : null}
            {discoveryFilters.category !== "all" ? (
              <button type="button" onClick={() => setDiscoveryFilters(current => ({ ...current, category: "all" }))}>
                {discoveryCategoryOptions.find(item => item.value === discoveryFilters.category)?.label} ×
              </button>
            ) : null}
            {discoveryFilters.amenity !== "any" ? (
              <button type="button" onClick={() => setDiscoveryFilters(current => ({ ...current, amenity: "any" }))}>
                {discoveryAmenityOptions.find(item => item.value === discoveryFilters.amenity)?.label} ×
              </button>
            ) : null}
            {discoveryFilters.radiusKm !== 0 ? (
              <button type="button" onClick={() => setDiscoveryFilters(current => ({ ...current, radiusKm: 0 }))}>
                Trong {discoveryFilters.radiusKm} km ×
              </button>
            ) : null}
            {discoveryFilters.openNow ? (
              <button type="button" onClick={() => setDiscoveryFilters(current => ({ ...current, openNow: false }))}>
                Đang mở ×
              </button>
            ) : null}
            <span className="discovery-context-bar__location" title="Khoảng cách đường chim bay, không phải quãng đường đi">
              ⌖ {locationReference}
            </span>
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
                disabled={shareLoading}
                onClick={() =>
                  void sharePlanSnapshot(
                    runningPlan.plan,
                    "active",
                    runningPlan.id
                  )
                }
              >
                Chia sẻ
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
              {view === "mine"
                ? "Địa điểm đã nhập · Lưu trên Supabase cá nhân"
                : view === "history"
                ? "Trải nghiệm của bạn"
                : view === "collections"
                  ? selectedCollection?.description || "Bộ sưu tập cá nhân"
                  : "Gợi ý cá nhân"}
            </span>
            <h1>{heading}</h1>
            <small className="distance-reference-hint">
              {userLocation
                ? "Khoảng cách từ vị trí GPS của bạn"
                : "Khoảng cách ước tính từ tâm khu vực tìm kiếm · Bật vị trí để tính từ bạn"}
            </small>
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

        {view === "history" &&
        plannerMetrics &&
        plannerMetrics.generated +
          plannerMetrics.generationFailed +
          plannerMetrics.started +
          plannerMetrics.canceled >
          0 ? (
          <section className="planner-metrics-card">
            <div className="planner-metrics-card__head">
              <div>
                <span className="eyebrow">Planner · 30 ngày</span>
                <strong>
                  {plannerMetrics.activeDays} ngày có hoạt động
                </strong>
              </div>
              <small>
                {plannerMetrics.completionRate !== null
                  ? plannerMetrics.completionRate + "% hoàn thành sau khi bắt đầu"
                  : "Đang tích lũy dữ liệu"}
              </small>
            </div>

            <div className="planner-metrics-grid">
              <div>
                <span>Tạo thành công</span>
                <strong>{plannerMetrics.generated}</strong>
                <small>
                  {plannerMetrics.initialGenerated} lần đầu ·{" "}
                  {plannerMetrics.rerolled} reroll
                </small>
              </div>
              <div>
                <span>Đã bắt đầu</span>
                <strong>{plannerMetrics.started}</strong>
                <small>
                  {plannerMetrics.startRate !== null
                    ? plannerMetrics.startRate + "% / lần tạo đầu"
                    : "chưa đủ mẫu"}
                </small>
              </div>
              <div>
                <span>Hoàn thành</span>
                <strong>{plannerMetrics.completed}</strong>
                <small>
                  {plannerMetrics.completionRate !== null
                    ? plannerMetrics.completionRate + "% / started"
                    : "chưa đủ mẫu"}
                </small>
              </div>
              <div>
                <span>Fail / Hủy</span>
                <strong>
                  {plannerMetrics.generationFailed} / {plannerMetrics.canceled}
                </strong>
                <small>
                  {plannerMetrics.generationSuccessRate !== null
                    ? plannerMetrics.generationSuccessRate + "% tạo thành công"
                    : "chưa đủ mẫu"}
                </small>
              </div>
            </div>

            {plannerHealth ? (
              <div
                className={
                  "planner-health planner-health--" +
                  plannerHealth.state
                }
              >
                <div className="planner-health__head">
                  <strong>{plannerHealth.title}</strong>
                  <span>{plannerHealth.confidence} confidence</span>
                </div>
                <p>{plannerHealth.detail}</p>
                <small>{plannerHealth.action}</small>
              </div>
            ) : null}

            <p>
              Chỉ là counter theo ngày; ĐiĐâu không lưu GPS trace cho thống kê này.
            </p>
          </section>
        ) : null}

        {view === "history" && completedPlans.length > 0 ? (
          <div className="completed-plan-history">
            <div className="completed-plan-history__head">
              <div>
                <span className="eyebrow">Những buổi đã đi</span>
                <strong>{completedPlans.length} plan được lưu</strong>
              </div>
              <small>
                {completedPlanQualityStats.average !== null
                  ? "Q TB " +
                    completedPlanQualityStats.average +
                    (completedPlanQualityStats.lowCount > 0
                      ? " · " +
                        completedPlanQualityStats.lowCount +
                        " plan thấp"
                      : "")
                  : "Gần nhất trước"}
              </small>
            </div>

            <div className="completed-plan-history__list">
              {completedPlans.slice(0, 8).map((plan) => {
                const completedCount = plan.completedStopIds.length;
                const skippedCount = plan.skippedStopIds.length;
                return (
                  <div
                    className="completed-plan-history__item"
                    key={plan.id}
                  >
                    <button
                      type="button"
                      className="completed-plan-history__main"
                      onClick={() => focusCompletedPlan(plan)}
                    >
                      <span className="completed-plan-history__top">
                        <strong>
                          {plan.plan.scenario
                            ? scenarioLabels[plan.plan.scenario]
                            : "Plan cá nhân"}
                        </strong>
                        <small>{formatVisitedAt(plan.completedAt)}</small>
                      </span>
                      <span className="completed-plan-history__route">
                        {plan.plan.stops
                          .map((stop) => stop.name)
                          .join(" → ")}
                      </span>
                      <span className="completed-plan-history__meta">
                        <b>{completedCount}/{plan.plan.stops.length} chặng xong</b>
                        {skippedCount > 0 ? (
                          <span>· {skippedCount} bỏ qua</span>
                        ) : null}
                        <span>· ~{moneyLabel(plan.plan.totalEstimatedCostForTwo)}</span>
                        <span>· {plan.plan.totalDurationMinutes} phút</span>
                        <span>· {routingModeLabels[plan.plan.routeMode]}</span>
                        {plan.plan.quality ? (
                          <span
                            className={
                              "completed-plan-quality completed-plan-quality--" +
                              plan.plan.quality.level
                            }
                          >
                            · Q{plan.plan.quality.score}
                          </span>
                        ) : null}
                        {plan.outcomeRating ? (
                          <span>· ★ {plan.outcomeRating}/5</span>
                        ) : (
                          <span>· chưa feedback</span>
                        )}
                      </span>
                    </button>
                    <div className="completed-plan-history__actions">
                      <button
                        type="button"
                        className="completed-plan-history__replay"
                        disabled={planWeatherLoading}
                        onClick={() => void replayCompletedPlan(plan)}
                      >
                        Đi lại
                      </button>
                      <button
                        type="button"
                        className="completed-plan-history__share"
                        disabled={shareLoading}
                        onClick={() =>
                          void sharePlanSnapshot(
                            plan.plan,
                            "completed",
                            plan.id
                          )
                        }
                      >
                        Chia sẻ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === "discover" && tasteProfile.sampleSize >= 2 ? (
          <div className="taste-strip">
            <span>Gu đang học</span>
            <strong>{tasteProfileSummary(tasteProfile)}</strong>
            <small>
              {tasteProfile.sampleSize} nơi ·{" "}
              {Math.round(tasteProfile.confidence * 100)}% confidence
              {planOutcomeProfile.sampleSize > 0
                ? " · " +
                  planOutcomeProfile.successfulPlanCount +
                  "/" +
                  planOutcomeProfile.sampleSize +
                  " plan đi khá trọn"
                : ""}
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
                {whatNextSuggestions[0].travelSource === "road"
                  ? " · road"
                  : ""}
              </span>
            </button>
          </div>
        ) : null}

        {view === "mine" ? (
          <section className="library-manager" aria-label="Quản lý địa điểm của tôi">
            <div className="library-manager__header">
              <div>
                <strong>Thư viện địa điểm</strong>
                <span>{libraryCounts.all} địa điểm · Lọc theo nguồn nhập</span>
              </div>
              <button type="button" onClick={openExcelDialog} disabled={librarySaving}>
                ▦ Import Excel
              </button>
            </div>
            <div className="library-source-tabs" role="group" aria-label="Lọc nguồn địa điểm">
              {([
                ["all", "Tất cả"], ["excel", "Excel"], ["map", "Từ bản đồ"], ["manual", "Thủ công"]
              ] as const).map(([source, title]) => (
                <button
                  type="button"
                  key={source}
                  className={librarySource === source ? "is-active" : ""}
                  aria-pressed={librarySource === source}
                  onClick={() => { setLibrarySource(source); setLibrarySelectedIds(new Set()); }}
                >
                  {title} <span>{libraryCounts[source]}</span>
                </button>
              ))}
            </div>
            <div className="library-manager__selection">
              <span>{librarySelectedIds.size} đang chọn / tối đa 20</span>
              <div>
                <button type="button" disabled={librarySaving || !visiblePlaces.length} onClick={selectVisibleLibraryPlaces}>
                  Chọn tối đa 20
                </button>
                <button type="button" disabled={librarySaving || !librarySelectedIds.size} onClick={() => setLibrarySelectedIds(new Set())}>
                  Bỏ chọn
                </button>
              </div>
            </div>
            {librarySelectedIds.size > 0 ? (
              <div className="library-bulk-panel">
                <strong>Đưa {librarySelectedIds.size} địa điểm vào bộ sưu tập</strong>
                <label>
                  <span>Bộ sưu tập hiện có</span>
                  <select value={libraryTargetCollection} disabled={librarySaving} onChange={event => setLibraryTargetCollection(event.target.value)}>
                    <option value="">Chọn bộ sưu tập…</option>
                    {collections.map(collection => (
                      <option key={collection.id} value={collection.id}>{collection.name} ({collection.placeIds.length})</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Hoặc tạo bộ sưu tập mới</span>
                  <input
                    type="text"
                    value={libraryNewCollectionName}
                    maxLength={60}
                    disabled={librarySaving}
                    onChange={event => setLibraryNewCollectionName(event.target.value)}
                    placeholder="Ví dụ: Quán cafe cuối tuần"
                  />
                </label>
                <div className="library-bulk-panel__actions">
                  <button type="button" className="library-bulk-panel__save" disabled={librarySaving}
                    onClick={() => void addLibrarySelectionToCollection()}>
                    {librarySaving ? "Đang lưu…" : "Lưu vào bộ sưu tập"}
                  </button>
                  <button type="button" disabled={librarySaving || librarySelectedIds.size < 2 || librarySelectedIds.size > 3}
                    onClick={shortlistFromLibrary}>So sánh 2–3 nơi</button>
                </div>
              </div>
            ) : (
              <p className="library-manager__hint">
                Chọn ô bên cạnh địa điểm để gom vào bộ sưu tập hoặc so sánh nhanh.
              </p>
            )}
          </section>
        ) : null}

        <div className="place-list" id="mobile-place-list" aria-label="Kết quả địa điểm">
          {visiblePlaces.length === 0 ? (
            <div className="empty-state">
              <strong>
                {view === "mine" && customPlaces.length === 0
                  ? "Thư viện chưa có địa điểm."
                  : view === "collections" && collections.length === 0
                  ? "Chưa có bộ sưu tập."
                  : discoveryLoading && view === "discover"
                    ? "Đang tải địa điểm thật…"
                    : "Chưa có địa điểm trong chế độ này."}
              </strong>
              <span>
                {view === "mine"
                  ? "Import Excel, lưu địa điểm từ bản đồ hoặc thêm địa điểm thủ công để bắt đầu."
                  : view === "collections"
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
                    (selected.id === place.id ? " place-card--active" : "") +
                    (view === "mine" ? " place-card--library" : "")
                  }
                >
                  {view === "mine" ? (
                    <label className="library-place-select" title={"Chọn " + place.name}>
                      <input type="checkbox" checked={librarySelectedIds.has(place.id)} disabled={librarySaving}
                        onChange={() => toggleLibrarySelection(place.id)} aria-label={"Chọn " + place.name} />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="place-card__main"
                    onClick={() => {
                      setSelectedId(place.id);
                      if (window.matchMedia("(max-width: 760px)").matches) {
                        setMapPreviewId(place.id);
                        setMobilePanel("map");
                      }
                    }}
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
                        <span title={userLocation ? "Khoảng cách từ GPS" : "Khoảng cách từ tâm khu vực tìm kiếm"}>{userLocation ? "" : "≈ "}{distanceLabel(place.distanceKm)}</span>
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
                        {view === "mine" ? (
                          <em className="library-origin-label">{librarySourceOf(place) === "excel"
                            ? "▦ Excel" : librarySourceOf(place) === "map"
                              ? "⌖ Bản đồ" : "✎ Thủ công"}</em>
                        ) : null}
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

        {view === "discover" && discoveredPoiResults.length > 0 ? (
          <div className="discovery-pagination">
            <span>
              {discoveredPoiResults.length} POI đã nạp
              {discoveryNextOffset !== null ? " · còn kết quả" : " · đã hết trang"}
            </span>
            {discoveryNextOffset !== null ? (
              <button
                type="button"
                disabled={discoveryLoading}
                onClick={() => void loadMoreDiscovery()}
              >
                {discoveryLoading ? "Đang nạp…" : "+ Xem thêm 20"}
              </button>
            ) : null}
          </div>
        ) : null}

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

        <div className="place-import-actions">
          <button
            className="wide-secondary"
            type="button"
            onClick={() => addDialogRef.current?.showModal()}
          >
            <PlusIcon />
            Thêm địa điểm thủ công
          </button>
          <button className="excel-import-entry" type="button" onClick={openExcelDialog}>
            <span aria-hidden="true">▦</span> Import danh sách Excel
          </button>
        </div>
      </section>

      <section className="map-pane" aria-label="Bản đồ">
        <div ref={mapNodeRef} className="map-canvas" />
        {mapLoadError ? (
          <div className="map-load-error" role="alert">
            <strong>Không tải được nền bản đồ</strong>
            <span>Kiểm tra kết nối hoặc thử tải lại trang. Danh sách địa điểm vẫn có thể sử dụng.</span>
            <button type="button" onClick={() => window.location.reload()}>Tải lại bản đồ</button>
          </div>
        ) : null}
        <div className="map-floating-top">
          <button
            type="button"
            className="map-area-search"
            onClick={() => void searchCurrentArea()}
            disabled={viewportLoading || discoveryLoading}
          >
            <SearchIcon />
            {viewportLoading || discoveryLoading ? "Đang tìm…" : "Tìm trong khu vực này"}
          </button>
          <button type="button" className="plan-button" onClick={openPlanBuilder}>
            ◫ Lên kế hoạch
          </button>
          <button
            type="button"
            className="map-focus-toggle"
            onClick={() => {
              if (window.matchMedia("(max-width: 760px)").matches) {
                setMobilePanel(previous => previous === "list" ? "map" : "list");
              } else {
                setMapFocus(previous => !previous);
              }
            }}
            aria-pressed={mapFocus}
            aria-label={mapFocus ? "Hiện danh sách địa điểm" : "Chế độ bản đồ rộng"}
          >
            <span className="map-focus-toggle__desktop">{mapFocus ? "Hiện danh sách" : "Xem rộng"}</span>
            <span className="map-focus-toggle__mobile" aria-hidden="true">{mobilePanel === "list" ? "Bản đồ" : "Danh sách"}</span>
          </button>
          <details className="map-extra-actions">
            <summary aria-label="Các công cụ bản đồ khác">⋯ <span>Khác</span></summary>
            <div className="map-extra-actions__menu">
              <button type="button" onClick={() => void openDailyDiscovery()}>☀ Gợi ý hôm nay</button>
              <button type="button" onClick={surpriseMe}>✨ Đi đâu bất ngờ?</button>
              {viewportBounds ? (
                <button type="button" onClick={clearViewportFilter}>Bỏ giới hạn vùng</button>
              ) : null}
              <button type="button" onClick={() => switchView("mine")}>Thư viện của tôi</button>
            </div>
          </details>
        </div>

        {mapPreviewPlace ? (
          <section className="map-place-preview" aria-label={"Xem nhanh " + mapPreviewPlace.name}>
            <button
              type="button"
              className="map-place-preview__close"
              aria-label="Đóng xem nhanh"
              onClick={() => setMapPreviewId(null)}
            >
              ×
            </button>
            <div className="map-place-preview__content">
              <div
                className="map-place-preview__thumb"
                style={{ "--place-accent": mapPreviewPlace.accent } as CSSProperties}
              >
                {placeCovers[mapPreviewPlace.id] ? (
                  <img src={placeCovers[mapPreviewPlace.id]} alt={"Ảnh " + mapPreviewPlace.name} />
                ) : (
                  <span aria-hidden="true">{placeIcon(mapPreviewPlace)}</span>
                )}
              </div>
              <div className="map-place-preview__description">
                <span className="map-place-preview__eyebrow">
                  {mapPreviewPlace.kind} <i>·</i> {mapPreviewPlace.match}% phù hợp
                </span>
                <strong title={mapPreviewPlace.name}>{mapPreviewPlace.name}</strong>
                <span className="map-place-preview__meta">
                  {userLocation ? "" : "≈ "}
                  {distanceLabel(mapPreviewPlace.distanceKm)}
                  {userLocation ? " từ bạn" : " từ tâm vùng tìm kiếm"}
                  {" · "}
                  {priceBadge(mapPreviewPlace)}
                </span>
                {mapPreviewPlace.recommendationReasons?.[0] ? (
                  <span className="map-place-preview__reason">
                    {mapPreviewPlace.recommendationReasons[0]}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="map-place-preview__actions">
              <button
                type="button"
                className="map-place-preview__route"
                onClick={() => {
                  const destination = encodeURIComponent(
                    mapPreviewPlace.latitude + "," + mapPreviewPlace.longitude
                  );
                  window.open(
                    "https://www.google.com/maps/dir/?api=1&destination=" + destination,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }}
              >
                Chỉ đường ↗
              </button>
              <button
                type="button"
                className="map-place-preview__save"
                aria-pressed={saved.has(mapPreviewPlace.id)}
                onClick={() => void toggleSaved(mapPreviewPlace.id)}
              >
                {saved.has(mapPreviewPlace.id) ? "♥ Đã lưu" : "♡ Lưu nơi này"}
              </button>
              <button
                type="button"
                className="map-place-preview__shortlist"
                aria-pressed={shortlistIds.has(mapPreviewPlace.id)}
                onClick={() => toggleShortlist(mapPreviewPlace)}
              >
                {shortlistIds.has(mapPreviewPlace.id) ? "✓ Đã chọn" : "+ So sánh"}
              </button>
            </div>
          </section>
        ) : null}

        <div className="map-style-switch" role="group" aria-label="Kiểu nền bản đồ">
          <span>Kiểu bản đồ</span>
          <button
            type="button"
            className={mapTheme === "streets" ? "is-active" : ""}
            aria-pressed={mapTheme === "streets"}
            onClick={() => setMapTheme("streets")}
          >
            Đường phố
          </button>
          <button
            type="button"
            className={mapTheme === "minimal" ? "is-active" : ""}
            aria-pressed={mapTheme === "minimal"}
            onClick={() => setMapTheme("minimal")}
          >
            Tối giản
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

        <div className="osm-attribution" aria-label="Nguồn dữ liệu bản đồ">
          <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Powered by Geoapify</a>
          {" · "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
          {" · "}
          <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a>
        </div>
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
            <span title={userLocation ? "Khoảng cách từ GPS" : "Khoảng cách từ tâm khu vực tìm kiếm"}>{userLocation ? "" : "≈ "}{distanceLabel(selected.distanceKm)}</span>
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
            <button
              type="button"
              className="secondary-button"
              disabled={checkInLoading}
              onClick={() => void checkIn()}
            >
              <PinIcon /> {checkInLoading ? "Đang check-in…" : "Check-in"}
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
                      {item.travelSource === "road" ? " · road" : ""}
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

          {selected.costSource === "provider_estimate" &&
          selectedProviderCost !== null ? (
            <section className="cost-correction-card">
              <div className="cost-correction-card__head">
                <div>
                  <span className="eyebrow">Giá này có đúng không?</span>
                  <strong>{selected.averageForTwo} / 2 người</strong>
                </div>
                <span>
                  {selected.costConfidence ?? 0}% confidence
                </span>
              </div>
              <p>
                Đây là estimate theo loại địa điểm, không phải giá niêm yết.
                Chọn mốc gần thực tế nhất để planner học budget của bạn.
              </p>
              <div className="cost-correction-options">
                {selectedCostChoices.map((amount, index) => (
                  <button
                    type="button"
                    key={amount}
                    onClick={() => void confirmSelectedCost(amount)}
                  >
                    <small>
                      {index === 0
                        ? "Thấp hơn"
                        : index === selectedCostChoices.length - 1
                          ? "Cao hơn"
                          : "Gần đúng"}
                    </small>
                    <strong>{moneyLabel(amount)}</strong>
                  </button>
                ))}
              </div>
              {isPersonalPlace ? (
                <button
                  type="button"
                  className="cost-correction-edit"
                  onClick={openEditPlace}
                >
                  Nhập con số khác
                </button>
              ) : null}
            </section>
          ) : null}

          <section className="detail-section">
            <span className="eyebrow">Cần biết</span>
            <dl className="fact-grid">
              <div>
                <dt>Chi phí 2 người</dt>
                <dd>
                  {selected.averageForTwo}
                  {selected.costSource === "provider_estimate" ? (
                    <small className="cost-estimate-note">
                      {" "}· ước tính sơ bộ, chưa phải giá niêm yết
                    </small>
                  ) : null}
                </dd>
              </div>
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
            So sánh tối đa 3 địa điểm theo gu và dữ liệu hiện có. Shortlist chỉ
            lưu trong phiên trình duyệt, không ghi thêm dữ liệu dài hạn.
          </p>

          <div className="comparison-toolbar">
            <span>Ưu tiên so sánh</span>
            <div className="comparison-toolbar__options" role="group" aria-label="Sắp xếp so sánh">
              {([
                ["match", "Hợp gu nhất"],
                ["distance", "Gần nhất"],
                ["cost", "Chi phí thấp"]
              ] as const).map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  className={comparisonSort === mode ? "is-active" : ""}
                  aria-pressed={comparisonSort === mode}
                  onClick={() => setComparisonSort(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p className="comparison-disclaimer">
            {userLocation
              ? "Khoảng cách đường chim bay từ vị trí GPS (không phải thời gian di chuyển)."
              : "Chưa bật GPS: khoảng cách đường chim bay tính từ tâm khu vực tìm kiếm, không phải từ vị trí của bạn."}
            {" "}Giá từ nhà cung cấp chỉ là ước tính, có thể khác giá thực tế.
          </p>

          <div
            className="compare-grid"
            style={{
              gridTemplateColumns:
                "repeat(" + Math.max(1, comparisonPlaces.length) + ", minmax(0, 1fr))"
            }}
          >
            {comparisonPlaces.map((place) => {
              const status = openingStatus(place.openUntil, clock);
              const rating = ratings[place.id];
              const cover = placeCovers[place.id];

              return (
                <article className="compare-card" key={place.id}>
                  <div className="compare-card__highlights">
                    {comparisonWinners.matchId === place.id ? <span>✦ Hợp gu nhất</span> : null}
                    {comparisonWinners.distanceId === place.id ? <span>⌖ Gần nhất</span> : null}
                    {comparisonWinners.costId === place.id ? <span>₫ Chi phí thấp</span> : null}
                  </div>
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
                        <dd>{userLocation ? "" : "≈ "}{distanceLabel(place.distanceKm)}</dd>
                      </div>
                      <div>
                        <dt>Giá cho 2 người</dt>
                        <dd>
                          {comparisonCost(place) !== null
                            ? (place.costSource === "provider_estimate" ? "≈ " : "") + moneyLabel(comparisonCost(place)!)
                            : "Chưa có dữ liệu"}
                          {place.costSource === "provider_estimate" ? <small className="compare-cost-hint">Ước tính</small> : null}
                        </dd>
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

          <div className="compare-group-poll">
            <div>
              <strong>Đi cùng nhiều người?</strong>
              <span>
                Tạo link vote 24 giờ từ shortlist này. Mỗi trình duyệt có 1
                lựa chọn và có thể đổi ý.
              </span>
            </div>
            <button
              type="button"
              disabled={groupPollLoading || shortlist.length < 2}
              onClick={() => void createGroupPollFromShortlist()}
            >
              {groupPollLoading ? "Đang tạo…" : "Tạo poll nhóm"}
            </button>
          </div>
        </div>
      </dialog>

      <dialog className="app-dialog app-dialog--excel" ref={excelDialogRef}>
        <div className="dialog-card excel-import-dialog">
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Nhập Excel · Không cần Google API key</span>
              <h2>Import địa điểm từ Excel</h2>
            </div>
            <button className="icon-button" type="button" onClick={() => excelDialogRef.current?.close()} aria-label="Đóng"><CloseIcon /></button>
          </div>
          <p className="dialog-copy">
            Tải mẫu, điền tên và khu vực, đối chiếu kết quả từ Geoapify/OpenStreetMap rồi xác nhận trước khi lưu. Link Google Maps (nếu có) chỉ để bạn tham khảo.
          </p>
          <div className="excel-import-steps" aria-label="Các bước nhập Excel">
            <span className="is-current"><b>1</b> Chọn Excel</span>
            <span className={excelPreview.length ? "is-current" : ""}><b>2</b> Kiểm tra địa điểm</span>
            <span className={excelImportResult ? "is-current" : ""}><b>3</b> Lưu vào ĐiĐâu</span>
          </div>
          <div className="excel-import-source">
            <strong>Đang dùng nguồn miễn phí trong cấu hình hiện tại</strong>
            <small>Geoapify / OpenStreetMap · Không gọi Places API trả phí của Google. Dữ liệu Geoapify vẫn chịu hạn mức API.</small>
          </div>
          <div className="excel-import-instructions">
            <a href="/api/personal/import-excel" download="DiDau-Mau-Import-GoogleMaps.xlsx">
              ↓ Tải mẫu Excel (.xlsx)
            </a>
            <span>Tối đa 20 địa điểm/lần · 1 MB · Sử dụng Geoapify hiện có</span>
          </div>
          <label className="excel-upload-field">
            <strong>Chọn file Excel đã điền</strong>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={excelLoading}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) void previewExcelFile(file);
                event.currentTarget.value = "";
              }}
            />
            <small>{excelFileName || "Chưa chọn file"}</small>
          </label>
          {excelLoading ? <p role="status" className="excel-import-loading">Đang đối chiếu với Geoapify / OpenStreetMap…</p> : null}
          {excelError ? <p role="alert" className="excel-import-error">{excelError}</p> : null}
          {excelImportResult ? <p role="status" className="excel-import-success">{excelImportResult}</p> : null}
          {excelPreview.length ? (
            <div className="excel-preview-area">
              <div className="excel-preview-area__head">
                <strong>Xem trước {excelPreview.length} dòng</strong>
                <span>{Object.keys(excelSelected).length} đã chọn · {excelPreview.filter(item => !item.candidates.length || Boolean(item.error)).length} chưa tìm thấy · Còn lại được bỏ qua</span>
              </div>
              {excelPreview.map(({ row, candidates, error }) => (
                <section key={row.row} className="excel-preview-row">
                  <div className="excel-preview-row__label">
                    <b>#{row.row} · {row.name}</b>
                    <span className={"excel-row-status " + (excelSelected[row.row] ? "is-selected" : error || !candidates.length ? "is-error" : "is-unselected")}>
                      {excelSelected[row.row] ? "✓ Đã chọn" : error || !candidates.length ? "Cần bổ sung" : "Chờ xác nhận"}
                    </span>
                    <small>{row.area || "Chưa có khu vực"}</small>
                    {row.note ? <small>Ghi chú: {row.note}</small> : null}
                    <details className="excel-row-editor">
                      <summary>Sửa tên/khu vực và tìm lại</summary>
                      <label>
                        <span>Tên địa điểm</span>
                        <input
                          type="text"
                          value={row.name}
                          maxLength={100}
                          disabled={excelLoading}
                          onChange={event => changeExcelRow(row.row, "name", event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Khu vực</span>
                        <input
                          type="text"
                          value={row.area}
                          maxLength={180}
                          placeholder="Ví dụ: Tây Hồ, Hà Nội"
                          disabled={excelLoading}
                          onChange={event => changeExcelRow(row.row, "area", event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={excelLoading}
                        onClick={() => void retryExcelMatch(row.row)}
                      >
                        Tìm lại
                      </button>
                    </details>
                  </div>
                  {error ? <span className="excel-preview-row__error">{error}</span>
                    : !candidates.length ? <span className="excel-preview-row__error">Chưa tìm thấy kết quả. Mở “Sửa tên/khu vực và tìm lại” ở bên trái để tìm chính xác hơn.</span>
                    : (
                      <div className="excel-preview-row__choices">
                        <label>
                          <span>Kết quả tìm thấy</span>
                          <select
                            value={excelSelected[row.row] ?? ""}
                            onChange={event => setExcelSelected(current => {
                              const next = { ...current };
                              if (!event.target.value) delete next[row.row];
                              else next[row.row] = event.target.value;
                              return next;
                            })}
                          >
                            <option value="">Bỏ qua / chưa chắc chắn</option>
                            {candidates.map(candidate => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name} · {candidate.address} ({candidate.confidence}% tương đồng tên, {candidate.source === "geoapify" ? "Geoapify" : "OSM"})
                              </option>
                            ))}
                          </select>
                        </label>
                        {candidates.find(item => item.id === excelSelected[row.row]) ? (
                          <a
                            href={candidates.find(item => item.id === excelSelected[row.row])!.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >Mở tọa độ trên Google Maps để đối chiếu ↗</a>
                        ) : null}
                      </div>
                    )}
                </section>
              ))}
            </div>
          ) : null}
          {excelPreview.length ? (
            <div className="excel-import-actions-row">
              <button
                type="button"
                disabled={excelLoading}
                onClick={() => { setExcelSelected({}); setExcelError(null); }}
              >Bỏ chọn tất cả</button>
              <button
                type="button"
                disabled={excelLoading}
                onClick={() => { setExcelPreview([]); setExcelSelected({}); setExcelFileName(""); setExcelError(null); setExcelImportResult(null); }}
              >Nhập file khác</button>
            </div>
          ) : null}
          <button
            className="primary-button primary-button--wide"
            type="button"
            disabled={excelLoading || !Object.keys(excelSelected).length}
            onClick={() => void confirmExcelImport()}
          >
            Xác nhận nhập {Object.keys(excelSelected).length} địa điểm đã chọn
          </button>
          <small className="excel-import-footnote">
            Chỉ nhập những dòng bạn xác nhận. Địa điểm trùng ID Geoapify/OSM sẽ được bỏ qua. Chi phí Excel là thông tin tự nhập, không phải giá xác minh.
          </small>
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
          <button type="button" className="excel-import-inline" onClick={openExcelDialog}>
            ▦ Nhập nhiều địa điểm từ Excel →
          </button>
          <label className="field">
            <span>Tên</span>
            <input name="name" required minLength={2} maxLength={80} />
          </label>
          <label className="field">
            <span>Ghi chú</span>
            <textarea name="note" rows={4} maxLength={300} placeholder="Yên, hợp date, đi tối đẹp…" />
          </label>
          <label className="field">
            <span>Chi phí 2 người (không bắt buộc)</span>
            <input
              name="averageForTwo"
              maxLength={100}
              placeholder="Ví dụ: 250k, 350k hoặc 300-450k"
            />
            <small>Dữ liệu này giúp planner học mức chi tiêu thực tế của bạn.</small>
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
            <label className="field"><span>Khoảng giá</span><select value={editPrice} onChange={(e) => setEditPrice(e.target.value as Place["priceLabel"])}><option value="$">$</option><option value="$">$</option><option value="$$">$$</option></select></label>
            <label className="field"><span>Đóng cửa</span><input value={editOpenUntil} onChange={(e) => setEditOpenUntil(e.target.value)} maxLength={60} placeholder="Mo-Su 08:00-22:00" /></label>
          </div>
          <label className="field">
            <span>Chi phí 2 người</span>
            <input
              value={editAverageForTwo}
              onChange={(e) => setEditAverageForTwo(e.target.value)}
              maxLength={100}
              placeholder="Ví dụ: 350k hoặc 300-450k"
            />
            <small>
              Giá bạn nhập sẽ được coi là dữ liệu thật và ưu tiên hơn ước tính theo category. Planner chỉ học budget từ giá thật bạn nhập.
            </small>
          </label>
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

      <dialog className="app-dialog" ref={planFeedbackDialogRef}>
        <form className="dialog-card plan-feedback-card" onSubmit={submitPlanFeedback}>
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Outcome thật</span>
              <h2>Buổi đi vừa rồi thế nào?</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => planFeedbackDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            Hoàn thành route chưa chắc đồng nghĩa là thích. Feedback này giúp ĐiĐâu tránh học sai từ việc bạn chỉ “đi cho xong”.
          </p>

          <div className="rating-stars plan-feedback-stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                aria-label={star + " sao"}
                className={
                  planOutcomeRating >= star
                    ? "rating-star rating-star--active"
                    : "rating-star"
                }
                onClick={() => setPlanOutcomeRating(star)}
              >
                <StarIcon />
              </button>
            ))}
          </div>

          <fieldset className="dialog-fieldset">
            <legend>Có muốn đi một route kiểu này lần nữa?</legend>
            <div className="segmented">
              <button
                type="button"
                className={planWouldRepeat === true ? "is-active" : ""}
                onClick={() => setPlanWouldRepeat(true)}
              >
                Có
              </button>
              <button
                type="button"
                className={planWouldRepeat === null ? "is-active" : ""}
                onClick={() => setPlanWouldRepeat(null)}
              >
                Chưa chắc
              </button>
              <button
                type="button"
                className={planWouldRepeat === false ? "is-active" : ""}
                onClick={() => setPlanWouldRepeat(false)}
              >
                Không
              </button>
            </div>
          </fieldset>

          <label className="field">
            <span>Điều gì đáng nhớ? (không bắt buộc)</span>
            <textarea
              rows={3}
              value={planFeedbackNote}
              onChange={(event) =>
                setPlanFeedbackNote(event.target.value.slice(0, 300))
              }
              placeholder="Ví dụ: route hợp lý nhưng quán cuối quá ồn…"
            />
          </label>

          <button
            className="primary-button primary-button--wide"
            type="submit"
          >
            Lưu cảm nhận
          </button>
        </form>
      </dialog>

      <dialog className="app-dialog" ref={shareManagerDialogRef}>
        <div className="dialog-card share-manager-card">
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Capability links</span>
              <h2>Itinerary đang được chia sẻ</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => shareManagerDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            Ai có link đều xem được snapshot read-only. Thu hồi link sẽ làm URL đó ngừng hoạt động ngay.
          </p>

          {itineraryShares.length > 0 ? (
            <div className="share-manager-list">
              {itineraryShares.map((share) => (
                <article className="share-manager-item" key={share.slug}>
                  <div className="share-manager-item__body">
                    <span className="eyebrow">
                      {share.sourceKind === "completed"
                        ? "Plan đã đi"
                        : share.sourceKind === "active"
                          ? "Plan đang đi"
                          : "Phương án"}
                    </span>
                    <strong>
                      {share.plan.scenario
                        ? scenarioLabels[share.plan.scenario]
                        : "Plan cá nhân"}
                      {" · "}
                      {share.plan.stops.length} chặng
                    </strong>
                    <small>
                      {share.plan.stops.map((stop) => stop.name).join(" → ")}
                    </small>
                    <span>
                      Tạo {formatVisitedAt(share.createdAt)} · /s/{share.slug}
                    </span>
                  </div>
                  <div className="share-manager-item__actions">
                    <a
                      href={"/s/" + share.slug}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Mở
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyItineraryShare(share.slug)}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="share-manager-item__revoke"
                      disabled={shareLoading}
                      onClick={() =>
                        void revokeOwnedItineraryShare(share.slug)
                      }
                    >
                      Thu hồi
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="share-manager-empty">
              <strong>Chưa có link nào đang hoạt động.</strong>
              <span>
                Tạo một plan rồi bấm “Chia sẻ”; link sẽ xuất hiện ở đây.
              </span>
            </div>
          )}
        </div>
      </dialog>

      <dialog className="app-dialog" ref={profileTransferDialogRef}>
        <div className="dialog-card profile-transfer-card">
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Profile continuity</span>
              <h2>Profile & dữ liệu</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => profileTransferDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            Chuyển profile sang trình duyệt khác hoặc xóa toàn bộ dữ liệu của profile hiện tại. Mã chuyển chỉ dùng một lần và hết hạn sau 10 phút.
          </p>

          <section className="profile-transfer-section">
            <div>
              <span className="eyebrow">Máy hiện tại</span>
              <strong>Tạo mã chuyển</strong>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={profileTransferLoading}
              onClick={() => void createProfileTransfer()}
            >
              {profileTransferLoading ? "Đang tạo…" : "Tạo mã 10 phút"}
            </button>
            {profileTransferCode ? (
              <div className="profile-transfer-code">
                <code>{profileTransferCode}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(profileTransferCode)}
                >
                  Copy
                </button>
              </div>
            ) : null}
            {profileTransferExpiresAt ? (
              <small>
                Hết hạn: {new Date(profileTransferExpiresAt).toLocaleTimeString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </small>
            ) : null}
          </section>

          <section className="profile-transfer-section">
            <div>
              <span className="eyebrow">Máy mới</span>
              <strong>Nhập mã đã nhận</strong>
            </div>
            <input
              type="text"
              value={profileTransferInput}
              onChange={(event) =>
                setProfileTransferInput(event.target.value.toUpperCase().slice(0, 14))
              }
              placeholder="ABCD-EFGH-IJKL"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="primary-button primary-button--wide"
              disabled={profileTransferLoading || !profileTransferInput.trim()}
              onClick={() => void redeemProfileTransfer()}
            >
              Dùng profile này
            </button>
          </section>

          <section className="profile-reset-section">
            <div>
              <span className="eyebrow">Danger zone</span>
              <strong>Xóa toàn bộ dữ liệu profile</strong>
              <small>
                Xóa vĩnh viễn địa điểm, Saved, rating, visits, collections, daily discovery, active/completed plans, ảnh tải lên, planner defaults/metrics, transfer codes và mọi link itinerary đã chia sẻ. Sau đó trình duyệt nhận một anonymous profile mới. Backup JSON chỉ giữ dữ liệu có cấu trúc, không chứa file ảnh tải lên.
              </small>
            </div>

            <button
              type="button"
              className="secondary-button"
              disabled={backupLoading || profileResetLoading}
              onClick={() => void exportBackup()}
            >
              {backupLoading ? "Đang xuất…" : "Xuất backup dữ liệu"}
            </button>

            <label>
              <span>Nhập XOA để xác nhận</span>
              <input
                type="text"
                value={profileResetConfirm}
                onChange={(event) =>
                  setProfileResetConfirm(
                    event.target.value.toUpperCase().slice(0, 3)
                  )
                }
                placeholder="XOA"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <button
              type="button"
              className="profile-reset-button"
              disabled={
                profileResetLoading ||
                profileResetConfirm.trim().toUpperCase() !== "XOA"
              }
              onClick={() => void resetCurrentProfile()}
            >
              {profileResetLoading
                ? "Đang xóa dữ liệu…"
                : "Xóa dữ liệu & tạo profile mới"}
            </button>
          </section>
        </div>
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

      <dialog className="app-dialog app-dialog--daily" ref={dailyDialogRef}>
        <div className="dialog-card daily-discovery-dialog">
          <div className="dialog-header">
            <div>
              <span className="eyebrow">Khám phá hôm nay</span>
              <h2>Mỗi ngày một thứ mới</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => dailyDialogRef.current?.close()}
              aria-label="Đóng"
            >
              <CloseIcon />
            </button>
          </div>

          <p className="dialog-copy">
            Quán hôm nay được giữ cố định trong ngày và ưu tiên nơi bạn chưa đi. Route hôm nay đổi theo ngày nhưng vẫn theo gu, thời tiết, budget và giờ mở cửa.
          </p>

          <section className="daily-insights" aria-label="Khám phá 7 ngày qua">
            <div>
              <span>7 ngày qua</span>
              <strong>{dailyInsights.days}</strong>
              <small>ngày có khám phá</small>
            </div>
            <div>
              <span>Độ mới</span>
              <strong>{dailyInsights.uniquePlaces}</strong>
              <small>địa điểm khác nhau</small>
            </div>
            <div>
              <span>Route</span>
              <strong>{dailyInsights.routes}</strong>
              <small>lộ trình đã gợi ý</small>
            </div>
          </section>

          <section className="weekly-recap-card">
            <div className="weekly-recap-card__head">
              <div>
                <span className="eyebrow">Nhịp tuần này</span>
                <strong>
                  {weeklyFavoriteScenario
                    ? scenarioLabels[weeklyFavoriteScenario]
                    : "Đang học gu khám phá"}
                </strong>
              </div>
              <span>
                {dailyInsights.days > 0
                  ? dailyInsights.days + "/7 ngày"
                  : "Chưa có dữ liệu"}
              </span>
            </div>

            <p>
              {weeklyFavoriteScenario
                ? "Mood xuất hiện nhiều nhất trong route tuần này. ĐiĐâu vẫn đổi địa điểm để tránh biến một gu thành một vòng lặp."
                : "Tạo vài route trong tuần, ĐiĐâu sẽ bắt đầu nhận ra kiểu buổi đi bạn hay chọn."}
            </p>

            {weeklyRevisitCandidate ? (
              <button
                type="button"
                className="weekly-revisit"
                onClick={focusWeeklyRevisit}
              >
                <span>
                  <small>Đáng quay lại</small>
                  <strong>{weeklyRevisitCandidate.place.name}</strong>
                </span>
                <b>
                  ★ {weeklyRevisitCandidate.stars}/5 ·{" "}
                  {weeklyRevisitCandidate.daysSinceVisit} ngày
                </b>
              </button>
            ) : (
              <small className="weekly-recap-card__empty">
                Khi có một nơi bạn chấm từ 4★ và đã hơn 7 ngày chưa quay lại, gợi ý revisit sẽ xuất hiện ở đây.
              </small>
            )}
          </section>

          <section className="daily-place-card">
            <div className="daily-place-card__head">
              <div>
                <span className="eyebrow">Quán hôm nay</span>
                <strong>{dailyPlace?.name ?? "Chưa có đủ địa điểm"}</strong>
              </div>
              {dailyPlace ? <b>{dailyPlace.match}%</b> : null}
            </div>

            {dailyPlace ? (
              <>
                <p>
                  {dailyPlace.recommendationReasons?.[0] ??
                    "Một lựa chọn mới được cân bằng giữa độ hợp gu và sự mới mẻ."}
                </p>
                <div className="daily-place-meta">
                  <span>{distanceLabel(dailyPlace.distanceKm)}</span>
                  <span>·</span>
                  <span>{priceBadge(dailyPlace)}</span>
                  <span>·</span>
                  <span
                    className={
                      "daily-opening daily-opening--" +
                      (dailyOpening?.state ?? "unknown")
                    }
                  >
                    {dailyOpening?.label ?? "Giờ chưa rõ"}
                  </span>
                  <span>·</span>
                  <span>
                    {dailyPlaceVisited ? "Đã từng đi" : "Chưa từng đi"}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-button primary-button--wide"
                  onClick={focusDailyPlace}
                >
                  Xem quán hôm nay
                </button>
              </>
            ) : (
              <p>
                Hãy tìm khu vực này hoặc di chuyển bản đồ để có thêm địa điểm thật cho gợi ý hôm nay.
              </p>
            )}
          </section>

          <section className="daily-route-card">
            <div>
              <span className="eyebrow">Lộ trình hôm nay</span>
              <strong>Một route mới theo ngày</strong>
              <p>
                Tạo 1–3 chặng từ dữ liệu quanh bản đồ, ưu tiên nơi mới và tránh các điểm đã xuất hiện trong route 7 ngày gần đây khi có thể.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={planWeatherLoading || rankedAll.length === 0}
              onClick={() => void openDailyRoute()}
            >
              ◫ Tạo route hôm nay
            </button>
          </section>

          <small className="daily-discovery-note">
            Lịch sử khám phá được lưu theo profile để giảm lặp giữa các phiên. Route vẫn tự nới quy tắc novelty nếu cần để ghép đủ chặng.
          </small>
        </div>
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

          {planAnchor ? (
            <section className="plan-replay-banner">
              <div>
                <span className="eyebrow">Mốc từ poll nhóm</span>
                <strong>{planAnchor.name}</strong>
                <small>
                  Planner dùng chỗ này làm tâm route và ưu tiên giữ nó nếu vẫn
                  phù hợp giờ mở cửa, khoảng cách, budget và thời lượng.
                </small>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPlanAnchor(null);
                  setActivePlan(null);
                  planAnchorDiscoveryStartedRef.current = false;
                }}
              >
                Bỏ mốc nhóm
              </button>
            </section>
          ) : null}

          {planReplayTemplate ? (
            <section className="plan-replay-banner">
              <div>
                <span className="eyebrow">Replay template</span>
                <strong>
                  Ưu tiên {planReplayTemplate.stops.length} chặng từ buổi trước
                </strong>
                <small>
                  Planner kiểm tra lại thời tiết, giờ mở cửa, road routing và budget; chặng không còn phù hợp sẽ được thay.
                </small>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPlanReplayTemplate(null);
                  setActivePlan(null);
                }}
              >
                Bỏ template
              </button>
            </section>
          ) : null}

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
              <span>Di chuyển</span>
              <select
                value={planRoutingMode}
                onChange={(event) => {
                  const value = event.target.value as RoutingMode;
                  setPlanRoutingMode(value);
                  setActivePlan(null);
                  void persistPlannerDefaults({ routeMode: value });
                }}
              >
                <option value="motorcycle">Xe máy</option>
                <option value="drive">Ô tô</option>
                <option value="walk">Đi bộ</option>
              </select>
            </label>

            <label className="field">
              <span>Budget / 2 người</span>
              <select
                value={planBudget}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPlanBudget(value);
                  setActivePlan(null);
                  setPlanWeather(null);
                  void persistPlannerDefaults({ budgetForTwo: value });
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
                  const value = Number(event.target.value) as 2 | 3 | 4;
                  setPlanDuration(value);
                  setActivePlan(null);
                  setPlanWeather(null);
                  void persistPlannerDefaults({ durationHours: value });
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
                  const value = Number(event.target.value) as 3 | 5 | 8 | 12;
                  setPlanDistance(value);
                  setActivePlan(null);
                  setPlanWeather(null);
                  void persistPlannerDefaults({ maxDistanceKm: value });
                }}
              >
                <option value={3}>3 km</option>
                <option value={5}>5 km</option>
                <option value={8}>8 km</option>
                <option value={12}>12 km</option>
              </select>
            </label>
          </div>
          <small className="planner-defaults-note">
            Di chuyển, budget, bán kính và thời lượng được lưu theo profile này.
          </small>

          {providerCostCalibration.sampleSize > 0 ? (
            <section className="cost-calibration-strip">
              <div>
                <span className="eyebrow">Giá provider đang học</span>
                <strong>
                  {providerCostCalibration.sampleSize} giá thật đã đối chiếu
                </strong>
              </div>
              <small>
                {Object.keys(providerCostCalibration.byFamily).length > 0
                  ? Object.keys(providerCostCalibration.byFamily).length +
                    " nhóm đã đủ mẫu để hiệu chỉnh"
                  : providerCostCalibration.overallMultiplier
                    ? "Đã đủ mẫu để hiệu chỉnh baseline chung"
                    : "Cần thêm vài giá thật để tự hiệu chỉnh baseline"}
              </small>
            </section>
          ) : null}

          {plannerCostProfile.sampleSize > 0 ? (
            <div className="plan-cost-learning">
              <div>
                <span className="eyebrow">Budget đang học</span>
                <strong>
                  {plannerCostProfile.sampleSize} địa điểm có chi phí thực
                </strong>
              </div>
              <div className="plan-cost-learning__chips">
                {plannerCostProfile.byStage.food ? (
                  <span>Ăn ~{moneyLabel(plannerCostProfile.byStage.food)}</span>
                ) : null}
                {plannerCostProfile.byStage.activity ? (
                  <span>Chơi ~{moneyLabel(plannerCostProfile.byStage.activity)}</span>
                ) : null}
                {plannerCostProfile.byStage.coffee ? (
                  <span>Cafe ~{moneyLabel(plannerCostProfile.byStage.coffee)}</span>
                ) : null}
              </div>
              <small>
                Nơi chưa có giá riêng sẽ dùng median theo loại trải nghiệm trước khi dùng mức mặc định.
              </small>
            </div>
          ) : (
            <div className="plan-cost-learning plan-cost-learning--empty">
              <span>
                Thêm “Chi phí 2 người” ở các địa điểm đã lưu để planner ước lượng budget sát thực tế hơn.
              </span>
            </div>
          )}

          {dataRepairPrompts.length > 0 ? (
            <section className="data-repair-backlog">
              <div>
                <span className="eyebrow">Dữ liệu cần bổ sung</span>
                <strong>
                  {dataRepairPrompts.length} nơi đã lưu còn thiếu dữ liệu quan trọng
                </strong>
              </div>
              <small>
                {dataRepairPrompts[0]?.lowQualityAppearances
                  ? dataRepairPrompts[0].name +
                    " đã xuất hiện trong " +
                    dataRepairPrompts[0].lowQualityAppearances +
                    " plan quality thấp."
                  : dataRepairPrompts[0]?.recurring
                    ? dataRepairPrompts[0].name +
                      " đã lặp lại trong " +
                      dataRepairPrompts[0].planAppearances +
                      " plan."
                    : "Planner sẽ ưu tiên nhắc các nơi xuất hiện nhiều trong lịch sử."}
              </small>
            </section>
          ) : null}

          <button
            className="primary-button primary-button--wide"
            type="button"
            disabled={
              planWeatherLoading || Boolean(planAnchor && viewportLoading)
            }
            onClick={() => void generatePlan(0)}
          >
            {planAnchor && viewportLoading
              ? "Đang tìm địa điểm quanh mốc…"
              : planWeatherLoading
                ? "Đang xem dự báo…"
                : planReplayTemplate
                  ? "Tạo lại plan hôm nay"
                  : planAnchor
                    ? "Tạo kế hoạch quanh mốc nhóm"
                    : "Tạo kế hoạch"}
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

              {activePlan.replay ? (
                <section className="plan-replay-result">
                  <div className="plan-replay-result__summary">
                    <strong>
                      Giữ {activePlan.replay.retainedStopIds.length}/
                      {activePlan.replay.originalStopCount} chặng cũ
                    </strong>
                    <span>
                      {activePlan.replay.replacedStopCount > 0
                        ? "Đã thay " +
                          activePlan.replay.replacedStopCount +
                          " chặng theo điều kiện hôm nay."
                        : "Route cũ vẫn vượt qua các kiểm tra hiện tại."}
                    </span>
                  </div>

                  {activePlan.replay.replacements.length > 0 ? (
                    <div className="plan-replay-reasons">
                      {activePlan.replay.replacements.map(
                        (replacement) => (
                          <div
                            key={
                              replacement.stage +
                              ":" +
                              replacement.originalPlaceId
                            }
                          >
                            <b>
                              {replacement.originalName}
                              {replacement.replacementName
                                ? " → " + replacement.replacementName
                                : ""}
                            </b>
                            <small>{replacement.reason}</small>
                          </div>
                        )
                      )}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {activePlanQuality ? (
                <section
                  className={
                    "plan-quality-card plan-quality-card--" +
                    activePlanQuality.level
                  }
                >
                  <div className="plan-quality-card__score">
                    <span>Plan Quality</span>
                    <strong>{activePlanQuality.score}</strong>
                    <small>/100</small>
                  </div>
                  <div className="plan-quality-card__body">
                    <strong>{activePlanQuality.label}</strong>
                    <span>
                      Road {Math.round(activePlanQuality.routingCoverage * 100)}%
                      {" · "}Giờ mở cửa{" "}
                      {Math.round(activePlanQuality.openingCoverage * 100)}%
                    </span>
                    {activePlanQuality.issues[0] ? (
                      <small>{activePlanQuality.issues[0]}</small>
                    ) : (
                      <small>
                        Các dữ liệu quan trọng của phương án đều đã được xác minh ở mức tốt.
                      </small>
                    )}
                  </div>
                </section>
              ) : null}

              {activePlanRepairPrompts.length > 0 ? (
                <section className="plan-data-repair">
                  <div className="plan-data-repair__head">
                    <div>
                      <span className="eyebrow">Tăng độ tin cậy</span>
                      <strong>
                        Sửa dữ liệu của {activePlanRepairPrompts.length} nơi trong plan
                      </strong>
                    </div>
                    <small>Ưu tiên nơi đã dùng nhiều lần</small>
                  </div>

                  <div className="plan-data-repair__list">
                    {activePlanRepairPrompts.map((prompt) => (
                      <div key={prompt.placeId}>
                        <div>
                          <strong>{prompt.name}</strong>
                          <small>{prompt.reason}</small>
                        </div>
                        <div className="plan-data-repair__actions">
                          {prompt.issues.includes("opening_hours") ? (
                            <button
                              type="button"
                              onClick={() =>
                                void refreshPlaceOpeningHours(prompt.placeId)
                              }
                            >
                              Giờ mở cửa
                            </button>
                          ) : null}
                          {prompt.issues.includes("cost") ? (
                            <button
                              type="button"
                              onClick={() => repairPlaceCost(prompt.placeId)}
                            >
                              Sửa giá
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

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

              <div
                className={
                  "plan-routing-status" +
                  (activePlan.roadRoutedLegs > 0
                    ? " plan-routing-status--road"
                    : "")
                }
              >
                <strong>
                  {activePlan.roadRoutedLegs > 0
                    ? "✓ Road routing"
                    : "≈ Travel estimate"}
                </strong>
                <span>
                  {activePlan.roadRoutedLegs > 0
                    ? activePlan.roadRoutedLegs +
                      "/" +
                      activePlan.stops.length +
                      " chặng có khoảng cách đường thực tế · " +
                      routingModeLabels[activePlan.routeMode]
                    : "Geoapify routing chưa khả dụng; đang dùng fallback " +
                      routingModeLabels[activePlan.routeMode].toLowerCase() +
                      " theo khoảng cách thẳng."}
                </span>
              </div>

              {activePlan.unknownOpeningHoursCount > 0 ? (
                <div className="plan-warning plan-warning--neutral">
                  {activePlan.unknownOpeningHoursCount} chặng chưa có giờ mở cửa đủ rõ để xác minh. Các địa điểm biết chắc đã đóng ở giờ dự kiến đã được loại khỏi plan.
                </div>
              ) : (
                <div className="plan-opening-confirmed">
                  ✓ Các chặng có dữ liệu giờ mở cửa đều phù hợp với lịch dự kiến.
                </div>
              )}

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
                        {" · "}
                        {stop.openingHoursStatus === "confirmed"
                          ? "✓ giờ mở cửa"
                          : "giờ chưa rõ"}
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

              <div className="plan-actions plan-actions--four">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={planWeatherLoading}
                  onClick={() =>
                    void generatePlan(
                      planVariant + 1,
                      planScenario,
                      planStartTime,
                      undefined,
                      undefined,
                      "rerolled"
                    )
                  }
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
                  className="secondary-button"
                  disabled={shareLoading}
                  onClick={() =>
                    void sharePlanSnapshot(
                      toActivePlanSnapshot(activePlan),
                      "generated"
                    )
                  }
                >
                  Chia sẻ
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={planStartLoading}
                  onClick={() => void startRunningPlan()}
                >
                  {planStartLoading ? "Đang bắt đầu…" : "Bắt đầu plan"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </dialog>
      <nav className="mobile-bottom-nav" aria-label="Điều hướng điện thoại">
        <button
          type="button"
          className={mobilePanel === "map" && view === "discover" ? "is-active" : ""}
          onClick={() => { setView("discover"); setMobilePanel("map"); }}
          aria-pressed={mobilePanel === "map" && view === "discover"}
        >
          <PinIcon /><span>Bản đồ</span>
        </button>
        <button
          type="button"
          className={mobilePanel === "list" && view === "discover" ? "is-active" : ""}
          onClick={() => { setView("discover"); setMobilePanel("list"); }}
          aria-pressed={mobilePanel === "list" && view === "discover"}
        >
          <SearchIcon /><span>Khám phá</span>
        </button>
        <button
          type="button"
          className={view === "saved" ? "is-active" : ""}
          onClick={() => switchView("saved")}
          aria-pressed={view === "saved"}
        >
          <HeartIcon /><span>Đã lưu</span>
        </button>
        <button
          type="button"
          className={view === "mine" ? "is-active" : ""}
          onClick={() => switchView("mine")}
          aria-pressed={view === "mine"}
        >
          <StarIcon /><span>Thư viện</span>
        </button>
        <button type="button" onClick={openPlanBuilder}>
          <PlusIcon /><span>Lịch trình</span>
        </button>
      </nav>
    </main>
  );
}
