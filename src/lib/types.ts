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

export type PersonalSnapshot = {
  version: 1;
  customPlaces: Place[];
  savedIds: string[];
  ratings: Record<string, PersonalRating>;
  visits: VisitRecord[];
};
