---
name: code-reviewer
description: Use when reviewing code changes, performing code review on a branch or local changes, or when the user says "review code", "review changes", "code review"
---

# Code Reviewer

**⛔ Independence Rule: NEVER read the implementation plan.** Biases review toward confirming plan rather than evaluating code. OK to read Jira or other user-provided context.

**⚡ Subagent Rule:** Use subagents (Task / Agent tool) for deep analysis. Fan out parallel subagents on independent questions.

**🧠 Subagent Model Rule:** ALL subagents MUST use Sonnet + high thinking. Pass `model: "sonnet"` to Agent tool; instruct: *"Use extended thinking at high budget for this task."* Applies to every subagent in Phases 2–5. Do NOT spawn on Opus or Haiku.

**🔀 Big PR Rule:** PR ≥ 50 files or 1000+ lines → spawn subagents per domain/component (Sonnet + high thinking). Main agent orchestrates + synthesizes only — does not read files directly.

## Modes

1. **Branch comparison** — current branch vs `main`/`master`; works with or without open PR.
2. **Local uncommitted changes** — working tree + staged vs `HEAD` (pre-commit).

If user did not specify, ask before proceeding.

## Project Docs

Read directly with Read tool (main agent, NOT subagent), if present:

1. `AGENTS.md` / `CLAUDE.md` — project goal, conventions, naming, architecture and component-contract rules.
2. `DESIGN.md` — design system reference (colors, typography, component tokens), if the project has one.
3. `README.md` — setup, infra notes (read only if diff touches infra/deployment/setup).

If these don't exist yet, infer conventions from neighbouring code.

**Related-repo exploration (on-trigger):** When the project has a separate backend/related repo and the diff touches its API request/response shapes, DTOs, enums, or domain semantics (data layer, store/thunks, shared types, mocks, or any code constructing/consuming API payloads) — use `discover-related-projects` skill. Spell out concrete questions for the subagent (specific endpoints, DTO field names, enum values). Single-repo → skip.

## Execution Phases

### Phase 1: Determine Review Mode and Get Changes

#### Step 1: Determine mode

If user did NOT specify:

- **STOP and ASK:** "Would you like to review:
  1. **Branch changes** — current branch vs main/master (works with or without a PR)
  2. **Local uncommitted changes** — work in progress vs HEAD (pre-commit)"
- Wait for response.

#### Step 2: Generate diff

**MODE 1: Branch Comparison** (user said "branch", "pr", "current branch", or similar)

1. Detect base branch:
   - `git symbolic-ref refs/remotes/origin/HEAD` → strip `refs/remotes/origin/` prefix
   - Fallback: check `main` or `master` locally or on origin (verify via `git remote show origin` if `HEAD` symbolic ref missing)
2. `git fetch origin <base_branch>` then `git merge-base origin/<base_branch> HEAD`
3. Check for PR: `gh pr view --json number,title,body 2>/dev/null`
   - Success → store PR number, title, body
   - Failure → proceed with git diff + commit messages
4. Gather:
   - PR title/body (if available)
   - `git log --oneline --no-merges origin/<base_branch>..HEAD`
   - `git diff --stat origin/<base_branch>...HEAD`
   - `git diff origin/<base_branch>...HEAD`
5. Exclude: `-- ':!package-lock.json' ':!.claude/' ':!.ai/'`

**MODE 2: Local Changes** (user said "local", "uncommitted", "staged", "work in progress")

1. `git diff HEAD`, `git diff --cached`, `git diff --stat HEAD`
2. Same exclusions as MODE 1.

#### Step 3: Detect and Download Jira Issues

Scan prompt for Jira key patterns (uppercase prefix + hyphen + number, e.g. `PRG-1258`).

For each key:
1. Launch Jira downloader subagent (`@agents/jira-downloader.md` in CI context; skip silently if unavailable).
2. Pass: `jira_issue_key`, `include_pr: false`.
3. Read `.claude/temp/<ISSUE_KEY>-formatted.md`; store as `jira_context`.

No keys → skip.

#### Step 4: Determine Review Scope

- Path from prompt → file, directory, or specific files.
- Max ~50 files for focused analysis.
- Large/data files: read only enough to understand structure + changes.

#### Step 5: Save Diff to File

Persist full diff to `.claude/temp/`:

- MODE 1: `diff-<branch-name>-<YYYYMMDD-HHMMSS>.md`
- MODE 2: `diff-local-<YYYYMMDD-HHMMSS>.md`
- Use Write tool; run `mkdir -p .claude/temp` first if needed.
- Store path as `saved_diff_path`.

### Phase 2: Load Project Documentation

#### Step 1: Read core docs (main agent, NOT subagent)

1. `AGENTS.md` / `CLAUDE.md` — full file (if present); extract conventions, naming, architecture and component-contract rules.
2. `DESIGN.md` — full file (if present); skim for tokens/colors/components if diff touches UI.
3. `README.md` — only if diff touches infra, deployment, or setup.

