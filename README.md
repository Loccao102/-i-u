# ĐiĐâu

**Đúng chỗ, đúng lúc, đúng mood.**

ĐiĐâu is a minimal, context-aware personal map. The first goal is simple:

> **Mở app → tìm một chỗ phù hợp → đi → lưu lại trải nghiệm → lần sau app gợi ý tốt hơn.**

Group features are intentionally postponed. The core must be useful for one person first.

## Personal-first core

The current web slice includes:

- full-screen map-first discovery;
- context chips: Date, Bạn bè, Ăn uống, Cafe, Vui chơi, Chill;
- natural-language-ish local search;
- nearby ranking with explicit opt-in browser location;
- Saved places;
- personal ratings;
- personal visit history;
- user-added places;
- persistent local data with IndexedDB;
- responsive desktop/mobile layout.

Personal ratings are ranked ahead of public fallback ratings. Exact current location is **never persisted**.

## Local data model

These items are stored only on the current browser/device:

- places you add;
- Saved place ids;
- your ratings;
- visit history.

No account is required yet. Clearing browser site data will remove this local data.

## Stack

- Next.js 16
- React 19
- TypeScript
- MapLibre GL JS
- IndexedDB
- plain CSS

The runtime dependency surface is intentionally small.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Optional:

```bash
cp .env.example .env.local
```

## Privacy

Precise location is requested **only after the user presses “Vị trí của tôi”**. Coordinates remain in React memory for the current session and are not written to IndexedDB, localStorage, cookies, or analytics.

See [docs/SECURITY.md](docs/SECURITY.md).

## Product order

### Core first

1. personal map/search;
2. Saved;
3. personal ratings + visit history;
4. persistent user-added places;
5. edit/delete personal data;
6. collections;
7. provider-backed POI search/import;
8. smarter personal ranking.

### Later

9. optional account + encrypted/safe cloud sync;
10. groups;
11. group ratings;
12. group decision/voting;
13. server-side AI intent/category extraction.

The product should never require a group account just to answer **“Mình nên đi đâu?”**
