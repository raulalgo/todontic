---
name: plan-feature
description: Use when planning a new feature, designing implementation strategy, or preparing a handover for the implement-feature skill. Produces a coding-oriented plan covering DRY, architecture, tests, and concrete code changes. Asks clarifying questions before planning.
---

# Plan Feature

Produce coding-oriented implementation plan as clean handover to `implement-feature`. Plan only — no code edits.

**Model Rule:** MUST run on **Opus with high thinking**. Planning is most leveraged step in agentic workflow; bad plan cost is paid by every downstream step. If main agent is not Opus, stop and instruct user to re-invoke with Opus.

**Scope Rule:** Output is plan document only. No application code changes. No "on the way" refactors. Only Phase 5 writes a file — under `.claude/temp/`.

**Independence from Review:** Plan file read by `implement-feature`, may be read by humans, but **never** by `code-reviewer` (per its Independence Rule). Write plans assuming reviewer judges code on its own merits.

## Project Context

**Authoritative docs (read directly with Read tool, if present):**
1. `AGENTS.md` — project goal, conventions, architecture and naming rules.
2. `CLAUDE.md` — agent-facing project guidance.
3. `DESIGN.md` — design system reference (if the project has one).
4. `README.md` — setup, infra notes (only if plan touches infra/deployment).

If none exist yet, infer conventions from neighbouring code; do not block on missing docs.

**Related-repo exploration (on-trigger):** If the project has a separate backend or related repo and the feature touches its API request/response shapes, DTOs, enums, or domain semantics, invoke `discover-related-projects` skill to verify the contract before writing the plan. Single-repo project → skip.

## Execution Phases

### Phase 1: Intake and Clarify

Refuse to plan vague requests. Pull out unknowns before plan is written, not during implementation.

1. Restate feature in 2–4 sentences from user's prompt. Confirm understanding.
2. Read `AGENTS.md` / `CLAUDE.md` / `DESIGN.md` if present (main agent, not subagent). Skim relevant sections.
3. Identify domains touched — slices, components, routes, hooks, data adapters.
4. List open questions. **STOP and ASK the user. Do not guess.** Categories:
   - Scope boundaries: "Does this include X, or is X a separate ticket?"
   - UX details: "Empty state? Loading state? Error state?"
   - Data shape: "Field `foo` — required from backend, or client-derived?"
   - Integration: "Wire into route `/x`, or new route?"
   - Tests: "Existing test framework wired? If no, ship without unit tests, or add framework first?"

   If everything is clear, say so and proceed. Do not invent questions.

5. Wait for answers before Phase 2. Proceed only once unknowns are resolved or explicitly deferred.

### Phase 2: Explore and Map

Ground plan in current code. No plan written from imagination.

1. Locate touch points. Use `Grep`/`Read` (or spawn the `Explore` subagent for broad searches) to find:
   - Files to be edited.
   - Existing patterns to follow (neighbouring component, sibling slice, similar hook).
   - Existing utilities/types/components to **reuse** (DRY check).
   - Callers/consumers of any module being changed.
2. Related-repo contract check (conditional). If the project has a separate backend/related repo and the feature touches its API: launch `discover-related-projects`. Verify endpoints, DTOs, enums, required fields. Note contract gaps in plan. Single-repo → skip.
3. Note conventions in play. Naming, doc-comment style, design tokens, state-management patterns, module patterns. Match what the repo already does.
4. Reuse before invent. If util/component/hook already does 80% of job, plan extends it — does not duplicate.

### Phase 3: Architect

Decide shape of change. Surface trade-offs here, not during implementation.

1. **Layer placement.** Each new piece → correct directory per the project's structure (UI vs hooks vs state vs data vs utils vs types).
2. **State ownership.** Local component state vs Redux slice vs URL/route state vs server cache. Justify in one line.
3. **Data flow.** Where data enters (thunk / hook / loader), how it's normalized, where it's consumed.
4. **Public surface.** Function/component signatures, exported types, module APIs. Match any component-contract rules in `AGENTS.md`.
5. **DRY.** Identify shared logic. Decide: extract to util/hook, or inline. If extracting, name and place new module.
6. **Abstractions — minimum viable.** No premature generalization. Two call sites → maybe a helper. One call site → inline.
7. **Failure modes.** Loading, empty, error, edge cases (empty list, large list, network failure, stale data). Each gets deliberate UI state or deliberate "out of scope" note.
8. **Non-functional.** Auth guard? Memoization need? Accessibility (keyboard, ARIA)? Bundle impact?
9. **Alternatives considered.** 1–2 rejected designs and why. One line each.

