# Supabase setup

## 1. Create or choose a Supabase project

Use a hosted Supabase project for development/staging.

Choose a region close to the expected primary users.

## 2. Apply the schema

Apply all files in `supabase/migrations/` in order. The baseline is:

```text
supabase/migrations/0001_personal_core.sql
```

Recent incremental migrations:

```text
supabase/migrations/20260927063759_daily_discovery_history.sql
supabase/migrations/20260927065815_provider_cost_estimates.sql
supabase/migrations/20260927071744_completed_plan_history.sql
supabase/migrations/20260927072104_completed_plan_history_update_grant.sql
supabase/migrations/20260927072239_archive_completed_plan_atomically.sql
supabase/migrations/20260927072447_completed_plan_owner_scope.sql
supabase/migrations/20260927072518_archive_completed_plan_owner_scope.sql
supabase/migrations/20260927073327_completed_plan_feedback.sql
supabase/migrations/20260927081109_personal_planner_defaults.sql
supabase/migrations/20260927083839_profile_transfer_codes.sql
supabase/migrations/20260927094900_public_itinerary_shares.sql
supabase/migrations/20260927095409_encrypt_profile_transfer_tokens.sql
supabase/migrations/20260927152302_planner_telemetry.sql
supabase/migrations/20260927172009_planner_telemetry_semantics.sql
supabase/migrations/20260927172409_reset_planner_telemetry_after_semantics_change.sql
supabase/migrations/20260927173434_idempotent_active_plan_start.sql
supabase/migrations/20260927174110_idempotent_personal_visits.sql
supabase/migrations/20260927174553_idempotent_personal_visits_optional_rating.sql
supabase/migrations/20260928165500_group_polls_mvp.sql
supabase/migrations/20261006202520_atomic_group_poll_vote.sql
supabase/migrations/20260927153331_profile_data_reset.sql
```

The provider-cost migration adds `cost_source` and `cost_confidence` to
`personal_places`. Existing non-empty costs are backfilled as user-entered;
new provider estimates remain explicitly distinguishable from real prices.

Apply with one of:

- Supabase SQL Editor;
- Supabase CLI migrations;
- connected Supabase tooling.

The migration is idempotent for tables/indexes and uses `create or replace function` for RPCs.

## 3. Get server credentials

From the project's Connect / API keys UI, obtain:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Use the current secret-key format (`sb_secret_...`) on the server.

Do not use the secret key in browser code.

## 4. Local environment

Create `.env.local`:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REPLACE_ME
NEXT_PUBLIC_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
```

Then:

```bash
npm install
npm run dev
```

## 5. Vercel

Add the two Supabase variables as Vercel environment variables for the environments you use:

- Preview;
- Production;
- optionally Development.

They must remain server-only.

No SQLite file or persistent volume is required.

## 6. PostGIS

The migration installs PostGIS into:

```text
extensions
```

It creates:

```text
personal_places.location geography(Point, 4326)
```

as a generated column and a GIST index.

The first geo RPC is:

```text
nearby_personal_places(owner_key, lat, long, limit)
```

It is intentionally restricted to the service role.

## 7. RLS posture

RLS is enabled on all personal tables.

At this stage:

- browser clients do not query Supabase directly;
- `anon` and `authenticated` have no table access;
- server-only secret-key requests use the elevated role;
- Next.js performs anonymous owner scoping.

This minimizes public surface area until Supabase Auth is deliberately introduced.

## 8. Verify after migration

In Supabase, verify:

```sql
select extname, extnamespace::regnamespace
from pg_extension
where extname = 'postgis';

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'personal_places',
    'saved_places',
    'personal_ratings',
    'visits',
    'collections',
    'collection_places',
    'active_personal_plans',
    'place_user_photos',
    'recommendation_feedback',
    'daily_discoveries',
    'completed_personal_plans',
    'personal_planner_defaults',
    'profile_transfer_codes',
    'public_itinerary_shares',
    'personal_planner_metrics'
  );
