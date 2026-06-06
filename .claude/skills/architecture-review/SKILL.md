---
name: architecture-review
description: Use when reviewing architecture — entire codebase, a plan document, or recent changes — for scalability, maintainability, DRY, patterns/best practices, overengineering, spaghetti code, and architectural bugs. Trigger phrases: "architecture review", "review architecture", "audit architecture", "review the design".
---

# Architecture Review

Evaluate architecture, not line-by-line correctness. Output: prioritized list of architectural findings.

**Model Rule:** Run on **Opus with high thinking**. Wrong architectural call shapes every downstream module. If main agent is not Opus, stop and ask user to re-invoke with Opus.

**Subagent Rule:** Use subagents (Agent tool) for deep, parallel exploration. Fan out on independent questions (state mgmt, data flow, component boundaries, tests). All subagents MUST be **Sonnet with high thinking** — pass `model: "sonnet"` and instruct *"Use extended thinking at high budget — think hard before answering."*

**Scope Rule:** Read-only. No code edits. Only this skill file may be updated in the optional self-update phase.

**Independence Rule:** Do NOT read prior architectural review reports for the same target. Form judgment from the artifact + project docs. OK to read user-provided design docs, Jira tickets, ADRs.

**Distinct from `code-reviewer`:** `code-reviewer` flags bugs and style at file/line level. This skill flags **structural** issues: module boundaries, coupling, layering, abstraction debt, scalability bottlenecks, missing seams. A correct line in the wrong module is in scope here.

## Modes

Three modes — ask which if not specified:

1. **Framework mode** — entire codebase (or named subtree). Big-picture audit.
2. **Plan mode** — plan document (typically `.claude/temp/plan-*.md`) — critique before implementation.
3. **Changes mode** — branch vs base, or local uncommitted — critique architectural impact of a diff.

If unspecified: **STOP and ASK** which mode + target path/branch.

## Project Context

**Authoritative project docs (read with Read tool — main agent, not subagent):**

1. `AGENTS.md` / `CLAUDE.md` — project goal, conventions, architecture and component-contract rules (if present).
2. `DESIGN.md` — design system reference (if present).
3. `README.md` — only if infra/deploy in scope.

If these don't exist yet, infer conventions from the code.

**Related-repo exploration (on-trigger):** If the project has a separate backend/related repo and the review touches its API request/response shapes, DTOs, enums, or domain semantics, invoke `discover-related-projects` skill to verify contract alignment. Spell out concrete questions. Single-repo → skip.

## Execution Phases

### Phase 1: Determine Mode and Gather Artifact

**Step 1: Confirm mode.** If not specified, ask user. Wait for answer.

**Step 2: Gather the artifact.**

Framework mode:
1. Default scope: full `src/` tree. Narrow if user named a subtree.
2. `git ls-files src/ | head -300` to size scope.
3. Build inventory: `Glob` for files by category (slices, components, hooks, utils, types, data, mocks, routes).
4. Read `package.json` for runtime + dev deps, scripts, framework versions.
5. Read `vite.config.*`, `tsconfig*.json`, `tailwind.config.*`, `.eslintrc*` if present — config drives architecture.

Plan mode:
1. Read plan file in full.
2. Read any docs the plan references (`AGENTS.md` sections, sibling plans).
3. Spot-read 2–3 files the plan proposes to touch — verify plan's premises against current code.

Changes mode:
1. Detect base branch: `git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`/`master`.
2. Ask user: branch (vs base) or local (vs HEAD)?
3. Branch: `git diff <base>...HEAD --stat`, then full diff. Local: `git diff HEAD` + `git diff --cached`.
4. Exclude noise: `-- ':!package-lock.json' ':!.claude/' ':!.ai/'`.
5. Save diff to `.claude/temp/arch-diff-<slug>-<YYYYMMDD-HHMMSS>.md` for the report to reference.

### Phase 2: Load Project Documentation

Read core docs (main agent, not subagent):

1. `AGENTS.md` / `CLAUDE.md` — full file (if present). Extract: conventions, component contracts, naming/doc-comment rules.
2. `DESIGN.md` — skim; full read if UI-heavy (if present).
3. `README.md` — only if infra/deploy in scope.

Identify domains touched and frameworks involved (state-management patterns, data-fetching, routing, auth, etc.).

If the project has a separate backend/related repo and the artifact touches its API/DTO shapes: launch `discover-related-projects` with concrete questions. Single-repo → skip.

First message after docs loaded:
```
**Docs loaded** — [1-sentence summary of context returned]
```

### Phase 3: Build the Architecture Map

**Purpose:** Form explicit mental model before judging. Skipping leads to surface-level findings.

Spawn parallel Sonnet+high-thinking subagents (one Agent call per independent question — single message, multiple tool blocks). Each subagent returns terse, structured answer.

