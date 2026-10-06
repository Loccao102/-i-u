import "server-only";

import { randomBytes } from "node:crypto";
import {
  GROUP_POLL_DURATION_MS,
  groupPollCandidateFromPlace,
  isGroupPollOpen,
  parseGroupPollCandidates
} from "../group-poll";
import { getSupabaseAdmin } from "./supabase";
import type { Json } from "../database.types";
import type {
  GroupPoll,
  Place
} from "../types";

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function groupPollMutationError(
  error: { message?: string } | null,
  context: string
) {
  const message = error?.message ?? "";
  for (const code of [
    "GROUP_POLL_NOT_FOUND",
    "GROUP_POLL_CLOSED",
    "INVALID_BODY"
  ]) {
    if (message.includes(code)) {
      throw new Error(code);
    }
  }

  dbError(error, context);
}

function groupPollSlug() {
  return randomBytes(12).toString("base64url");
}

function validSlug(value: string) {
  return /^[A-Za-z0-9_-]{16,32}$/.test(value);
}

function cleanText(value: unknown, max: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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
  const candidates = parseGroupPollCandidates(row.candidates);
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote.place_id, (counts.get(vote.place_id) ?? 0) + 1);
  }

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
    isOpen: isGroupPollOpen({
      closedAt: row.closed_at,
      expiresAt: row.expires_at
    }),
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
  const candidates = parseGroupPollCandidates(
    input.candidates.map(groupPollCandidateFromPlace)
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
  const placeId = cleanText(placeIdRaw, 180);
  if (!placeId) throw new Error("INVALID_BODY");

  const { error } = await getSupabaseAdmin().rpc("cast_group_poll_vote", {
    p_slug: slug,
    p_voter_key: voterKey,
    p_place_id: placeId
  });

  groupPollMutationError(error, "Vote group poll");

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
          now.getTime() + GROUP_POLL_DURATION_MS
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
