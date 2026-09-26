# Security and privacy baseline

ĐiĐâu is personal-first. The initial product stores non-sensitive personal map data locally and does not require an account.

## Local personal data

The browser may persist these items in IndexedDB:

- places the user manually adds;
- Saved place ids;
- personal ratings and short notes;
- visit history.

The IndexedDB payload is validated and bounded when read back. User-generated text is rendered as React text, never injected HTML.

This local storage is a convenience layer, not a secure vault. Do not store passwords, access tokens, private keys, government identifiers, payment data, or other high-sensitivity secrets in it.

## Location

- Exact browser location is requested only after a user clicks **Vị trí của tôi**.
- Current coordinates stay in React memory only.
- Coordinates are not written to IndexedDB, localStorage, cookies, logs, analytics, or the repository.
- Personal saved places have their own place coordinates; they are not treated as the user's live/current location.

## Secrets and providers

- Never put private provider keys in `NEXT_PUBLIC_*`.
- `NEXT_PUBLIC_MAP_STYLE_URL` is allowed only for a public map style URL.
- Paid POI search/geocoding/AI keys must stay server-side behind controlled route handlers.
- Provider responses must be normalized before reaching UI components.
- Do not proxy arbitrary client-provided URLs from the server.

## User-generated content

- Text is length-limited and stripped of angle brackets before persistence.
- No `dangerouslySetInnerHTML` is used for personal content.
- Future image uploads must use signed object-storage uploads, server-side MIME validation, byte-size limits, metadata stripping, and image re-encoding.

## Authentication and sync

Authentication is deliberately postponed until the personal core is useful.

When optional cloud sync is added, use:

- server-managed sessions in `HttpOnly; Secure; SameSite=Lax` cookies;
- CSRF protection for state-changing requests;
- authorization on every user-owned object;
- opaque identifiers;
- revocable sessions and session/device history;
- rate limits for login, imports, ratings, search, and place creation;
- explicit account deletion/export flows.

Do not replace the local-first model with a fake client-only authentication system.

## Groups

Groups are a later capability, not a core dependency. Before group data ships, every server query must verify membership and resource ownership. A client-supplied `group_id` must never be trusted by itself.

## HTTP hardening

The Next.js configuration enables:

- CSP;
- frame denial;
- no MIME sniffing;
- no-referrer;
- cross-origin opener isolation;
- camera and microphone disabled by policy;
- geolocation restricted to this origin.

The current CSP permits inline framework/runtime styles/scripts where required by Next.js and MapLibre. Before a public launch, move toward nonce-based CSP so `unsafe-inline` can be reduced.

## Dependency policy

The project intentionally uses very few runtime packages. Dependabot is enabled. Dependency additions should be justified and should not be used for trivial UI helpers.