Fan-out questions (pick those that fit the mode):

- **Module map:** Enumerate top-level modules under `src/`. For each: responsibility, primary exports, who imports it. Flag modules with no inbound imports (dead) or excessive fan-in (god module).
- **State topology:** Where does state live? Redux slices (list + responsibility), local component state hotspots, URL/route state, server cache. Identify duplicate sources of truth.
- **Data flow:** How does data enter the app (thunks, loaders, hooks)? Where normalized? Where read? Identify multi-hop chains and back-channels.
- **Component boundaries:** Container vs presentation split. Components with >300 lines, >7 props, or heavy local logic. Components that bypass slices to fetch directly.
- **Layer violations:** UI importing from `data/` directly? `utils/` importing from `components/`? Slices importing components? List violations with file paths.
- **Reuse / DRY:** Pairs of files implementing same logic. Look for: parallel helper functions, duplicated selectors, copy-pasted JSX patterns, parallel type definitions.
- **Test architecture:** Test framework wired? Test files per domain? Integration vs unit balance? Missing seams (untestable singletons, hidden deps).
- **External boundaries:** API client shape, mock layer organization, auth boundary, routing entry. Are boundaries explicit or smeared across many files?

Synthesize subagent outputs into one-screen architecture summary (modules, state, flow, boundaries, hot spots). Keep in working memory for Phase 4.

### Phase 4: Evaluate Against Architectural Concerns

For each concern below, scan architecture map + artifact and record findings.

#### 4.1 Scalability

- Adding Nth feature requires touching same hub file (god module)?
- O(n²) patterns: nested loops over growing collections, re-renders cascading through context providers, selectors recomputing on every dispatch.
- Bundle growth: barrel exports pulling unused trees, dynamic-import opportunities missed at route boundaries.
- State growth: unbounded slice arrays, no pagination plan, no normalization where lists are large.

#### 4.2 Maintainability

- Module size: files > ~400 lines or modules with > ~10 files and unclear sub-grouping.
- Naming clarity: names describe role or just type (`Manager`, `Helper`, `Utils` as catch-alls)?
- Hidden coupling: shared mutable singletons, side-effectful imports, implicit ordering between effects.
- Onboarding friction: new contributor reading entry point — can they trace one feature end-to-end in under 10 min?
- Doc-comments on public surfaces (per `AGENTS.md`, if present).

#### 4.3 DRY (and premature DRY)

- **Real duplication:** same logic in 3+ places, evolving in parallel. Flag.
- **Premature abstraction:** one or two call sites behind "flexible" generic helper. Flag — inlining is simpler.
- **Copy-pasted slices/components** with single prop differing → candidate for shared base or parametrization.
- **Type duplication:** request/response types redefined per call site instead of one source of truth.

#### 4.4 Best practices & patterns (framework-idiomatic)

Examples below are for a JS/TS frontend. Apply the equivalent idiomatic checks for the project's actual stack.

- Redux Toolkit: createSlice + createAsyncThunk used correctly? Selectors memoized with `createSelector` where reused? RTK Query vs hand-rolled thunks consistency.
- React: hooks rules respected, effect dependencies honest, `useMemo`/`useCallback` only where justified, context only for truly cross-cutting state.
- React Router: data loaders vs in-component fetches — pick one, apply uniformly.
- TypeScript: discriminated unions over flag soup, `unknown` over `any` at boundaries, generics only when call sites benefit.
- Auth0: token retrieval centralized, no per-component direct SDK calls.
- File organization matches `AGENTS.md` (if present).

#### 4.5 Overengineering

- Abstractions with one implementation and no realistic second one coming.
- Configuration that nothing toggles.
- Plugin/strategy patterns for stable, non-branching logic.
- Custom hooks wrapping single library call with no added behavior.
- Layered indirection (component → hook → service → adapter → client) where two layers would do.
- Generics with one instantiation.

#### 4.6 Spaghetti / coupling

- Cyclic imports.
- Cross-module reach-through (`import from '../../other-feature/internal/foo'`).
- Components fetching, transforming, AND rendering — no separation.
- Effects that dispatch that trigger effects that dispatch (effect chains).
- Prop drilling > 3 levels for value that belongs in state.
- Shared mutable module-level variables.

#### 4.7 Architectural bugs

