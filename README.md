# ĐiĐâu

**Đúng chỗ, đúng lúc, đúng mood.**

ĐiĐâu is a minimal, personal-first map for answering one practical question:

> **Mình nên đi đâu bây giờ?**

The core is useful for one person first. Accounts and Groups remain optional later layers.

## Current personal core

- map-first discovery;
- context search: Date / Bạn bè / Ăn uống / Cafe / Vui chơi / Chill;
- Saved;
- personal ratings;
- visit history and check-in;
- edit/delete personal places;
- collections;
- real Geoapify POI discovery for cafe / food / bar / activity places in the visible map viewport;
- controlled POI pagination: load 20 places at a time with Geoapify `offset`, capped at 100 provider results per focused query to protect the free quota;
- Geoapify text search + import for named places;
- discovery filters for place type, Wi-Fi, wheelchair access and 1/3/5/10 km radius from the current map center;
- richer outing presets: food, cafe, bar/pub, active fun, outdoor/parks, culture/museums, sport and shopping, mapped to both Geoapify categories and OSM fallback tags;
- "Đang mở" filtering from available provider `opening_hours` without bulk detail requests;
- lazy Geoapify Place Details on selection: website, phone/email, opening hours, facilities, wheelchair and parking metadata;
- 30-minute server cache for place details so opening the same place repeatedly does not burn free-tier credits;
- OpenStreetMap Nominatim/Overpass remain as a no-key fallback so the current deployment keeps working;
- safe client-side interpretation of common OSM opening_hours formats;
- temporary 2–3 place shortlist with quick comparison for match, distance, price, opening state and rating;
- recommendation feedback loop: "Không hợp gu", "Không phải lúc này", "Quá xa", "Quá đắt";
- feedback-aware ranking: durable taste learning only for real preference signals, with contextual/decaying penalties for temporary signals;
- smarter personal ranking with visible recommendation reasons;
- learned **Taste Profile** from rating, revisit intent and repeat visits; similar places inherit preference signals for scenario, price, noise and crowd level;
- collection-based recommendations;
- duplicate-safe provider imports;
- PostGIS-backed nearby distance lookup for persisted places;
- PostGIS viewport search for the map area currently on screen;
- **Surprise Me** weighted toward strong matches and places you have not over-visited;
- **Khám phá hôm nay** with profile-persisted daily place and route history: the place stays stable when the same daily candidate is available, prefers never-visited options and avoids recent daily picks across sessions;
- a compact 7-day discovery insight shows active discovery days, unique suggested places and generated routes;
- weekly discovery recap highlights the route mood that appears most often and suggests a highly rated place to revisit after at least 7 days;
- daily routes use a date seed for variety, avoid place keys used by routes in the previous 7 days when possible, and still respect personal taste, budget, distance, hourly weather forecast and scheduled opening-hours guardrails;
- time-aware ranking (morning / lunch / afternoon / evening / late);
- weather-aware ranking with visible explanation;
- compact **Evening Plan Builder** that combines 1–3 nearby stops from mood, budget, duration and radius;
- planner defaults persisted per anonymous profile for travel mode, budget, radius and duration, so the core planning setup survives reloads/sessions;
- cached Geoapify Route Matrix enrichment for up to 6 planner candidates + origin, with explicit **Xe máy / Ô tô / Đi bộ** modes passed to the provider and mode-aware Haversine travel-time fallback;
- hard planner guardrails for total budget, requested duration, maximum leg distance and scheduled opening hours, with road-aware distance/time when matrix data is available and partial-plan fallback instead of silently breaking constraints;
- **Plan Quality** confidence diagnostics (0–100) expose routing coverage, opening-hours coverage, provider-estimated cost usage, completeness and constraint fallbacks instead of hiding uncertainty;
- Plan Quality is snapshotted when an outing starts and survives into completed-plan history, so historical average/low-quality counts and recurring data problems can be measured instead of inferred after the fact;
- saved-place data repair prioritization tracks which incomplete places recur across completed plans, then surfaces actionable opening-hours and cost fixes when they affect a low-confidence plan;
- Geoapify-backed saved places can refresh missing opening hours with one tap; cost repairs open the existing trusted user-cost editor;
- plan availability verification checks both arrival and near-end time; known-closed places are rejected while unknown hours are surfaced explicitly;
- per-stop start/end time, travel time and estimated cost;
- editable real-world "chi phí 2 người" on personal/saved places;
- provider-derived cost estimates for common food / cafe / bar / activity / culture / sport / outdoor categories, clearly labeled as estimates rather than live prices;
- one-tap cost correction on estimated POIs: lower / near estimate / higher choices are persisted as user-confirmed cost and become eligible for personal budget learning;
- provider price baselines self-calibrate from confirmed provider-place prices using robust median ratios, requiring multiple samples and clamping adjustments to avoid overfitting;
- family-level calibration needs at least 2 matching corrections; overall fallback calibration needs at least 3 corrections;
- cost provenance + confidence stored per place so provider estimates never train the personal spending profile as if they were real user-entered prices;
- planner blends provider estimates with learned user medians when enough real spending data exists, while real user-entered cost always wins;
- learned budget medians by outing type (food / activity / cafe-chill) for places without explicit prices, with fixed price tiers only as the final fallback;
- multi-stop Google Maps route handoff; walking plans open as walking directions, while motorcycle/car plans use driving handoff because Maps URLs do not expose a motorcycle travel mode;
- **What next?** recommendations after a recent check-in, using transition type, time of day, cost and current personal ranking; the top heuristic candidates are re-ranked with a tiny road-routing matrix using the current plan/travel mode when available;
- persisted **active plan lifecycle**: start → resume after reload → complete/skip each stop → auto-finish;
- completed plan history is archived atomically when the final stop is completed/skipped, keeping mood, route snapshot, completed/skipped stops, cost, duration and completion time;
- completed-plan outcome learning uses only actually completed stops as positive evidence, applies a small recency-weighted scenario/place bonus, never treats skipped stops as dislike, and caps the total influence so explicit feedback and current context remain stronger;
- explicit post-plan feedback (1–5★, repeat intent, optional note) separates “finished the route” from “actually enjoyed it”; low feedback suppresses completion-based bonuses instead of inventing per-place dislikes;
- History view now shows recent completed outings alongside per-place visits;
- one active plan per anonymous profile, while completed plans are stored separately for outcome learning;
- completing a stop records a visit only when there is no recent duplicate check-in;
- active-plan progress uses expected-stop concurrency checks so stale actions from another tab cannot skip a stop;
- real place media: private user-uploaded photos in Supabase Storage;
- user-photo cover thumbnails on saved/imported place cards via a single batch request;
- optional Google Places live enrichment for photos, rating and open-now state;
- only Google Place ID is persisted; Google photo names/content are fetched live and never cached/stored;
- Google Maps attribution + photo author attribution are rendered with live content;
- JSON export/import backup with merge semantics;
- responsive web UI.

