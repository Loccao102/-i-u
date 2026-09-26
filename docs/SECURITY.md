# Security and privacy baseline

ĐiĐâu uses Supabase PostgreSQL as the persistent store and keeps the existing anonymous personal profile model until real accounts are needed.

## Supabase secret key

The Next.js server creates a dedicated Supabase admin client with:

- `SUPABASE_URL`;
- `SUPABASE_SECRET_KEY`.

The secret key is server-only and must never be:

- prefixed with `NEXT_PUBLIC_`;
- rendered into HTML;
- returned from an API;
- committed to Git;
- used in browser code.

The client disables session persistence, refresh and URL session detection so a user Auth session cannot replace the elevated server credential.

## Anonymous profile boundary

There is no login yet.

The app generates a cryptographically random browser token and stores it in:

- an `HttpOnly` cookie;
- `SameSite=Strict`;
- `Secure` in production.

Only a SHA-256 derivative is used as `owner_key`.

Every repository read/write is scoped by `owner_key`.

This is a temporary personal MVP identity layer. It does not provide account recovery or cross-device identity.

## RLS and Data API

All personal tables have RLS enabled.

The migration:

- grants no application access to `anon` or `authenticated`;
- revokes their table access explicitly;
- grants table access only to `service_role`, which is the Postgres role used by a Supabase secret key.

No browser Supabase client is created.

When Supabase Auth is introduced later, add explicit user-owned RLS policies and switch ordinary user operations to a publishable-key RLS-scoped client where appropriate.

## PostGIS

PostGIS is installed in a dedicated `extensions` schema, not `public`.

`personal_places.location` is generated from longitude/latitude and indexed with GIST.

The included `nearby_personal_places` RPC is executable only by `service_role`.

## Delete integrity

`delete_personal_place` is a server-only RPC that atomically removes the owner's:

- collection links;
- Saved link;
- rating;
- visits;
- personal place row.

The function is revoked from `public`, `anon` and `authenticated`.

## Location privacy

Live browser GPS:

- is opt-in;
- remains in React memory;
- can be passed transiently to server-side POI search;
- is not persisted to Supabase;
- should not be intentionally logged.

Saved-place coordinates are place data, not live user position.

## State-changing APIs

Mutations:

- accept JSON;
- enforce same-origin when an Origin header is present;
- rely on SameSite=Strict profile cookies;
- validate text, coordinates, enum values and array sizes;
- scope all database work by owner key.

## POI provider

Nominatim/OpenStreetMap remains an MVP provider:

- accessed server-side only;
- requests are throttled;
- results are briefly cached;
- responses are normalized before import.

For public/high-volume traffic, replace the public endpoint with a provider/service whose usage limits fit production load.

## Future Supabase Auth

When accounts become useful:

- use Supabase Auth with server-validated sessions;
- migrate owner identity from anonymous owner key to user UUID safely;
- add user-owned RLS policies;
- preserve explicit export/delete flows;
- keep elevated secret-key clients separate from user-session clients.
