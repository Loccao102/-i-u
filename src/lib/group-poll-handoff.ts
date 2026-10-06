import type {
  GroupPollCandidateResult,
  Place,
  Scenario
} from "./types";

function pollAnchorScenarios(kind: string, name: string): Scenario[] {
  const value = (kind + " " + name).toLocaleLowerCase("vi-VN");

  if (
    /restaurant|food|nhà hàng|quán ăn|bún|phở|cơm|lẩu|nướng|pizza|burger/.test(
      value
    )
  ) {
    return ["date", "friends", "food"];
  }

  if (
    /activity|sport|museum|park|vui chơi|bowling|billiard|bida|game|cinema|rạp|karaoke|workshop/.test(
      value
    )
  ) {
    return ["date", "friends", "fun"];
  }

  return ["date", "friends", "coffee", "chill"];
}

export function groupPollPlannerScenario(place: Place): Scenario {
  if (place.scenarios.includes("fun")) return "fun";
  if (place.scenarios.includes("food")) return "food";
  return "coffee";
}

export function buildGroupPollPlannerHref(
  slug: string,
  candidate: GroupPollCandidateResult
) {
  const params = new URLSearchParams({
    fromPoll: slug,
    anchorId: candidate.placeId,
    anchorName: candidate.name,
    anchorKind: candidate.kind,
    anchorLat: String(candidate.latitude),
    anchorLng: String(candidate.longitude),
    anchorAddress: candidate.address,
    anchorCost: candidate.averageForTwo,
    anchorRating: String(candidate.publicRating),
    anchorMatch: String(candidate.match)
  });

  return "/?" + params.toString();
}

export function parseGroupPollPlanAnchor(
  params: URLSearchParams,
  createId: () => string = () => globalThis.crypto.randomUUID()
): Place | null {
  if (!params.get("fromPoll")) return null;

  const name = (params.get("anchorName") ?? "").trim().slice(0, 100);
  const kind = (params.get("anchorKind") ?? "Địa điểm").trim().slice(0, 80);
  const latitude = Number(params.get("anchorLat"));
  const longitude = Number(params.get("anchorLng"));

  if (
    name.length < 2 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const sourceId = (params.get("anchorId") ?? "").trim().slice(0, 180);
  const providerId = sourceId.startsWith("provider:")
    ? sourceId.slice("provider:".length).trim() || undefined
    : undefined;
  const id = /^[0-9a-f-]{36}$/i.test(sourceId)
    ? sourceId
    : createId();
  const averageForTwo =
    (params.get("anchorCost") ?? "").trim().slice(0, 100) ||
    "Chưa có dữ liệu";
  const publicRating = Math.max(
    0,
    Math.min(5, Number(params.get("anchorRating")) || 0)
  );
  const match = Math.max(
    0,
    Math.min(100, Math.round(Number(params.get("anchorMatch")) || 72))
  );
  const scenarios = pollAnchorScenarios(kind, name);

  return {
    id,
    name,
    kind,
    description: "Địa điểm được chuyển từ poll nhóm.",
    latitude,
    longitude,
    distanceKm: 0,
    priceLabel: "$",
    averageForTwo,
    costSource: "unknown",
    costConfidence: 0,
    publicRating,
    match,
    communityNote: "Lựa chọn từ poll nhóm · dữ liệu snapshot khi tạo poll.",
    openUntil: "Chưa rõ",
    bestTime: "Theo kế hoạch nhóm",
    noise: "Vừa",
    crowd: "Vừa",
    tags: ["Vote nhóm"],
    scenarios,
    note: "",
    accent: "#7b9e87",
    source: providerId ? "provider" : "personal",
    providerId,
    address: (params.get("anchorAddress") ?? "").trim().slice(0, 260) || undefined
  };
}
