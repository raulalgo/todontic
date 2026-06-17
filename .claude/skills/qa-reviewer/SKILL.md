---
name: qa-reviewer
description: Use when reviewing an implementation, feature, change set, or PR from a QA perspective. Checks unit + integration test coverage, surfaces obvious or potential bugs, and produces a manual test plan. Trigger phrases include "QA review", "review from QA perspective", "test coverage check", "what should I test manually", "/qa-review".
---

# QA Reviewer

Three deliverables, every time:

1. **Test coverage report** — what is covered, what is missing.
2. **Bug findings** — obvious bugs + plausible failure modes a developer might have missed.
3. **Manual test plan** — concrete scenarios a human tester should walk through.

## Policy

- **Read-only.** May write review to `.claude/temp/`; may update own `SKILL.md` / `references/` in Phase 7 with explicit user feedback.
- **Independence.** Read code first, form independent QA view, then cross-check intent. Do NOT substitute design docs / PR body / plan for reading code. `AGENTS.md`, `README.md`, Jira, user context OK.
- **Scope.** Unit + integration only. No e2e (Playwright/Cypress) — if diff introduces e2e tooling, flag 🟡 and continue.
- **No overlap with `code-reviewer`** — skip architecture, naming, TSDoc, porting/contract review. Suggest running it separately if user wants both.
- **Subagents.** 50+ files or 1000+ lines → spawn parallel per-domain subagents. All Sonnet, instruct *"Use extended thinking at high budget — think hard before answering."* For edge-case / race / coverage tracing prefer the `Explore` subagent.
- **Project hotspot.** Identify the project's most error-prone domain pattern (e.g. multi-state flags, optimistic updates) and treat each state/branch as a first-class test case. Record hotspots in `AGENTS.md` as they emerge.

## Phase 1: Mode + diff

### Step 1: Ask mode if not given

> Would you like a QA review of:
> 1. **Branch changes** — current branch vs `main`/`master`
> 2. **Local uncommitted changes** — working tree + staged vs `HEAD`
> 3. **A specific PR** — paste `gh pr view` URL or PR number

### Step 2: Gen diff

Common exclusions: `':!package-lock.json' ':!.claude/' ':!.ai/'`.

**Mode 1 — Branch.**
1. Default base: `git symbolic-ref refs/remotes/origin/HEAD`. Fallback `main`, then `master`.
2. `git fetch origin <base>` → `git merge-base origin/<base> HEAD`.
3. `gh pr view --json number,title,body 2>/dev/null` — store PR if present.
4. Collect: `git log --oneline --no-merges origin/<base>..HEAD`, `git diff --stat origin/<base>...HEAD`, `git diff origin/<base>...HEAD -- <exclusions>`.

**Mode 2 — Local.** `git diff HEAD`, `git diff --cached`, `git diff --stat HEAD`. Same exclusions.

**Mode 3 — PR.** `gh pr view <num> --json number,title,body,headRefName,baseRefName,files` + `gh pr diff <num>`.

### Step 3: Jira

Scan prompt for keys (`PRG-1258`, `DS-123`). Launch Jira downloader subagent if available, else skip. Read `.claude/temp/<KEY>-formatted.md` → `jira_context` for AC + manual plan.

### Step 4: Save diff

`mkdir -p .claude/temp`, write to `.claude/temp/qa-diff-<branch-or-pr>-<YYYYMMDD-HHMMSS>.md`. Store as `saved_diff_path`.

## Phase 2: Map changes → test surface

The table below assumes a JS/TS frontend. Adapt layer paths, test types, and tooling to the project's actual stack and structure.

| Layer | Path pattern | Test type |
|-------|-------------|-----------|
| Pure logic / utils | `src/utils/`, `src/data/`, reducers/selectors | Unit (no React) |
| Redux slice / thunk | `src/store/**/slice.ts`, `**/thunks.ts` | Unit (reducers), integration (thunks + mocked API) |
| Hook | `src/hooks/`, `useX.ts` | Unit, `renderHook` |
| Component | `src/components/`, feature components | Integration, RTL + user-event |
| Route / page | `src/routes/` | Integration, router + providers |
| Auth / middleware | `src/auth/`, route guards | Integration, mocked auth provider |
| Mock / fixture | `src/mocks/` | Not directly tested; flag if prod depends on drifting shape |

Skip: `.claude/`, `.ai/`, `deployment/`, `infra/`, generated files, type-only.

## Phase 3: Coverage analysis

### Step 1: Framework

Read the project's manifest/build file for a test runner and assertion/UI-testing libraries (for a JS/TS frontend, e.g. `vitest`/`jest`, `@testing-library/*`, `msw`). Missing → flag once 🟡, do conceptual coverage (describe *what tests would exist*).

### Step 2: Per-file

For each Phase 2 prod file:

1. Locate test: same dir `*.test.ts(x)` / `*.spec.ts(x)`, or `__tests__/`. Glob + Grep.
2. No test:
   - Pure logic (utils, reducers, selectors, transforms) → 🟡
   - New hook → 🟡
   - Component with branches / interaction → 🟡
   - Purely presentational (no branches, no state) → 🔵
   - Mock/fixture → not counted
3. Test exists → diff test file too. Verify:
   - New branches in prod have new cases.
   - Bug fixes have regression test failing without fix; missing → 🟡.
   - Edge cases:
     - Multi-state domain flags — every state tested?
     - Empty / null / undefined inputs
     - Loading / error / success for async
     - Boundary values (0, 1, max)
     - Unicode / long strings if rendered or persisted
   - Async asserts use `await` / `waitFor`; missing → 🟡 (flaky).

