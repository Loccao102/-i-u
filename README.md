# ĐiĐâu

**Đúng chỗ, đúng lúc, đúng người.**

ĐiĐâu is a minimal, context-aware map for small groups. It helps answer a practical question: **“Trong hoàn cảnh này, nhóm mình nên đi đâu?”**

## MVP

The first web slice is deliberately small:

- full-screen map-first discovery;
- context chips: Date, Bạn bè, Ăn uống, Cafe, Vui chơi, Chill;
- natural-language-ish local search;
- nearby ranking with explicit opt-in browser location;
- place detail focused on group signal, not public popularity;
- quick rating;
- add-place flow with safe plain-text handling and automatic context suggestions;
- responsive desktop/mobile layout.

No fake authentication or insecure persistent group backend is included. The current data is demo/session-only until a proper authenticated persistence boundary is implemented.

## Stack

- Next.js 16
- React 19
- TypeScript
- MapLibre GL JS
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

Precise location is requested **only after the user presses “Vị trí của tôi”** and remains in memory for the current session.

See [docs/SECURITY.md](docs/SECURITY.md) before adding authentication, persistence, uploads, third-party AI, or paid map/search providers.

## Next product slices

1. authenticated groups + invite flow;
2. PostgreSQL/PostGIS persistence;
3. server-side nearby search and ranking;
4. group ratings and visit history;
5. group decision/voting;
6. provider-backed POI import;
7. server-side AI intent/category extraction.
