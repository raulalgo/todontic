# Issue Detection Guide

Check every applicable category for each changed file during Phase 4.

**Stack note:** Examples below are flavored for a React / Redux Toolkit / TypeScript frontend. The *categories* are universal — apply the equivalent check for the project's actual stack and structure. Ignore library-specific examples (Auth0, react-leaflet, Vite, etc.) that don't apply.

---

## 1. Logic & Flow Errors

- **Wrong conditional rendering** — Condition evaluates to `0` or `""` instead of `false`, rendering unexpected values (e.g., `{count && <List />}` renders `0` when `count === 0`). Use `count > 0 && <List />` or ternary.
- **Inverted/incomplete conditions** — `!isLoading` when it should also check `!isError`; early returns skipping cleanup or state updates.
- **Off-by-one in list/index operations** — Wrong pagination offset, incorrect slice bounds, bad index assumptions on mapped data.
- **Missing return paths** — Event handlers/callbacks not covering all branches, leaving component in inconsistent visual state.
- **Short-circuit chain bugs** — `user && user.profile.name` crashes when `user` truthy but `profile` undefined. Prefer optional chaining.
- **Boolean coercion confusion** — Treating `""`, `0`, `null`, `undefined` as interchangeable falsies when they have distinct domain meaning.
- **Stale comparison values** — Comparing against a value captured at mount instead of current value, esp. in closures.
- **Ternary/logical chain precedence** — Deeply nested ternaries or chained `&&`/`||` producing wrong results due to operator precedence.

---

## 2. Component Lifecycle & Hooks Misuse

- **Missing/incorrect dependency arrays** — `useEffect` / `useMemo` / `useCallback` with stale or missing deps, causing stale closures or skipped updates.
- **Infinite re-render loops** — `setState` inside `useEffect` without guards, or deps producing new references each render (inline objects/arrays).
- **Stale closure bugs** — Callbacks/timers capturing old state/prop value, acting on it after change. Common in `setInterval`, debounced handlers.
- **Missing cleanup in effects** — Subscriptions, timers, listeners, abort controllers not cleaned up, causing setState on unmounted components.
- **Hooks called conditionally / in loops** — Violation of Rules of Hooks (hooks in `if` blocks, loops, after early returns).
- **`useRef` vs `useState` confusion** — `useRef` used for values that should trigger re-renders, or `useState` for values that should not.
- **Hook execution-order assumptions** — Assuming one `useEffect` fires before another, or specific batching of state updates within one render.
- **Derived state stored in `useState`** — Duplicating data computable from existing state/props, creating sync bugs when source changes.

---

## 3. State Management & Data Flow (Redux Toolkit)

- **Direct state mutation outside a slice reducer** — Mutating Redux state in a place where Immer is NOT active (e.g., inside a thunk, selector, or component) instead of dispatching an action. Inside a `createSlice` reducer, in-place mutation is correct (Immer handles it); outside, it's a bug.
- **Stale state reads after dispatch** — Reading state synchronously right after dispatching, expecting the updated value. State only updates on next render.
- **State shape mismatches** — Selector reads a path that doesn't match the slice shape after a refactor (TS may not catch if selectors are untyped).
- **Derived state out of sync** — Storing computed values in the store separately instead of deriving via selectors / `useMemo`; forgetting to update when source changes.
- **Non-memoized selectors creating new references** — Selector returns a new object/array literal each call (e.g., `state.items.filter(...)`) → defeats `useSelector`'s referential equality → causes unnecessary re-renders. Use `createSelector` from `@reduxjs/toolkit`.
- **Conflicting state sources** — Same data managed in both local component state AND Redux store, leading to divergence.
- **Missing state reset** — Navigating away/back without resetting slice or local state, causing stale data display. Multi-state domain flags (e.g. true/false/undefined) are especially error-prone — losing a distinct state collapses meaning.
- **Toggle/transition logic broken** — Custom multi-state toggle logic that doesn't handle deselect-on-same-click or the full state cycle correctly. Centralize the transition computation; don't recompute it ad hoc at each call site.

---

## 4. Data Handling & Type Safety

