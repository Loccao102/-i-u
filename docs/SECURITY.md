# Security and privacy baseline

ĐiĐâu is designed for a small trusted group, but the implementation must not assume that every request is trusted.

## Location

- Exact browser location is requested only after a user clicks **Vị trí của tôi**.
- The MVP keeps coordinates in React memory only.
- Location is not written to localStorage, cookies, logs, analytics, or the repository.
- A future backend should store exact location only when a product feature explicitly needs it; otherwise use coarse location or short-lived coordinates.

## Secrets and providers

- Never put private provider keys in `NEXT_PUBLIC_*`.
- `NEXT_PUBLIC_MAP_STYLE_URL` is allowed only for a public map style URL.
- Paid search/geocoding/AI keys must stay server-side behind authenticated route handlers.
- Production provider responses must be normalized before reaching UI components.

## User generated content

- The MVP renders all user text as React text nodes, never as injected HTML.
- New-place text is length-limited and strips angle brackets before use.
- Future image uploads must use signed object-storage uploads, server-side MIME validation, size limits, metadata stripping, and image re-encoding.

## Authentication and groups

Do not add a fake client-only authentication system. Before persistent group data ships, implement:

- server-managed sessions in `HttpOnly; Secure; SameSite=Lax` cookies;
- CSRF protection for state-changing requests;
- group membership authorization on every server query;
- opaque IDs rather than sequential public identifiers;
- revocable sessions and device/session history;
- rate limits for login, invitations, ratings, search, and place creation.

## Database boundary

The planned persistence layer is PostgreSQL + PostGIS. Every row containing user/group data must be scoped by `group_id` and server authorization. Never trust a client-supplied group id without checking membership.

## HTTP hardening

The Next.js configuration enables:

- CSP;
- frame denial;
- no MIME sniffing;
- no-referrer;
- cross-origin opener isolation;
- camera and microphone disabled by policy;
- geolocation restricted to this origin.

The current CSP allows inline scripts/styles because of framework and MapLibre runtime requirements. Before a public launch, move to request nonces so `unsafe-inline` can be removed where supported.

## Dependency policy

The project intentionally uses very few runtime packages. Dependabot is enabled. Dependency additions should be justified in pull requests and should not be used for trivial UI helpers.