#### Step 2: Identify additional context

From diff, identify:
- Domains touched (which feature areas)
- Frameworks/patterns involved (state management, hooks, routing, auth, etc.)
- Purpose (feature, fix, refactor, port)
- Whether API/DTO shapes are touched → trigger Step 3

#### Step 3: Backend contract check (conditional)

If the project has a separate backend/related repo AND the diff constructs API requests, parses API responses, defines DTOs/types matching that backend, or mocks backend behavior:

1. Launch `discover-related-projects` for that repo if not already cloned.
2. Provide concrete questions: which endpoints, DTOs, enums, fields. Example: "Find the `POST /<resource>` request schema and confirm whether `<field>` is required and which enum values it accepts."
3. Use returned excerpts in Phase 5 contract validation.

Single-repo project → skip this step.

**First message after subagents return must start with:**
```
**Docs loaded** — [1-sentence summary of what context was returned]
```

### Phase 3: Understand Intent of Changes

**⛔ NEVER read the implementation plan or any planning document.** Infer intent from diff + project docs + Jira alone.

1. Read diff holistically — feature, fix, refactor, port? Use `jira_context` if available.
2. Trace how changed code fits into app: which components, slices, routes, hooks interact.
3. Form a hypothesis: 2-4 sentences — purpose of change + error-prone areas.
4. Assess architecture and design:
   - **Conformance**: follows project architectural patterns?
   - **Design patterns**: right abstractions?
   - **Code organisation**: right layer/module/file per the project's structure?
   - **Scope creep**: change does only what it claims?
   - **Porting fidelity** (if porting from another codebase): matches the component contract — public API, state ownership, interaction pattern — not just visuals? See `AGENTS.md` if it documents porting rules.
   - **Risk areas**: flag for Phase 4.

### Phase 4: Specific Issues Pass

For each file in scope, check every applicable category from `references/issue-detection-guide.md`.

**Test coverage (Category 12)**: Scope is unit + integration only. No e2e (Playwright/Cypress) — flag any introduction of e2e tooling as 🟡 Important. For every production code file in the diff, check for a corresponding test file. Apply Category 12 rules in `references/issue-detection-guide.md`. Re-check the project's manifest/build file at review time — no test framework wired → flag once as 🔵 Recommendation, skip per-file untested-logic findings (still flag bug-fix-without-regression-test conceptually).

**Doc violations**: Flag diff areas violating the conventions, naming, doc-comment rules, or design tokens documented in `AGENTS.md` / `DESIGN.md` (if present).

**Related-repo contract violations**: If Phase 2 Step 3 loaded related-repo excerpts, flag divergence from its DTOs/enums/endpoints (wrong field name, missing required field, wrong enum value, wrong HTTP method).

**Deep analysis — apply throughout:**

- Don't rely only on the diff — explore the repo, trace implications.
- For non-trivial issues: re-consult AGENTS.md / DESIGN.md; trace execution paths (imports, callers, dispatch flows, route definitions); launch parallel subagents for codebase evidence.
- **Framework pattern check**: before flagging anti-pattern, grep for other instances. If widely used and not contradicted by AGENTS.md, do NOT flag.
- **Source-repo OFF-LIMITS**: if porting, do not clone or read the original source repo. Rely on `AGENTS.md`'s documented contracts.
- **Only report issues you can confirm.** Unverifiable through docs + code exploration → drop.

### Phase 5: Review Findings and Filter

#### Do NOT report

- Code style / formatting (no linter; out of scope)
- Variable naming preferences (unless actively misleading)
- Equally valid alternative approaches
- TODOs (unless indicating incomplete implementation)
- Issues not introduced by the changes
- Superficial improvements, low-priority minor optimisations
- Changes in `.claude/`, `.ai/`, `deployment/`, `infra/`

#### Severity

Assign one tier per finding.

- 🔴 **Critical — Must Fix**: traceable path to production incident, data loss, security breach, or broken functionality under normal usage — not theoretical.
  - XSS via unsanitized `dangerouslySetInnerHTML`, missing auth guard, infinite re-render loop, crash on common input, lost state on common interaction.

- 🟡 **Important — Should Fix**: happy path works today, but will fail under a realistic condition — real edge case, moderate load, specific input. Not contrived.
  - Race condition on fast typing, memory leak from missing unmount cleanup, stale closure, broken domain-state semantics, API contract drift vs the related repo, bug fix without regression test, new pure logic without tests.

- 🔵 **Recommendation — Consider**: theoretical risk, rarely-hit path, or code-quality improvement. Code works today and would pass QA.
  - Defensive null check on unreachable path, minor memo win, cleaner abstraction, missing doc-comment on exported helper, missing edge-case coverage on already-tested code, no test framework wired (flag once).

