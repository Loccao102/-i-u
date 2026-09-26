# ĐiĐâu

**Đúng chỗ, đúng lúc, đúng mood.**

ĐiĐâu is a minimal, personal-first map for answering one practical question:

> **Mình nên đi đâu bây giờ?**

The core is deliberately useful for one person before accounts or groups are introduced.

## Current personal core

The web app now implements:

1. **Edit / delete personal places**
   - places added manually or imported from a provider can be edited;
   - delete also removes related Saved, rating, history and collection links.

2. **Collections**
   - create, rename, describe and delete collections;
   - add/remove any place from a collection;
   - deleting a collection never deletes the place itself.

3. **Real POI search / import**
   - search OpenStreetMap/Nominatim through a server route;
   - optional current location can bias the search;
   - imported places are normalized before they enter personal data;
   - provider calls and rate limiting stay server-side.

4. **Richer place detail**
   - address when available;
   - source;
   - price level;
   - best time;
   - opening note;
   - personal rating/history;
   - Saved and collection membership.

5. **Personal ranking**
   - context match;
   - personal rating;
   - revisit intent;
   - visit count/recency;
   - Saved;
   - distance;
   - public rating only as fallback.

6. **Check-in**
   - record a visit without requiring a rating;
   - rating can be added later;
   - history is independent from Saved.

Other core behavior:

- MapLibre map;
- Date / Bạn bè / Ăn uống / Cafe / Vui chơi / Chill contexts;
- local filtering while typing;
- explicit **Vị trí của tôi** opt-in;
- current GPS position is never stored.

## Temporary persistence: SQLite

Personal data is stored server-side in SQLite using Node's built-in `node:sqlite`.

Default database:

```text
.data/di-dau.sqlite
```

Override with:

```bash
SQLITE_PATH=/absolute/path/to/di-dau.sqlite
```

SQLite contains:

- personal/imported places;
- Saved;
- ratings;
- visit history;
- collections and collection-place links.

The user's live/current GPS coordinate is never written to SQLite.

### Anonymous profile isolation

There is no account system yet.

Each browser receives a cryptographically random anonymous token in an:

```text
HttpOnly
SameSite=Strict
Secure in production
```

cookie.

SQLite rows are scoped by a SHA-256 owner key derived from that token. One browser profile therefore cannot query another profile's rows through normal application APIs.

This is a temporary personal identity boundary, not a replacement for real authentication.

## SQLite deployment limitation

SQLite is appropriate for:

- local development;
- a single personal server;
- a single-instance VPS;
- a container with a persistent volume.

It is **not** the target architecture for horizontally scaled/serverless deployments.

Before deploying multiple stateless instances, migrate personal persistence to PostgreSQL/PostGIS or another shared durable database.

See [docs/SQLITE.md](docs/SQLITE.md).

## Stack

- Next.js 16
- React 19
- TypeScript
- MapLibre GL JS
- Node `node:sqlite`
- plain CSS

No ORM or client database library is required at this stage.

## Run locally

Node 22+ is required.

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Optional:

```bash
cp .env.example .env.local
```

## Privacy

- GPS is requested only after an explicit click.
- GPS stays in React memory only.
- GPS may be sent transiently to the server to bias a POI search, but is not persisted.
- provider/API secrets must never use `NEXT_PUBLIC_*`.
- all state-changing APIs require same-origin JSON requests.

See [docs/SECURITY.md](docs/SECURITY.md).

## Next core slices

After this 1→6 milestone:

1. import/edit better opening hours and pricing data;
2. duplicate-place detection when importing providers;
3. collection-based recommendations;
4. ranking explanation: “why this place is recommended”;
5. export/import backup;
6. optional account + cloud sync;
7. only then add Groups and group voting.
