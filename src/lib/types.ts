export type Scenario =
  | "date"
  | "friends"
  | "food"
  | "coffee"
  | "fun"
  | "chill";

export type Place = {
  id: string;
  name: string;
  kind: string;
  description: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  priceLabel: "$" | "$$" | "$$$";
  averageForTwo: string;
  publicRating: number;
  personalRating?: number;
  match: number;
  communityNote: string;
  openUntil: string;
  bestTime: string;
  noise: "Yên" | "Vừa" | "Sôi động";
  crowd: "Vắng" | "Vừa" | "Đông";
  tags: string[];
  scenarios: Scenario[];
  note: string;
  accent: string;
  source?: "personal" | "provider";
  providerId?: string;
  address?: string;
  recommendationReasons?: string[];
};

export type UserLocation = {
  latitude: number;
  longitude: number;
};

export type RatingDraft = {
  stars: number;
  revisit: "yes" | "maybe" | "no";
  contexts: Scenario[];
  note: string;
};

export type PersonalRating = RatingDraft & {
  placeId: string;
  visitedAt: string;
  updatedAt: string;
};

export type VisitRecord = {
  id: string;
  placeId: string;
  visitedAt: string;
  ratingStars: number | null;
};

export type Collection = {
  id: string;
  name: string;
  description: string;
  placeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PersonalSnapshot = {
  version: 2;
  customPlaces: Place[];
  savedIds: string[];
  ratings: Record<string, PersonalRating>;
  visits: VisitRecord[];
  collections: Collection[];
};

export type PoiSearchResult = {
  provider: "openstreetmap";
  providerId: string;
  name: string;
  displayName: string;
  kind: string;
  latitude: number;
  longitude: number;
  scenarios: Scenario[];
  accent: string;
};


export type NearbyPlaceResult = {
  placeId: string;
  distanceKm: number;
};

export type PoiImportResult = {
  place: Place;
  duplicate: boolean;
};

export type PersonalBackup = {
  format: "di-dau-personal-backup";
  version: 1;
  exportedAt: string;
  data: PersonalSnapshot;
};

export type BackupImportResult = {
  places: number;
  saved: number;
  ratings: number;
  visits: number;
  collections: number;
  collectionPlaces: number;
};


export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type WeatherCondition =
  | "clear"
  | "cloudy"
  | "fog"
  | "rain"
  | "storm"
  | "snow";

export type WeatherContext = {
  condition: WeatherCondition;
  temperatureC: number;
  precipitationMm: number;
  weatherCode: number;
  isDay: boolean;
  observedAt: string;
  timezone: string;
  source: "Open-Meteo";
};

export type RecommendationContext = {
  localHour: number;
  isWeekend: boolean;
  weather: WeatherContext | null;
};

export type ViewportPlaceResult = {
  placeId: string;
  latitude: number;
  longitude: number;
};


export type PlanStage = "food" | "activity" | "coffee";

export type EveningPlanPreferences = {
  scenario: Scenario;
  budgetForTwo: number;
  maxDistanceKm: number;
  durationHours: 2 | 3 | 4;
  startTime: string;
};

export type EveningPlanStop = {
  place: Place;
  stage: PlanStage;
  stageLabel: string;
  startTime: string;
  estimatedCostForTwo: number;
  travelKmFromPrevious: number;
  reason: string;
};

export type EveningPlan = {
  stops: EveningPlanStop[];
  totalEstimatedCostForTwo: number;
  routeKm: number;
  averageMatch: number;
  withinBudget: boolean;
  summary: string;
};


export type NextPlaceSuggestion = {
  place: Place;
  distanceKm: number;
  transitionLabel: string;
  reason: string;
};


export type TasteProfile = {
  sampleSize: number;
  confidence: number;
  scenarioScores: Partial<Record<Scenario, number>>;
  priceScores: Record<Place["priceLabel"], number>;
  noiseScores: Record<Place["noise"], number>;
  crowdScores: Record<Place["crowd"], number>;
  topScenarios: Scenario[];
  preferredPrice: Place["priceLabel"] | null;
  preferredNoise: Place["noise"] | null;
  preferredCrowd: Place["crowd"] | null;
};
