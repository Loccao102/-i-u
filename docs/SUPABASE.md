# Supabase setup

## 1. Create or choose a Supabase project

Use a hosted Supabase project for development/staging.

Choose a region close to the expected primary users.

## 2. Apply the schema

Apply all files in `supabase/migrations/` in order. The baseline is:

```text
supabase/migrations/0001_personal_core.sql
```

Current daily-discovery persistence is added by:

```text
supabase/migrations/20260927063759_daily_discovery_history.sql
```

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
    'daily_discoveries'
  );
```

Expected:

- PostGIS exists in the dedicated extensions schema;
- all personal tables, including `daily_discoveries`, show RLS enabled;
- `anon` and `authenticated` remain revoked from personal tables while the server secret role owns CRUD.

## 9. Do not enable Auth yet just because Supabase provides it

The current product is intentionally frictionless and personal-first.

Add Auth when one of these becomes necessary:

- multi-device sync tied to a person;
- account recovery;
- shared groups;
- invitations;
- public/private profiles.