## Persistence: Supabase PostgreSQL + PostGIS

SQLite has been removed.

Persistent personal data now goes through server-side Supabase:

```text
Browser
  ↓
Next.js Route Handlers
  ↓
server-only Supabase admin client
  ↓
Supabase PostgreSQL + PostGIS
```

The browser never receives the Supabase secret key.

PostGIS is enabled in a dedicated `extensions` schema. Personal places have a generated `geography(Point, 4326)` column plus a GIST index so future nearby/viewport queries do not require a schema migration.

## Anonymous personal identity

Auth is still intentionally postponed.

Each browser gets a random anonymous profile cookie:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` in production.

The raw token is not stored in Supabase. A SHA-256 derivative is used as `owner_key`, and every server repository query scopes rows by that owner key.

This gives the current personal MVP a stable isolated identity without forcing sign-up.

## Supabase security model

Tables have RLS enabled with explicit deny-all policies for `anon` and `authenticated`.

The Next.js server uses a **Supabase secret key** only on the backend. The server performs owner scoping before every query.

Do not create a `NEXT_PUBLIC_SUPABASE_SECRET_KEY`.

Required environment variables:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Recommended real-place provider:

```bash
GEOAPIFY_API_KEY=...
```

The key stays server-only. Geoapify is used for POI search/discovery and results
are cached in-memory to reduce free-tier usage. Google Maps URLs are used only
for handoff/navigation and do not require this key.

Optional Google Places live enrichment (legacy, disabled by default):

```bash
ENABLE_GOOGLE_PLACES_ENRICHMENT=true
GOOGLE_PLACES_API_KEY=...
```

Without the explicit enable flag, the app never calls Google Places even if an
old `GOOGLE_PLACES_API_KEY` is still present in the deployment environment.

The key stays server-only. When absent, user-uploaded photos continue to work normally.

Map styling remains public:

```bash
NEXT_PUBLIC_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
```

Weather context uses Open-Meteo server-side. For the current personal/non-commercial phase, no key is required. If the app becomes commercial, configure:

```bash
OPEN_METEO_API_KEY=...
```

The server then switches to Open-Meteo's customer endpoint. Weather data is attributed in the map UI.

If `GEOAPIFY_API_KEY` is missing or Geoapify is temporarily unavailable,
POI discovery falls back to the public OpenStreetMap endpoints. To override the
Overpass fallback endpoint, configure:

```bash
OVERPASS_API_URL=https://your-overpass-instance.example/api/interpreter
```

Discovery is viewport-bounded, cached server-side, rate-limited, and never runs country-scale queries.

## Apply the database migration

The schema is versioned in `supabase/migrations/`. Apply the baseline and every incremental migration in order. Recent personal-core migrations include:

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
supabase/migrations/20260927073327_completed_plan_feedback.sql
```

