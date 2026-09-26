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
- OpenStreetMap/Nominatim search and import;
- smarter personal ranking with visible recommendation reasons;
- collection-based recommendations;
- duplicate-safe provider imports;
- PostGIS-backed nearby distance lookup for persisted places;
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

Tables have RLS enabled but expose no policies to `anon` or `authenticated`.

The Next.js server uses a **Supabase secret key** only on the backend. The server performs owner scoping before every query.

Do not create a `NEXT_PUBLIC_SUPABASE_SECRET_KEY`.

Required environment variables:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Map styling remains public:

```bash
NEXT_PUBLIC_MAP_STYLE_URL=https://demotiles.maplibre.org/style.json
```

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

1. use PostGIS for viewport/bounding-box discovery, not only nearby distance;
2. enrich provider imports with better opening-hours/price metadata;
3. add lightweight "Surprise me" from personal ranking;
4. add time/weather-aware signals when the base loop has enough usage data;
5. Supabase Auth only when account recovery/multi-device sync is worth the friction;
6. Groups and group voting after the personal loop is mature.
