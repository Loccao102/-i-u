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
- Geoapify text search + import for named places;
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
- time-aware ranking (morning / lunch / afternoon / evening / late);
- weather-aware ranking with visible explanation;
- compact **Evening Plan Builder** that combines 1–3 nearby stops from mood, budget, duration and radius;
- hard planner guardrails for total budget, requested duration and maximum leg distance, with partial-plan fallback instead of silently breaking constraints;
- per-stop start/end time, travel time and estimated cost;
- multi-stop Google Maps route handoff;
- **What next?** recommendations after a recent check-in, using transition type, time of day, distance, travel time, cost and current personal ranking;
- persisted **active plan lifecycle**: start → resume after reload → complete/skip each stop → auto-finish;
- one active plan per anonymous profile, intentionally without calendar/history bloat;
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

The schema is versioned at:

```text
supabase/migrations/0001_personal_core.sql
```

Apply it through the Supabase SQL Editor, Supabase CLI, or the connected Supabase tooling.

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

1. add weather forecast awareness for future plans, not only current conditions;
2. add stronger discovery filters (open now, facilities, accessibility, distance);
3. improve real-world price/budget estimates from personal history and explicit user input;
4. Supabase Auth only when account recovery/multi-device sync is worth the friction;
5. Groups and group voting after the personal loop is mature.


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