### Step 3: Integration

Features spanning files (slice + component + route, thunk + slice + selector):

1. At least one integration test exercises full user flow without real browser? Non-trivial + missing → 🟡.
2. Redux: store wired via test-store helper or `configureStore`, NOT mocked entirely (hides selector/reducer bugs).
3. API: `msw` at network boundary preferred over module mock. Module-level mock → 🔵.

### Step 4: Test smells

- Assertion-free (`render` no `expect`) → 🟡
- Snapshot-only for behaviour-changing components → 🔵
- Over-mocking (mock the SUT, not its deps) → 🟡
- **Fixture encodes the implementation's assumption → 🔴.** The single highest-value QA check. A test whose mock/fixture is *shaped to match what the code does* rather than what real data looks like proves nothing — author and implementer share the same false belief, so the test passes while the app breaks. Tells: the fixture only ever contains the "happy shape" the code assumes (e.g. every page has a `code`, every list non-empty, every id present); the test's expected value is *derived the same way the SUT derives it* (both compute `${code}.md`); no test uses a plain/realistic specimen (an uncoded note, an empty result, a renamed file). For any data-driven feature, demand at least one test with a **realistic, code-independent fixture** — ideally lifted from a real sample (e.g. the project's test vault), not hand-crafted to fit. Missing → 🔴 and put the realistic case at the top of the manual plan.
- Hard-coded waits (`setTimeout`, `sleep(500)`) → 🟡 (use `waitFor`/`findBy*`)
- Shared mutable state across tests, missing `beforeEach` reset → 🟡
- Testing implementation (internal state, class names, `container.querySelector` when role/label exists) → 🔵
- `fireEvent.click` when `user-event` available → 🔵

## Phase 4: Bug hunt

Lens: *"how does this break for a real user?"*

Use `references/qa-bug-checklist.md`. Walk relevant categories per changed component / hook / thunk. Report only if concrete reproduction path exists — otherwise move to manual plan.

**Reachability lens (run first, before micro-bugs).** Before hunting edge cases, prove the headline feature is actually *reachable and wired* in the running app with realistic data — this is where "passed tests, broken in app" hides. For each user story, trace the live path end to end: is the component mounted in a route a user can reach? Is its data source the *general* one (all pages) or a *narrow* one that happens to work for the demo fixture (only coded pages)? Does a brand-new/empty/plain instance (fresh vault, no items, uncoded note) leave a dead end? A component that exists, typechecks, and has green unit tests but is unreachable or fed the wrong data source in the real app is a 🔴 — say so plainly even though "the code is all there."

## Phase 5: Manual plan

Complement to automation, not duplicate. If unit/integration already asserts a behaviour, exclude.

**5.1 Core path (1–3 items max).** Headline journey end-to-end in real browser. Integration tests run jsdom against mocks; human confirms real(ish) backend.

Example: `[ ] Open /<page> → perform <core action> → confirm <expected outcome> matches <secondary view>`

**5.2 Gaps automation can't catch.** Include only if all three:

1. **Relevant** — exercises changed code.
2. **Uncovered** — no unit/integration test asserts this.
3. **Impractical to automate here** — genuine reasons:
   - Real-browser-only: CSS layout, focus-visible, native scroll/zoom, clipboard, drag-and-drop, file picker, autofill, geolocation prompt
   - Real-backend-only: contract drift vs the real backend, real auth-token refresh, real network timing
   - Cross-tab / cross-session: `storage` events, two-tab race, logout-from-other-tab
   - Visual regression: design tokens, dark/light, RTL, screen-reader quality
   - Destructive / external: real emails, real records in shared infra

Fail any check → drop. Do NOT copy items from `references/qa-bug-checklist.md` — that's Phase 4 tool, not manual template.

Format rules + length target → `references/output-template.md`.

## Phase 6: Output

Render template from `references/output-template.md`. Save to `.claude/temp/qa-review-<branch-or-pr>-<YYYYMMDD-HHMMSS>.md` (`mkdir -p` first).

Append:

- `📄 QA review saved to: .claude/temp/<filename>.md`
- `📄 Diff saved to: <saved_diff_path>`

Severity model lives in template file.

## Phase 7: Self-update

Skip if prompt contains any of: "do not ask for feedback", "skip feedback", "orchestrator", "as part of workflow", "invoked by workflow", "invoked by command".

Otherwise ask:

1. "Which findings were not useful or should be toned down?"
2. "What did I miss — bugs you spotted, or manual cases I should have suggested?"

Wait. No feedback → end. Route fixes:

- Skill mechanics, severity, phase logic → `SKILL.md`
- Bug-hunting categories, edge cases → `references/qa-bug-checklist.md`
- Project-specific QA conventions → `AGENTS.md`

Minimal edits. Add "Avoid reporting …" for false positives; add bullets for genuine misses.

## Split vs `code-reviewer`

| Topic | Owner |
|-------|-------|
| Architecture, naming, doc-comments, porting contract | `code-reviewer` |
| API/DTO contract drift vs related repo | `code-reviewer` |
| Test coverage gaps | `qa-reviewer` (primary), `code-reviewer` partial |
| Bug hunting via realistic user scenarios | `qa-reviewer` (primary), `code-reviewer` partial |
| Manual test plan | `qa-reviewer` only |
| Severity model | shared |

Run `code-reviewer` first (architecture / contract), then `qa-reviewer` (coverage / bugs / manual). Not parallel — overlapping diff + context.