```

Expected:

- PostGIS exists in the dedicated extensions schema;
- all personal tables, including `daily_discoveries`, `completed_personal_plans`, and `personal_planner_defaults`, show RLS enabled;
- `anon` and `authenticated` remain revoked from personal tables while the server secret role owns CRUD.

## 9. Do not enable Auth yet just because Supabase provides it

The current product is intentionally frictionless and personal-first.

Add Auth when one of these becomes necessary:

- multi-device sync tied to a person;
- account recovery;
- shared groups;
- invitations;
- public/private profiles.


### Public itinerary shares

Public itinerary shares are capability links. The browser never receives the
owner key or Supabase service key. The public page reads a sanitized plan
snapshot server-side and exposes only route/timeline fields required to view
the itinerary.

The share page is marked `noindex`. Anyone who has the URL can view it until
the owner revokes the share. Browser roles still have deny-all RLS on
`public_itinerary_shares`.

### Profile transfer token hardening

The profile transfer table stores only AES-GCM ciphertext derived from the
one-time transfer code. Raw profile tokens are not stored in the database.
Redeeming a code deletes the matching row and returns the ciphertext in one
database mutation, so a successful code cannot be redeemed twice.


### Planner telemetry

Planner telemetry is intentionally aggregate-only. The database stores one row
per anonymous owner per local Vietnam day with four counters:

- generated;
- started;
- completed;
- replayed.

No GPS trace, place ID, route snapshot, search query, or individual event row is
stored for this telemetry. Browser roles have deny-all RLS on
`personal_planner_metrics`; increments happen server-side through the
service-role-only `increment_personal_planner_metric` function.

Planner telemetry is not included in JSON backup/import. Profile transfer keeps
the same owner identity, so existing counters naturally remain with that
profile.


### Profile data reset

The server-only `delete_personal_profile(owner_key)` RPC deletes every current
owner-scoped database row across the personal core, including saved places,
ratings, visits, collections, recommendation feedback, daily discoveries,
active/completed plans, planner defaults/metrics, transfer codes and public
itinerary-share records.

Uploaded photo objects are removed from the private Storage bucket before the
database RPC runs. The browser cookie is rotated only after Storage cleanup and
the database reset both succeed. This means a server failure does not switch the
browser to a new owner identity while old profile rows are still present.

Reset requires the explicit confirmation string `XOA` and an additional UI
confirmation. JSON backup does not contain uploaded photo binaries.


### Planner telemetry semantics

Planner telemetry is deliberately coarse and profile-scoped. It stores daily
counters only; it does not store GPS traces or route coordinates.

The conversion denominator uses `initial_generated_count`, not total
successful generations. Rerolls are counted separately so repeatedly pressing
“Đổi phương án” does not artificially lower start conversion.

The first legacy telemetry rows are deleted once by migration because their
`generated_count` mixed initial generations and rerolls. This reset affects
derived counters only, not places, plans, visits, ratings, photos or feedback.

Current counters:

- successful generation attempts;
- initial generations;
- rerolls;
- failed generations;
- started plans;
- completed plans;
- replay starts;
- canceled plans.

Planner Health is derived in the app only after minimum sample thresholds.
These counters do not automatically modify ranking, budget or radius.


### Idempotent active-plan start

`start_active_personal_plan` serializes starts per anonymous owner with a
transaction-scoped advisory lock. If the same plan snapshot is retried while
the active plan is still pristine (first stop, no completed/skipped stops), the
RPC returns the existing active-plan ID with `created=false`.

Only a genuinely new/replaced active plan returns `created=true`, so
`started` and `replayed` telemetry are not inflated by network retries,
double-clicks or concurrent tabs. Starting the same route after progress has
already been made is treated as an intentional restart and creates a new ID.


### Idempotent personal visits

`add_personal_visit_if_new` serializes visit writes for one
`owner_key + place_id` pair and reuses an existing visit within a two-hour
window around the requested visit time.

Manual check-in, rating flows that request a visit, and active-plan completion
all go through this same primitive. This removes the previous check-then-insert
race between tabs/retries. If a duplicate request carries a rating and the
existing visit has no rating yet, the existing row is enriched instead of
creating a second visit.

The two-hour window matches the existing product interpretation that repeated
actions at the same place during one outing should not inflate visit history.


### Atomic Group Poll voting

`cast_group_poll_vote` locks the target poll row before checking expiry/closed
state and writing the voter's choice. This makes the close-vs-vote boundary
transactional: if the owner closes first, a waiting vote sees the closed row
and fails; if the vote locks first, it commits before the close can complete.

The function also validates that the requested `place_id` still belongs to
the poll snapshot and performs the one-vote-per-anonymous-profile upsert inside
the same transaction. It is `security invoker`, executable only by the
server-side `service_role`, while browser roles remain denied.