- **Unsafe access on API/mock response data** — Accessing nested properties without null/undefined checks when the response can be empty/partial. Optional chaining (`?.`) preferred.
- **Type coercion bugs** — String concat where numeric add expected; `"5" + 3 === "53"`. Force numeric with `Number(...)`.
- **Wrong field names after a mock/contract change** — Mapping/filtering uses outdated field names → silent `undefined` propagation. Cross-check with the backend/related-repo DTOs when API/mock changes.
- **Date and number formatting bugs** — Locale-sensitive formatting not applied; timezone bugs (UTC vs local); `parseInt` truncating decimals.
- **Enum/constant mismatches** — Frontend string literals don't match backend enum values, causing silent failures in `switch` / `===`. Cross-check with the backend enum definitions.
- **Missing empty/loading/error data handling** — Code assumes data always present, crashes or shows broken UI on empty arrays / null fields.
- **`JSON.parse` / `JSON.stringify` misuse** — Parsing localStorage / user input without try-catch; circular references; losing `Date`/`undefined`/`NaN` in round-trips.
- **`any` / `@ts-ignore` escape hatches** — Suppressing real TS errors that indicate genuine data-shape mismatch. Flag every `any` and `@ts-ignore` introduced in the diff unless justified inline.

---

## 5. Error Handling & Resilience

- **Missing error boundaries** — Component tree crashes propagate to root, blanking the page. Wrap risky branches (esp. map, third-party SDKs).
- **Unhandled promise rejections** — `async` handlers / thunks without try-catch → silent failures or unhandled rejection warnings.
- **Network errors not caught** — API calls (even mocked) missing `.catch()` for network failures, timeouts, aborts.
- **Missing loading/error UI states** — Data-fetching flows only handle the success path; user sees blank screen or stale data on failure.
- **Swallowed errors** — `catch` blocks that `console.log` but don't surface error to user or monitoring.
- **Incorrect error propagation in async chains** — Lower-level function catches and doesn't re-throw, so caller assumes success.
- **Error state not cleared** — After a failed op, error state persists across successful retry, showing stale error.
- **Silent fallback to wrong defaults** — `catch` returns a default that's semantically wrong (e.g., returning `[]` when `null` would correctly mean "not loaded").

---

## 6. API Integration & Async Operations

- **Race conditions on concurrent requests** — Older request resolves after newer, overwriting fresher data (fast typing in search, rapid filter changes).
- **Missing request cancellation** — Navigating away while request in flight; response handler then tries to setState on unmounted component. Use `AbortController` or RTK Query / thunk cancellation.
- **Stale request responses applied** — Responses from previous parameter values applied to current UI without checking relevance.
- **Incorrect request construction** — Wrong HTTP method, missing required headers (auth, content-type), unencoded query params, body not matching the backend contract.
- **Missing retry / timeout** — Critical requests with no timeout; no retry for transient failures.
- **Hardcoded API URLs / endpoints** — Should come from env config (`import.meta.env.VITE_*`), not string literals.
- **Optimistic update not rolled back on failure** — UI optimistically updated, rollback on API error missing or wrong.
- **Polling / subscription not stopped** — Intervals or WebSocket connections continuing after user navigates away or feature hidden.

---

## 7. Security Vulnerabilities

- **XSS via raw HTML injection or markdown rendering** — Rendering user-supplied or API-sourced HTML/markdown without sanitization (e.g., DOMPurify) is XSS. Flag every raw-HTML injection sink (e.g. `dangerouslySetInnerHTML`) introduced in the diff.
- **Sensitive data in client state / storage** — Tokens, passwords, PII in Redux state (visible in DevTools); in `localStorage`/`sessionStorage` unencrypted.
- **Auth0 token exposure** — Tokens appended to URLs (visible in logs / referrer / history); tokens logged to console; secrets in client bundle. Use Auth0 SDK helpers; don't manipulate tokens manually.
- **Insecure `postMessage` handling** — Listening to `message` events without verifying `origin`; sending sensitive data via `postMessage` without target origin.
- **Open redirects** — Redirect URLs from query params / user input without validation → phishing risk.
- **CSRF-prone requests** — State-changing requests relying solely on cookies without CSRF tokens or SameSite enforcement.
- **Sensitive data in error messages / analytics** — Stack traces, user data, tokens sent to logging / analytics without redaction.
- **Hardcoded credentials / API keys** — Secrets embedded in source; client-bundle keys that should be server-side. Auth0 domain/clientId are public; client secret is NOT — flag any client-secret in repo.

---

## 8. Performance & Rendering Efficiency

