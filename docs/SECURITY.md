# Security and privacy baseline

ĐiĐâu is currently personal-first and uses a temporary server-side SQLite store.

## Anonymous profile boundary

There is no account/login system yet.

The server creates a cryptographically random 256-bit anonymous token and stores it in a cookie configured as:

- `HttpOnly`;
- `SameSite=Strict`;
- `Secure` in production;
- one-year expiry.

The raw token is not stored in SQLite. A SHA-256 derivative is used as `owner_key` and every personal repository query is scoped by that key.

This protects one anonymous browser profile from accidentally reading another profile's rows through the app. It does **not** provide identity recovery, multi-device sync, password authentication or protection if the browser cookie itself is stolen.

## SQLite

SQLite stores:

- user-added/imported places;
- Saved links;
- ratings;
- check-ins / visit history;
- collections;
- collection-place links.

SQLite does not store the user's live GPS position.

The database defaults to:

`.data/di-dau.sqlite`

and can be moved with `SQLITE_PATH`.

SQLite files, WAL and SHM files are ignored by Git.

## Location

- geolocation is requested only after a user clicks **Vị trí của tôi**;
- current coordinates stay in React memory;
- exact current coordinates are not written to SQLite, localStorage, cookies or analytics;
- coordinates can be sent transiently to the server to bias a POI search;
- server code must not log those query parameters.

Saved place coordinates are place data, not current/live user location.

## State-changing APIs

Mutations:

- use JSON;
- enforce same-origin when an Origin header is present;
- use `SameSite=Strict` profile cookies;
- validate and bound text, coordinates, enums and arrays before database writes;
- scope every write by `owner_key`.

When real authentication is added, add explicit CSRF tokens if the authentication design or cross-site use requires them.

## POI provider

OpenStreetMap/Nominatim is currently a development/MVP provider.

Provider access is server-side:

- client code does not call Nominatim directly;
- requests use a descriptive User-Agent;
- server requests are throttled to roughly one request per second;
- results are cached briefly in memory;
- responses are normalized before import.

For a public/high-volume launch, replace the public Nominatim endpoint with an approved commercial provider or a self-hosted search service and comply with the provider's usage policy.

## Secrets

- never put private API keys in `NEXT_PUBLIC_*`;
- server provider secrets belong in server-only environment variables;
- do not return provider secrets through API responses;
- do not proxy arbitrary client-provided URLs.

## User-generated content

- text is length limited;
- angle brackets are removed by shared plain-text sanitization;
- UI renders content as React text nodes;
- no personal content uses `dangerouslySetInnerHTML`.

Future image uploads must use:

- signed uploads;
- MIME and byte-size validation;
- metadata stripping;
- image decoding/re-encoding;
- non-public object storage by default.

## Deletion behavior

Deleting a personal place transactionally removes that profile's:

- collection links;
- Saved link;
- rating;
- visits;
- personal place row.

Deleting a collection only deletes the collection and its links.

## HTTP hardening

Next.js enables:

- CSP;
- frame denial;
- no MIME sniffing;
- no-referrer;
- cross-origin opener isolation;
- camera and microphone disabled by policy;
- geolocation restricted to the same origin.

Before broad public launch, move CSP toward nonce-based scripts/styles to reduce `unsafe-inline`.

## Future account/sync security

When cloud accounts are introduced:

- use server-managed sessions in `HttpOnly; Secure; SameSite=Lax/Strict` cookies;
- add revocable sessions/device history;
- add rate limits around login, provider search and mutations;
- enforce object ownership server-side;
- provide export/delete flows;
- do not treat the current anonymous cookie as an authenticated account.