- Race conditions baked into data flow (two unsynchronized sources of truth).
- Missing auth guard on route reachable from the router.
- Cache invalidation gaps (mutation succeeds, list doesn't refresh).
- Multi-state domain flag collapsed/lost somewhere on the path (per `AGENTS.md`).
- Backend contract drift vs the related repo (wrong field, wrong enum, wrong method).
- Lost-update patterns on optimistic UI.
- Memory leaks at boundaries: subscriptions, intervals, observers without cleanup.

#### 4.8 Plan-mode specific

When reviewing a plan:

- Architectural decisions explicit (state ownership, layer placement, public surface)?
- Alternatives considered, even briefly?
- Reuse identified — or plan inventing parallel infra?
- Failure modes named (loading, empty, error, edge)?
- Tests planned alongside code, not after?
- Plan respects existing patterns or silently introduces new one (and is new one justified)?
- Scope boundaries explicit; "out of scope" listed?

### Phase 5: Filter and Rank Findings

**What NOT to report:**

- Line-level style or formatting (out of scope — `code-reviewer` territory).
- Naming nits unless actively misleading at module level.
- Alternative-but-equivalent architectures (don't impose taste).
- Issues outside artifact's scope (don't pile on tech debt unrelated to change in changes-mode).
- Things already addressed by AGENTS.md and followed.
- Speculative future-proofing ("might need this someday").

**Severity — assign one tier per finding:**

- 🔴 **Critical — Must Address**
  - Architectural defect with traceable path to broken feature, security gap, data corruption, or hard-to-undo lock-in.
  - Examples: missing auth boundary, cycle that will deadlock the type checker as it grows, state duplication causing observable inconsistency, scaling cliff at expected load.

- 🟡 **Important — Should Address**
  - Real maintainability or scalability tax under realistic growth. Code works today but next 3–5 features will pay for it.
  - Examples: god module, layering violation already replicated 3+ times, overengineered abstraction blocking clear simplification, missing test seams on core logic, DRY violation diverging in parallel.

- 🔵 **Recommendation — Consider**
  - Code-quality improvement, minor abstraction win, or convention-tightening with no current pain.

**Avoid severity inflation.** Most reviews have zero or one Critical. Re-evaluate if everything is red.

### Phase 6: Output the Report

Output to user using ONLY the sections below. No "positives" / "kudos" sections.

```markdown
# Architecture Review

## Mode
<Framework | Plan | Changes> — target: `<path or branch>`

## Architecture Snapshot
<5–10 bullets: module map, state topology, data flow, key boundaries. Terse.>

## Summary
<one-line-per-finding list, severity-tagged>

----

## Critical Findings

### 1. [Concern]: [Brief title]

**Location**: `path/to/area` (or "cross-cutting" if structural)

**Issue**: <what is wrong, structurally>

**Why it matters**: <concrete consequence — broken feature, scaling cliff, lock-in>

**Direction**: <one-paragraph remediation direction — not a full plan>

----

## Important Findings

[Same format]

----

## Recommendations

[Same format, lower priority]

----

## Overview
- **Mode**: <framework | plan | changes>
- **Scope size**: <files / lines / steps reviewed>
- **Critical**: <count>
- **Important**: <count>
- **Recommendations**: <count>
- **Architectural concerns surfaced**: <list of 4.x categories that produced findings>
```

**Save report:** after printing, save to `.claude/temp/arch-review-<mode>-<slug>-<YYYYMMDD-HHMMSS>.md` (run `mkdir -p .claude/temp` first if needed). Append to user output:

- `📄 Review saved to: .claude/temp/<filename>.md`
- `📄 Diff saved to: <path>` (changes mode only)

### Phase 7: Self-Update from Feedback (Last Step)

When invoked directly by user (not by workflow/orchestrator), ask for feedback and update this skill or `AGENTS.md`.

**Skip triggers** (prompt contains any): "do not ask for feedback", "skip feedback", "orchestrator", "as part of workflow", "from command", "from workflow".

When running:

1. **Ask:**
   - "Which findings were noise or should be toned down?"
   - "What did I miss — patterns or concerns you care about?"

2. **Wait.** No feedback → end.

3. **Trace root cause and update the right file:**
   - **Skill mechanics (phases, severity, concerns)** → this `SKILL.md`.
   - **Project-specific conventions / anti-patterns** → `AGENTS.md`. Match existing terse style.

4. **Apply minimally:**
   - Unhelpful suggestions → add "Avoid flagging" or narrow the criterion.
   - Missed concern fitting existing category → add bullet under 4.x.
   - Missed concern fitting no category → add new 4.x sub-section (sparingly).

5. **Confirm what changed and where.**

**Principles:** update only on concrete feedback; keep edits minimal; preserve structure; don't bloat.

## Hard Rules

- **No code edits.** Read-only review; only Phase 7 may edit this file or `AGENTS.md`.
- **No plan/code-review overlap.** Do not flag line-level bugs or style. Do not write implementation plan — output is critique with directional remediation, not steps.
- **Confirm before flagging non-trivial issues.** Trace through imports/callers; verify it's not an established repo idiom (grep for other instances).
- **Independence:** do not read prior architecture review reports for the same target.
- **Read AGENTS.md first.** Project knowledge lives there — do not duplicate it here.