- **Unstable references in props / deps** — Inline objects, arrays, functions as props or dep array entries → children re-render every cycle. Use `useMemo` / `useCallback`.
- **Missing memoization on expensive computations** — Recalculating derived data each render when `useMemo` / `createSelector` would prevent it.
- **Barrel-file imports bloating bundle** — Importing from a barrel `index.ts` pulling the entire module (e.g., `import { Button } from 'components'` pulling all components). Prefer direct paths.
- **Expensive operations in render path** — Sorting, filtering, transforming large arrays directly in JSX instead of pre-computing in `useMemo`.
- **Missing virtualization for large lists** — Rendering thousands of DOM nodes (long deal lists, large tables) without virtual scrolling.
- **Layout thrashing** — Reading DOM measurements then writing styles in a loop, forcing repeated layout recalc.
- **Unoptimized images / assets** — Large images not lazy-loaded, missing `width`/`height` (causing layout shifts), uncompressed assets.
- **Blocking the main thread** — Heavy synchronous parsing or computation on main thread, freezing UI.
- **`react-leaflet` re-renders** — Map components re-render on every state change unless markers/layers are memoized. Cluster layer especially expensive. Pass stable references to `MarkerClusterGroup` children.

---

## 9. Memory Leaks & Resource Cleanup

- **Event listeners not removed** — Listeners on `window`/`document`/DOM elements in `useEffect` without cleanup return.
- **Timers / intervals not cleared** — `setTimeout`/`setInterval` without `clearTimeout`/`clearInterval` on unmount.
- **Subscriptions not unsubscribed** — WebSockets, EventSource, Redux listeners, third-party SDK subs not torn down on unmount.
- **Abort controllers not used** — `fetch` not aborted on unmount → setState on unmounted component.
- **Closure-captured large references** — Big objects captured in closures passed to long-lived callbacks (global handlers), preventing GC.
- **Growing in-memory caches without eviction** — Client-side `Map`/object caches growing indefinitely without size limit or TTL.
- **Detached DOM nodes** — References to removed DOM elements held in variables/closures.
- **`react-leaflet` / leaflet cleanup** — `react-leaflet` mostly handles cleanup, but custom `useMap` hooks adding layers/handles must remove them on unmount. Bare-leaflet `L.map(...)` instances must `.remove()` on unmount.

---

## 10. Routing, Navigation & Access Control

- **Missing / incorrect route guards** — Protected pages accessible without auth or required permissions due to missing wrapper or flawed permission check. Verify every protected route is wrapped (e.g., `withAuthenticationRequired` / custom `PrivateRoute`).
- **Broken deep links** — Routes that work via in-app navigation fail on direct URL load because required state isn't loaded from URL params.
- **URL parameter bugs** — Reading route params without decoding; parsing numeric params without validation; not syncing URL state ↔ component state.
- **Incorrect redirect logic** — Redirect loops; wrong target after login; losing query params / hash fragments. Auth0 `returnTo` must be preserved.
- **Navigation side effects not cleaned up** — Data fetching / subscriptions triggered on route entry but not cancelled on exit → state pollution across pages.
- **History manipulation errors** — Duplicate `push`; `replace` where `push` intended (or vice versa); breaking browser back button.
- **Route-level code splitting missing** — Large page components not lazy-loaded with `React.lazy` → full app downloaded before first paint.
- **Stale data after navigation** — Navigating back displays previous-visit data instead of refetching/revalidating.

---

## 11. Architecture & Pattern Violations

- **Business logic in UI components** — Complex calc / transforms / decision logic in JSX or handlers instead of hooks / selectors / `src/utils/`.
- **Components calling API layer directly** — Bypassing the data-fetching pattern (e.g., raw `fetch` in a component instead of a thunk / `src/data/` module).
- **Circular imports** — Module A imports B which imports A → undefined values at runtime or build issues.
- **God components** — Single component doing data fetching, state, business logic, rendering. Violates SRP.
- **Tight coupling between features** — Feature A imports internal implementation of Feature B instead of using shared contracts / `src/store/` slice.
- **Inconsistent pattern usage** — Same problem solved differently across the codebase without justification (mix of local state and Redux for equivalent concerns).
- **React anti-patterns** — `setState` in render, direct DOM manipulation in components, bypassing React Router's nav API.
- **Wrong abstraction layer** — Duplicated logic across components that should be a custom hook in `src/hooks/`; hooks with no React deps that should be utilities in `src/utils/`.
- **Component contract drift from porting source** — Ported component's props interface, state ownership, or interaction model diverges from the documented contract (see `AGENTS.md` if it documents one: "match the contract, not just the visuals"). Examples: recomputing a state transition at the call site instead of via the shared helper; collapsing a multi-state flag; merging distinct interaction handlers.
- **Missing doc-comments on exported surface** — Exported function / type / non-trivial component missing a terse doc-comment per the project's convention (see `AGENTS.md` if present). Skip one-liners and obvious getters.

