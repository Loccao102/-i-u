import "server-only";

import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import type { Json } from "../database.types";
import type {
  GroupPoll,
  GroupPollCandidate,
  Place
} from "../types";

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function groupPollSlug() {
  return randomBytes(12).toString("base64url");
}

function validSlug(value: string) {
  return /^[A-Za-z0-9_-]{16,32}$/.test(value);
}

function cleanText(value: unknown, max: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
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

function candidateFromPlace(place: Place): GroupPollCandidate {
  return {
    placeId: cleanText(place.id, 180),
    name: cleanText(place.name, 100),
    kind: cleanText(place.kind, 80, "Địa điểm"),
    latitude: finiteNumber(place.latitude, -90, 90),
    longitude: finiteNumber(place.longitude, -180, 180),
    address: cleanText(place.address, 220),
    averageForTwo: cleanText(place.averageForTwo, 80, "Chưa có dữ liệu"),
    publicRating: finiteNumber(place.publicRating ?? 0, 0, 5),
    match: Math.round(finiteNumber(place.match ?? 0, 0, 100))
  };
}

function parseCandidate(value: unknown): GroupPollCandidate {
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

function parseCandidates(value: unknown): GroupPollCandidate[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    throw new Error("INVALID_BODY");
  }

  const seen = new Set<string>();
  const candidates = value.map(parseCandidate);

  for (const candidate of candidates) {
    if (seen.has(candidate.placeId)) throw new Error("INVALID_BODY");
    seen.add(candidate.placeId);
  }

  return candidates;
}

type PollRow = {
  id: string;
  owner_key: string;
  slug: string;
  title: string;
  candidates: unknown;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
};

type VoteRow = {
  voter_key: string;
  place_id: string;
};

function mapPoll(
  row: PollRow,
  votes: VoteRow[],
  voterKey: string
): GroupPoll {
  const candidates = parseCandidates(row.candidates);
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote.place_id, (counts.get(vote.place_id) ?? 0) + 1);
  }

  const now = Date.now();
  const expiresAt = new Date(row.expires_at).getTime();
  const isOpen =
    row.closed_at === null &&
    Number.isFinite(expiresAt) &&
    expiresAt > now;

  return {
    slug: row.slug,
    title: row.title,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      votes: counts.get(candidate.placeId) ?? 0
    })),
    totalVotes: votes.length,
    myVote:
      votes.find((vote) => vote.voter_key === voterKey)?.place_id ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    isOpen,
    isOwner: row.owner_key === voterKey
  };
}

async function getPollRow(slug: string): Promise<PollRow | null> {
  if (!validSlug(slug)) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("group_polls")
    .select(
      "id,owner_key,slug,title,candidates,created_at,expires_at,closed_at"
    )
    .eq("slug", slug)
    .maybeSingle();

  dbError(error, "Get group poll");
  return data as PollRow | null;
}

export async function createGroupPoll(
  ownerKey: string,
  input: {
    title?: string;
    candidates: Place[];
  }
): Promise<GroupPoll> {
  const candidates = parseCandidates(
    input.candidates.map(candidateFromPlace)
  );
  const title =
    cleanText(input.title, 80) || "Chọn chỗ đi cùng nhau";
  const client = getSupabaseAdmin();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = groupPollSlug();
    const { data, error } = await client
      .from("group_polls")
      .insert({
        owner_key: ownerKey,
        slug,
        title,
        candidates: candidates as unknown as Json
      })
      .select(
        "id,owner_key,slug,title,candidates,created_at,expires_at,closed_at"
      )
      .single();

    if (!error && data) {
      return mapPoll(data as PollRow, [], ownerKey);
    }

    if (!/duplicate|unique/i.test(error?.message ?? "")) {
      dbError(error, "Create group poll");
    }
  }

  throw new Error("GROUP_POLL_UNAVAILABLE");
}

export async function getGroupPoll(
  slug: string,
  voterKey: string
): Promise<GroupPoll | null> {
  const row = await getPollRow(slug);
  if (!row) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("group_poll_votes")
    .select("voter_key,place_id")
    .eq("poll_id", row.id);

  dbError(error, "List group poll votes");
  return mapPoll(row, (data ?? []) as VoteRow[], voterKey);
}

export async function castGroupPollVote(
  slug: string,
  voterKey: string,
  placeIdRaw: unknown
): Promise<GroupPoll> {
  const row = await getPollRow(slug);
  if (!row) throw new Error("GROUP_POLL_NOT_FOUND");

  const expiresAt = new Date(row.expires_at).getTime();
  if (
    row.closed_at !== null ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error("GROUP_POLL_CLOSED");
  }

  const placeId = cleanText(placeIdRaw, 180);
  const candidates = parseCandidates(row.candidates);
  if (!candidates.some((candidate) => candidate.placeId === placeId)) {
    throw new Error("INVALID_BODY");
  }

  const { error } = await getSupabaseAdmin()
    .from("group_poll_votes")
    .upsert(
      {
        poll_id: row.id,
        voter_key: voterKey,
        place_id: placeId,
        updated_at: new Date().toISOString()
      },
      { onConflict: "poll_id,voter_key" }
    );

  dbError(error, "Vote group poll");

  const poll = await getGroupPoll(slug, voterKey);
  if (!poll) throw new Error("GROUP_POLL_NOT_FOUND");
  return poll;
}

export async function setGroupPollOpen(
  slug: string,
  ownerKey: string,
  openRaw: unknown
): Promise<GroupPoll> {
  if (typeof openRaw !== "boolean") throw new Error("INVALID_BODY");

  const row = await getPollRow(slug);
  if (!row) throw new Error("GROUP_POLL_NOT_FOUND");
  if (row.owner_key !== ownerKey) throw new Error("GROUP_POLL_FORBIDDEN");

  const now = new Date();
  const update = openRaw
    ? {
        closed_at: null,
        expires_at: new Date(
          now.getTime() + 24 * 60 * 60 * 1000
        ).toISOString()
      }
    : {
        closed_at: now.toISOString()
      };

  const { error } = await getSupabaseAdmin()
    .from("group_polls")
    .update(update)
    .eq("id", row.id)
    .eq("owner_key", ownerKey);

  dbError(error, openRaw ? "Reopen group poll" : "Close group poll");

  const poll = await getGroupPoll(slug, ownerKey);
  if (!poll) throw new Error("GROUP_POLL_NOT_FOUND");
  return poll;
}

