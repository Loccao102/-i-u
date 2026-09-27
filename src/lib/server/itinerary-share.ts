import "server-only";

import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";
import { parseActivePlanSnapshot } from "./input";
import type { Json } from "../database.types";
import type {
  ActivePlanSnapshot,
  ItineraryShareSource,
  OwnedItineraryShare,
  PublicItineraryShare
} from "../types";

function dbError(error: { message?: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message ?? "Supabase error"}`);
  }
}

function shareSlug() {
  return randomBytes(12).toString("base64url");
}

function sourceKind(value: unknown): ItineraryShareSource {
  if (
    value === "generated" ||
    value === "active" ||
    value === "completed"
  ) {
    return value;
  }
  throw new Error("INVALID_BODY");
}

function sourcePlanId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    return value;
  }
  throw new Error("INVALID_BODY");
}

function mapShare(row: {
  slug: string;
  plan: unknown;
  source_kind: string;
  created_at: string;
}): PublicItineraryShare {
  return {
    slug: row.slug,
    plan: parseActivePlanSnapshot(row.plan),
    sourceKind: sourceKind(row.source_kind),
    createdAt: row.created_at
  };
}

export async function createItineraryShare(
  ownerKey: string,
  input: {
    plan: ActivePlanSnapshot;
    sourceKind: ItineraryShareSource;
    sourcePlanId?: string | null;
  }
): Promise<PublicItineraryShare> {
  const client = getSupabaseAdmin();
  const plan = parseActivePlanSnapshot(input.plan);
  const kind = sourceKind(input.sourceKind);
  const planId = sourcePlanId(input.sourcePlanId);

  if (planId && kind !== "generated") {
    const existing = await client
      .from("public_itinerary_shares")
      .select("slug,plan,source_kind,created_at")
      .eq("owner_key", ownerKey)
      .eq("source_kind", kind)
      .eq("source_plan_id", planId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    dbError(existing.error, "Find itinerary share");
    if (existing.data) {
      return mapShare(existing.data);
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = shareSlug();
    const { data, error } = await client
      .from("public_itinerary_shares")
      .insert({
        slug,
        owner_key: ownerKey,
        plan: plan as unknown as Json,
        source_kind: kind,
        source_plan_id: planId,
        revoked_at: null
      })
      .select("slug,plan,source_kind,created_at")
      .single();

    if (!error && data) {
      return mapShare(data);
    }

    if (!/duplicate|unique/i.test(error?.message ?? "")) {
      dbError(error, "Create itinerary share");
    }
  }

  throw new Error("ITINERARY_SHARE_UNAVAILABLE");
}

export async function listOwnedItineraryShares(
  ownerKey: string
): Promise<OwnedItineraryShare[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("public_itinerary_shares")
    .select(
      "slug,plan,source_kind,source_plan_id,created_at"
    )
    .eq("owner_key", ownerKey)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  dbError(error, "List itinerary shares");

  return (data ?? []).map((row) => ({
    ...mapShare(row),
    sourcePlanId:
      typeof row.source_plan_id === "string"
        ? row.source_plan_id
        : null
  }));
}

export async function getPublicItineraryShare(
  slug: string
): Promise<PublicItineraryShare | null> {
  if (!/^[A-Za-z0-9_-]{12,32}$/.test(slug)) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("public_itinerary_shares")
    .select("slug,plan,source_kind,created_at")
    .eq("slug", slug)
    .is("revoked_at", null)
    .maybeSingle();

  dbError(error, "Get itinerary share");
  return data ? mapShare(data) : null;
}

export async function revokeItineraryShare(
  ownerKey: string,
  slug: string
) {
  if (!/^[A-Za-z0-9_-]{12,32}$/.test(slug)) {
    throw new Error("INVALID_BODY");
  }

  const { error } = await getSupabaseAdmin()
    .from("public_itinerary_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("owner_key", ownerKey)
    .eq("slug", slug)
    .is("revoked_at", null);

  dbError(error, "Revoke itinerary share");
}