---

## 12. Test Coverage

Re-check the project's manifest/build file at review time for a test runner and assertion/UI-testing libraries. No e2e / browser-automation tools (Playwright, Cypress) in scope. If a framework is absent, flag once as Recommendation; treat absence as not blocking early on, but call out high-risk untested logic conceptually. When a framework IS present, apply all checks below. All new tests MUST use that framework — flag any new test file using a different runner or e2e tooling.

- **No tests added for new logic** — New utility, hook, selector, reducer, thunk, or pure helper introduced without an accompanying unit or integration test. Higher severity for pure logic with clear inputs/outputs (utils, state reducers/thunks, data transforms, state-transition helpers) — cheap to unit-test.
- **Unit vs integration mix-up** — Pure logic (utils, selectors, reducers) tested via heavy component-render integration tests instead of cheap unit tests. Inverse also bad: multi-component / Redux-wired flows tested with isolated unit tests that mock everything, proving nothing about integration.
- **e2e / browser-automation introduced** — New Playwright / Cypress / WebDriver / Puppeteer dependency or test file. Out of scope for this project — flag as Important and request migration to unit/integration tests in the project framework.
- **Bug-fix without regression test** — Diff fixes a bug but adds no test that fails before the fix and passes after. Bug fixes without regression coverage will re-regress.
- **Critical paths untested** — Auth flows (login, logout, token refresh, route guards), payment-like state transitions, data-integrity logic (multi-state flags, state-transition helpers), and API request construction lack tests.
- **Tests assert implementation, not behavior** — Tests query internal state, mock module internals, or assert on class names / DOM structure rather than user-visible behavior. Brittle to refactor. Prefer Testing Library queries (`getByRole`, `getByText`) and observable outputs.
- **Over-mocking** — Mocking the unit under test, mocking simple pure functions, or stubbing every collaborator so the test no longer proves anything. Mock at the network / module boundary, not internals.
- **Missing edge-case coverage** — Test only covers the happy path; no cases for empty data, null/undefined, error responses, race conditions, full multi-state transitions, or boundary values.
- **Async tests without proper awaiting** — Missing `await` on `findBy*`, `waitFor`, or user-event interactions; using `act()` incorrectly; relying on `setTimeout` instead of `waitFor`. Flaky tests result.
- **Shared test state / order dependence** — Tests sharing mutable module-level state, Redux store, or DOM between cases without reset (`beforeEach` cleanup, fresh `store` per test). Causes flake and order-dependent failures.
- **Disabled / skipped tests introduced** — `.skip`, `.todo`, `xit`, `xdescribe`, or commented-out tests added in the diff without a tracking ticket reference.
- **Snapshot tests for volatile output** — Large snapshots of full component trees, snapshots of values that change frequently, or snapshots used in place of explicit behavioral assertions.
- **Type-only changes claimed as "tested"** — DTO / type rename that flows through many files but no test asserts the new shape end-to-end (e.g., a selector returning the renamed field).
- **Coverage of porting work** — When porting from another codebase, the component contract (props interface, state ownership, interaction model) should have at least one test asserting the contract — not just visual parity.

**How to report**:
- Untested new pure logic (utils, state, data layers) or porting contract → 🟡 Important.
- Bug fix without regression test → 🟡 Important.
- e2e tooling (Playwright/Cypress) introduced → 🟡 Important. Project uses unit + integration only.
- Missing edge-case coverage on already-tested code → 🔵 Recommendation.
- Missing test framework altogether → 🔵 Recommendation, once per review.
- New UI component with no test, no complex logic → 🔵 Recommendation (don't insist on tests for trivial JSX).

---

## Other (Catch-All)

Don't report unless logic-relevant.

- **Code style / formatting** — Skip (no linter, out of scope).
- **Documentation issues** — Missing doc-comments → already in Category 11. Outdated comments → only flag if actively misleading.
- **Accessibility** — Missing ARIA, keyboard navigation, screen reader issues. Flag if egregious (e.g., button-shaped `<div>` without role + keyboard handler), otherwise skip.
- **Internationalization** — Hardcoded strings, missing translation keys, locale-sensitive formatting. POC has no i18n yet — only flag if user explicitly opts in.
- **Miscellaneous** — Anything else not mapping to 1–11. Drop unless logic-relevant.
