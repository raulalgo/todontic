# QA Bug-Hunting Checklist

Used in **Phase 4** of `qa-reviewer`. NOT a manual-test template — do not copy items into manual test plan.

For every changed component / hook / thunk, walk relevant categories. Only report if concrete reproduction path exists. Move to manual plan only if scenario also passes the Phase 5 three-question filter.

**Stack note:** Examples are flavored for a JS/TS frontend. The categories are universal — apply the equivalent for the project's actual stack. Skip categories that don't apply (e.g. Map/geospatial if there's no map).

---

## 1. Input boundaries (text)

- Empty string `""`.
- Single character.
- Whitespace only (`"   "`, tab, newline).
- Leading / trailing whitespace — trimmed before validation? Before persistence? Consistently?
- Max-length input (paste 10k+ chars).
- Unicode: emoji (`👨‍👩‍👧‍👦` — combining characters, surrogate pairs), CJK, accented Latin, zalgo.
- Right-to-left text (Arabic, Hebrew) — layout break, cursor behaviour.
- HTML / script payloads in inputs that get rendered (`<img src=x onerror=alert(1)>`) — XSS surface.
- SQL-like strings (`'; DROP TABLE`) — only relevant if input reaches SQL-shaped backend.
- URL / path inputs with `..`, `//`, encoded slashes.

## 2. Numeric boundaries

- `0`, `1`, `-1`, `-0`.
- `Number.MAX_SAFE_INTEGER`, `Number.MIN_SAFE_INTEGER`.
- `Infinity`, `-Infinity`, `NaN`.
- Float precision (`0.1 + 0.2 !== 0.3`).
- Very small fractions (`1e-10`).
- Negative where only positive expected.
- `parseInt("01")`, `parseInt("0x10")`, `parseInt("12.5")` — base + truncation surprises.

## 3. Date / time

- Timezone: browser TZ ≠ user TZ ≠ server TZ. Date arithmetic without explicit TZ is suspect.
- DST transition days (spring forward, fall back).
- Leap year (`Feb 29`).
- Year-month-day boundary at local midnight when stored as UTC.
- `new Date("2024-01-01")` parses as UTC; `new Date("2024-01-01T00:00")` as local — easy footgun.
- Date range where `end < start`.
- Date in far past (Unix epoch 0) or far future.

## 4. Async / race conditions

- Double-click submit before first request resolves.
- Switching filters / tabs mid-fetch — does older response overwrite newer? (Need request invalidation or `AbortController`.)
- Component unmounts while fetch in flight — does `setState` fire on unmounted component?
- Out-of-order responses: request A sent, then B sent, B resolves first, A resolves second and overwrites B's data.
- Slow network (throttle to 3G in DevTools) — does loading state appear? Is UI usable while loading?
- Repeated rapid calls (typing in search box without debounce).
- `Promise.all` where one branch rejects — does whole flow fail or fall back?

## 5. State transitions

- Navigate away mid-flow, then back via browser back button.
- Refresh page mid-flow — state restored, lost, or partially restored (worst case)?
- Deep-link directly to URL that normally requires prior step — renders, redirects, or breaks?
- Two tabs on same flow — conflict on shared state (localStorage, cookies)?
- Browser autofill firing after React has rendered.
- Open modal, navigate away while open, navigate back.

## 6. Auth / session

- Logged out.
- Token expired before page load (initial 401).
- Token expires mid-session (silent refresh path).
- Token refresh itself fails (401 on refresh endpoint).
- Role / permission change mid-session — UI still shows actions user can no longer perform?
- Logout from another tab while this tab mid-flow.

## 7. Multi-state domain flags (project-specific)

For every option/control with 3+ states (e.g. include / exclude / neither):

- Reach each state via its documented interaction.
- Reach the neutral/deselected state, including the "click the already-selected state to deselect" path.
- Round-trip every state back to neutral and out again.
- Mixed states across sibling options persist correctly across navigation and refresh.
- State transitions are computed in one place — call sites setting a state directly, bypassing the shared transition helper, are a bug.

## 8. List / collection edges

- Empty list.
- One item.
- Two items (off-by-one in pairing logic).
- Exactly page size, page size + 1, page size − 1.
- Last page partial.
- Sort stability when keys collide.
- Duplicates by id.
- Items added or removed while list is being rendered (concurrent updates).

## 9. Forms

- Submit while still validating (race between validator and submit handler).
- Submit twice rapidly.
- Submit with whitespace-only inputs that pass `required` but fail business logic.
- Browser autofill changing values without firing React `onChange` (some browsers fire `input`, not `change`).
- Paste of multi-line text into single-line input.
- Required field disabled / hidden conditionally — form still submittable when it should be?
- Reset form does not clear async error state from previous submit.

## 10. Map / geospatial (if applicable)

- Antimeridian crossing — coordinates wrap from +180 to −180.
- Poles — lat ±90.
- Zoom 0 (world view) and max zoom (no tiles).
- Tile server unreachable — page crash, blank map, or error surfaced?
- Geolocation: permission denied, permission timeout, inaccurate fix.
- Map mounted inside hidden tab — map libraries often need a resize/invalidate call when the container becomes visible.

## 11. Responsive / accessibility

- Keyboard-only: every interactive element reachable via Tab, focus visible, Esc closes modals, Enter / Space activates buttons.
- Focus trap inside open modal; focus returned to trigger on close.
- Screen reader: icon-only buttons have `aria-label`; live regions announce async updates.
- Color contrast for state indicators; never rely on color alone.
- Viewport 320px (smallest commonly tested mobile) — no horizontal scroll, no clipped controls.
- High zoom (200% browser zoom) — layout reflows without overlap.

## 12. Error recovery

- After API error, user can retry.
- Retry is idempotent (no duplicate write on successful retry of partially-completed write).
- Error state clears on success.
- Error state clears when user changes inputs (not stale-shown next to fresh input).
- Generic 500 vs specific 4xx — UI shouldn't show same opaque message for both.

## 13. Persistence (localStorage / sessionStorage / cookies)

- Storage full (Safari quota is small) — `setItem` throws.
- Storage disabled (Safari private mode, some iframe sandboxes).
- Stored JSON corrupted (manually edited, or schema migration midstream) — `JSON.parse` throws.
- Schema migration: old key shape still present from previous build.
- Cross-tab key collision via `storage` event.

## 14. Network / API contract

- HTTP 200 with unexpected body shape (typo in field, null where object expected).
- HTTP 200 with empty body.
- HTTP 204.
- HTTP 401 mid-flow (token expired).
- HTTP 403 (forbidden — should not trigger re-auth).
- HTTP 429 (rate limited) — UI retries sanely or hammers API?
- HTTP 5xx with HTML error page in body (parsing as JSON throws).
- Network offline.
- Network flaky (request times out, retry succeeds).

## 15. Build / environment

- Production build vs dev build — strict mode double-invokes effects in dev. Behaviour depending on effects firing once is fragile.
- Source maps disabled in production — error stacks become unreadable.
- Env var missing or empty string at build time — code crashes on load or silently misbehaves?

---

## Reporting rules

- Report as Bug Finding only if reproduction path exists (file + line + steps + observed + expected). Otherwise belongs in Manual Test Plan.
- Can't connect checklist item to changed code in diff → drop it. Do not invent finding.
- One severity per finding. Do not stack 🟡 + 🔵 on same issue.
- Anything touching a multi-state domain flag or its shared transition helper requires explicit scrutiny — bugs tend to cluster there.
