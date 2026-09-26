import type {
  PersonalRating,
  PersonalSnapshot,
  Place,
  VisitRecord
} from "./types";

const DB_NAME = "di-dau-personal";
const DB_VERSION = 1;
const STORE_NAME = "state";
const SNAPSHOT_KEY = "snapshot";

const emptySnapshot: PersonalSnapshot = {
  version: 1,
  customPlaces: [],
  savedIds: [],
  ratings: {},
  visits: []
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Không thể mở dữ liệu cục bộ."));
  });
}

function isPlace(value: unknown): value is Place {
  if (!value || typeof value !== "object") return false;
  const place = value as Partial<Place>;
  return (
    typeof place.id === "string" &&
    typeof place.name === "string" &&
    typeof place.latitude === "number" &&
    typeof place.longitude === "number" &&
    Array.isArray(place.tags) &&
    Array.isArray(place.scenarios)
  );
}

function isPersonalRating(value: unknown): value is PersonalRating {
  if (!value || typeof value !== "object") return false;
  const rating = value as Partial<PersonalRating>;
  return (
    typeof rating.placeId === "string" &&
    typeof rating.stars === "number" &&
    rating.stars >= 1 &&
    rating.stars <= 5 &&
    Array.isArray(rating.contexts) &&
    typeof rating.visitedAt === "string"
  );
}

function isVisit(value: unknown): value is VisitRecord {
  if (!value || typeof value !== "object") return false;
  const visit = value as Partial<VisitRecord>;
  return (
    typeof visit.id === "string" &&
    typeof visit.placeId === "string" &&
    typeof visit.visitedAt === "string"
  );
}

function normalizeSnapshot(value: unknown): PersonalSnapshot {
  if (!value || typeof value !== "object") return emptySnapshot;
  const raw = value as Partial<PersonalSnapshot>;

  const customPlaces = Array.isArray(raw.customPlaces)
    ? raw.customPlaces.filter(isPlace).slice(0, 500)
    : [];

  const savedIds = Array.isArray(raw.savedIds)
    ? raw.savedIds
        .filter((item): item is string => typeof item === "string")
        .slice(0, 2000)
    : [];

  const ratings: Record<string, PersonalRating> = {};
  if (raw.ratings && typeof raw.ratings === "object") {
    for (const [placeId, rating] of Object.entries(raw.ratings)) {
      if (isPersonalRating(rating) && rating.placeId === placeId) {
        ratings[placeId] = rating;
      }
    }
  }

  const visits = Array.isArray(raw.visits)
    ? raw.visits.filter(isVisit).slice(0, 5000)
    : [];

  return {
    version: 1,
    customPlaces,
    savedIds: Array.from(new Set(savedIds)),
    ratings,
    visits
  };
}

export async function loadPersonalSnapshot(): Promise<PersonalSnapshot> {
  if (typeof indexedDB === "undefined") return emptySnapshot;
  const db = await openDb();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY);

      request.onsuccess = () => resolve(normalizeSnapshot(request.result));
      request.onerror = () =>
        reject(request.error ?? new Error("Không thể đọc dữ liệu cục bộ."));
    });
  } finally {
    db.close();
  }
}

export async function savePersonalSnapshot(
  snapshot: PersonalSnapshot
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(
        normalizeSnapshot(snapshot),
        SNAPSHOT_KEY
      );

      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Không thể lưu dữ liệu cục bộ."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Lưu dữ liệu cục bộ bị hủy."));
    });
  } finally {
    db.close();
  }
}