### Phase 4: Plan Code Changes and Tests

Turn architecture into concrete, ordered list of code edits the implementer follows step by step.

1. **Step list.** Each step = one focused edit. Order by dependency. Each step names: **file path**, **what to add/edit**, **how it connects** to prior steps.

2. **Tests.** For each new pure-logic file and any bug-fix step: plan a corresponding test file following the project's test convention. If no test framework is wired yet, plan a step to wire it OR explicitly defer (user confirmed in Phase 1). Bug fixes always get a regression test entry, even if framework missing — plan flags this.

3. **Coverage matrix.** Each new file/function → test file → cases covered (happy path, edge cases). Keep terse.

4. **Out of scope.** Explicit list of things plan deliberately does NOT do. Prevents implementer drift.

5. **Verification per step.** Command/check confirming each step (typecheck, test command, manual run). UI changes: plan must include a manual verification step.

### Phase 5: Write the Plan File

Persist single, self-contained plan that `implement-feature` consumes directly.

1. **Path:** `.claude/temp/plan-<short-slug>-<YYYYMMDD-HHMMSS>.md` (run `mkdir -p .claude/temp` first if needed).
2. Use **Write tool** with template below.
3. Tell user the path and offer to invoke `implement-feature` next.

#### Plan File Template

```markdown
# Plan: <feature title>

## Goal
<2–4 sentences: what we are building and why. No history, no marketing.>

## Scope
**In scope:**
- <item>

**Out of scope:**
- <item>

## Open Questions Resolved
- Q: <question> → A: <answer from user>

## Architecture Decisions
- **State ownership:** <where, why — one line>
- **Data flow:** <entry → normalization → consumption>
- **Reused modules:** <existing util/hook/component being extended>
- **New modules:** <name + directory + reason>
- **Rejected alternative:** <one line>

## Files to Touch
- **`src/types/foo.ts`** — new — Type `Foo`.
- **`src/store/fooSlice.ts`** — edit — Add selector `selectFooById`.

## Implementation Steps
1. **<step title>** — `path/to/file` — <what to add/edit> — <how it connects>.
2. **<step title>** — `path/to/file` — …

Order is dependency-driven. Implementer follows in order unless dependency forces re-order (must surface to user).

## Tests
- **`src/utils/foo.ts`** → `src/utils/foo.test.ts` — happy path; empty input; <edge>.
- **`src/store/fooSlice.ts`** → `src/store/fooSlice.test.ts` — reducer X; selector Y.

**Framework status:** <wired / not wired — if not wired, decision: add it first / defer per user>.

## Verification per Step
- Step 1 → typecheck.
- Step 2 → run test file.
- Step N → manual check: <golden path + 1–2 edge cases>.

## Conventions to Follow
- Doc-comments on new public exports (per `AGENTS.md`, if present).
- Design tokens from `DESIGN.md` — no hardcoded literals (if a design system exists).
- Project conventions per `AGENTS.md` / neighbouring code.

## Related-Repo Contract Notes (if applicable)
- Endpoint: `<METHOD /path>`.
- Request DTO: <fields, required vs optional>.
- Response DTO: <fields>.
- Source of truth: <related repo + path>.

## Risks / Watch-outs
- <one-line risk + mitigation>.
```

Keep plan tight. No prose padding. Every line earns its place.

## Hard Rules

- **No plan without clarifying answers.** Phase 1 is non-skippable.
- **No code edits in this skill.** Plan file only.
- **No speculative features, no "while we're at it" refactors.** Scope is what user asked for.
- **Reuse first, invent second.** DRY check is required Phase 2 output.
- **Tests are part of plan, not afterthought.** Coverage matrix required.
- **Match repo conventions.** Read `AGENTS.md` (if present) and a neighbouring file before designing new modules.
- **Hand off cleanly.** Plan file must be self-contained — `implement-feature` must not re-derive context from chat history.

## Handover

After Phase 5:

> Plan saved to `.claude/temp/plan-<slug>-<ts>.md`. Invoke `implement-feature` with this plan to execute.