**Avoid severity inflation.** Most reviews have zero or few Critical issues. If every finding is Critical, re-evaluate.

### Phase 6: Output Summary

Output using **ONLY** the sections below. Do NOT add extra sections ("Positive changes", "Kudos", "Well-executed improvements", etc.).

\```markdown
# Code Review Summary

## Summary

[List of issues found with one-liner description of each]

----

## Critical Issues (Must Fix)

### 1. [Category]: [Brief Description]

**Location**: `path/to/file.ts:123`

**Issue**:
[Concise description of the issue]

----

## Important Issues (Should Fix)

[Same format as Critical Issues]

----

## Recommendations (Consider)

[Same format, lower priority]

----

## Overview
- **Files Reviewed**: [count]
- **Issues Found**: [count by category]
- **Critical Issues**: [count requiring immediate fix]
- **Important Issues**: [count should fix]
- **Recommendations**: [count suggestions for improvement]

----

\```

#### CI Mode: Structured JSON Output (GitHub Actions)

When `GITHUB_ACTIONS=true`, skip markdown output and produce structured JSON.

1. Write `review_findings.json` at repo root (not `.claude/temp/`).
2. Include only `Critical` and `Important` — drop all `Recommendation` findings.
3. JSON shape (valid array, possibly empty):

```json
[
  {
    "title": "Brief descriptive title of the finding",
    "severity": "Critical|Important",
    "file_path": "relative/path/to/file.ts",
    "line": 123,
    "issue": "Concise description of the issue."
  }
]
```

4. Field rules:
   - `title`: concise, unique per finding (used for dedup). No generic titles. E.g. "Missing null check before accessing `user.id` in `AuthService`".
   - `severity`: exactly `Critical` or `Important`. `Recommendation` excluded.
   - `file_path`: relative path from repo root, exactly as in `git diff --name-only`.
   - `line`: 1-based, post-change side. Integer. `0` if file-wide.
   - `issue`: concise problem description. No fix suggestions. Inline code in backticks; no markdown headings.
5. Zero findings (or all `Recommendation`) → write `[]`.
6. Valid UTF-8 JSON. No trailing commas, no comments.
7. Do not write markdown, save to `.claude/temp/`, or notify user — workflow handles PR communication.

#### Interactive Mode: Save Review Results to File

When `GITHUB_ACTIONS` unset or not `true`, always save full review to Markdown:

1. Dir: `.claude/temp/`; file: `review-<branch-name>-<YYYYMMDD-HHMMSS>.md` (branch) or `review-local-<YYYYMMDD-HHMMSS>.md` (local).
2. Use Write tool; run `mkdir -p .claude/temp` first if needed.
3. Append to review output:
   - `📄 Review saved to: .claude/temp/<filename>.md`
   - `📄 Diff saved to: <saved_diff_path>` (from Phase 1 Step 5)

### Phase 7: Self-Update from Feedback (Last Step)

Skip when invoked by workflow/orchestrator. Skip triggers (prompt contains any of): "do not ask for feedback", "skip feedback", "orchestrator", "as part of workflow", "invoked by workflow", "invoked by command", "from command", "from workflow", `GITHUB_ACTIONS=true`. When in doubt, run.

1. Ask:
   - "Which suggestions were not useful or should be toned down?"
   - "What did I miss? (issues you expected, patterns you care about)"

2. Wait for response. No feedback → end.

3. Trace root cause; update the right file:
   - Skill mechanics (review process, severity, phase logic) → `SKILL.md`
   - Detection patterns / categories → `references/issue-detection-guide.md`
   - Project-specific conventions, anti-patterns, porting rules → `AGENTS.md` (create it if missing; project knowledge lives here). One-two-sentence items in appropriate existing section; preserve terse style.

4. Apply fix:
   - Unhelpful suggestions → add "Avoid reporting" / "Do not flag" note, or narrow detection (e.g. "Only flag when ...").
   - Missed items fitting core category → add bullet/sub-section in `references/issue-detection-guide.md`.
   - Missed project-specific anti-patterns → add to `AGENTS.md`.
   - Prefer general rules over narrow exceptions when generalisable.

5. Tell user what changed and where.

Only update with concrete feedback. Keep edits minimal; preserve existing structure. Don't remove categories — add detection criteria or "Avoid reporting" notes.

## Project-Specific Conventions and Anti-Patterns

Project knowledge lives in `AGENTS.md` (conventions, component contracts, naming/doc-comment rules) and `DESIGN.md` (design tokens), if present. Read in Phase 2 Step 1. Do NOT duplicate into this skill.

## Read-Only Analysis Note

Analyzes and reports only. Does NOT modify application code. Only Phase 7 may modify `SKILL.md`, `references/issue-detection-guide.md`, or `AGENTS.md` — and only with explicit user feedback.
