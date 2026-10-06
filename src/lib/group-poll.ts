import type {
  GroupPollCandidate,
  GroupPollCandidateResult,
  Place
} from "./types";

export const GROUP_POLL_DURATION_MS = 24 * 60 * 60 * 1000;

function cleanText(value: unknown, max: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function finiteNumber(value: unknown, min: number, max: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) throw new Error("INVALID_BODY");
  return Math.min(max, Math.max(min, parsed));
}

function parseGroupPollCandidate(value: unknown): GroupPollCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_BODY");
  }

  const row = value as Record<string, unknown>;
  const placeId = cleanText(row.placeId, 180);
  const name = cleanText(row.name, 100);

  if (!placeId || !name) throw new Error("INVALID_BODY");

  return {
    placeId,
    name,
    kind: cleanText(row.kind, 80, "Địa điểm"),
    latitude: finiteNumber(row.latitude, -90, 90),
    longitude: finiteNumber(row.longitude, -180, 180),
    address: cleanText(row.address, 220),
    averageForTwo: cleanText(
      row.averageForTwo,
      80,
      "Chưa có dữ liệu"
    ),
    publicRating: finiteNumber(row.publicRating ?? 0, 0, 5),
    match: Math.round(finiteNumber(row.match ?? 0, 0, 100))
  };
}

export function groupPollCandidateFromPlace(
  place: Place
): GroupPollCandidate {
  return parseGroupPollCandidate({
    placeId: place.id,
    name: place.name,
    kind: place.kind,
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address,
    averageForTwo: place.averageForTwo,
    publicRating: place.publicRating ?? 0,
    match: place.match ?? 0
  });
}

export function parseGroupPollCandidates(
  value: unknown
): GroupPollCandidate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new Error("INVALID_BODY");
  }

  const seen = new Set<string>();
  const candidates = value.map(parseGroupPollCandidate);

  for (const candidate of candidates) {
    if (seen.has(candidate.placeId)) throw new Error("INVALID_BODY");
    seen.add(candidate.placeId);
  }

  return candidates;
}

export function isGroupPollOpen(
  poll: {
    closedAt: string | null;
    expiresAt: string;
  },
  nowMs = Date.now()
) {
  const expiresAt = new Date(poll.expiresAt).getTime();

  return (
    poll.closedAt === null &&
    Number.isFinite(expiresAt) &&
    expiresAt > nowMs
  );
}

export type GroupPollOutcome = {
  state: "no_votes" | "winner" | "tie";
  leaderVotes: number;
  leaders: GroupPollCandidateResult[];
};

export function deriveGroupPollOutcome(
  candidates: GroupPollCandidateResult[]
): GroupPollOutcome {
  const leaderVotes = Math.max(
    0,
    ...candidates.map((candidate) => candidate.votes)
  );
  const leaders =
    leaderVotes > 0
      ? candidates.filter((candidate) => candidate.votes === leaderVotes)
      : [];

  return {
    state:
      leaders.length === 0
        ? "no_votes"
        : leaders.length === 1
          ? "winner"
          : "tie",
    leaderVotes,
    leaders
  };
}