Apply migrations through the Supabase SQL Editor, Supabase CLI, or the connected Supabase tooling.

See [docs/SUPABASE.md](docs/SUPABASE.md).

## Vercel

This persistence model is Vercel-ready:

- no local writable database file;
- no dependence on instance-local state;
- Supabase is shared durable storage;
- secret credentials stay in Vercel server environment variables;
- current GPS remains transient.

Before deploying, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the Vercel project environment.

## Privacy

Current/live GPS:

- is requested only after an explicit user action;
- stays in React memory;
- may be sent transiently to the Next.js POI search route;
- is not inserted into Supabase.

Stored place coordinates represent saved places, not the user's live location.

## Stack

- Next.js 16
- React 19
- TypeScript
- MapLibre GL JS
- Supabase PostgreSQL
- PostGIS
- `@supabase/supabase-js`
- plain CSS

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Next

1. add lightweight read-only itinerary sharing before full Groups;
2. add stronger long-term plan analytics only after enough real completed-plan samples exist;
3. Supabase Auth only when account recovery/multi-device sync is worth the friction;
4. Groups and group voting after the personal loop is mature.


## Manual Vercel deployment

Automatic Git deployments are disabled in `vercel.json`. GitHub CI still runs on pull requests and pushes to `main`, but production is deployed only from the manual **Deploy Vercel (Manual)** workflow.

One-time setup:

1. In Vercel: Project → Settings → Git → Deploy Hooks.
2. Create a Production deploy hook for branch `main`.
3. In GitHub: Repository → Settings → Secrets and variables → Actions.
4. Add the hook URL as the repository secret `VERCEL_DEPLOY_HOOK`.

To deploy:

1. Open GitHub → Actions → **Deploy Vercel (Manual)**.
2. Click **Run workflow** on branch `main`.
3. Enter `DEPLOY`.
4. The workflow reruns typecheck + production build before triggering Vercel.

The deploy hook URL is a secret and must never be committed to the repository.
