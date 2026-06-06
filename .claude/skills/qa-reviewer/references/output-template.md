# QA Review Output Template

Phase 6 output. Render this exact structure. No extra sections, no praise.

```markdown
# QA Review

## Summary

- Files changed (production): <count>
- Test files added/updated: <count>
- Coverage gaps: <count> (🟡 <n>, 🔵 <n>)
- Bug findings: <count> (🔴 <n>, 🟡 <n>, 🔵 <n>)
- Manual test items: <count>

----

## Test Coverage

### Covered
- `path/to/file.ts` → `path/to/file.test.ts` — new branch covered, edge cases adequate

### Gaps (🟡 / 🔵)

#### 1. [🟡] Missing tests for `src/utils/foo.ts`
**Why it matters**: pure logic with N branches, none exercised.
**What to add**: unit test cases for X, Y, Z, including the relevant multi-state transitions.

----

## Bug Findings

### 🔴 Critical
(only if a clear reproduction path exists)

#### 1. <title>
**Location**: `path/to/file.ts:LINE`
**Reproduction**: <exact steps or input>
**Observed**: <what breaks>
**Expected**: <what should happen>

### 🟡 Important
(same format)

### 🔵 Recommendation
(same format)

----

## Manual Test Plan

Scope: complement to automated coverage. Each item is either the core smoke test or a gap that unit/integration tests provably do not cover.

### Core path
- [ ] <action with exact inputs> → <expected> *(real-browser smoke)*

### Gaps not covered by automation
- [ ] <action with exact inputs> → <expected> *(reason: real-browser only / no automated coverage of multi-state flag transitions for option X / cross-tab)*

(If no genuine gaps exist, write: "No manual gaps — automated coverage adequate.")

----

## Acceptance Criteria Coverage (if Jira context loaded)

- **AC1** — <text>
  - Automated: ✅ `file.test.ts:LINE`
  - Manual: —
- **AC2** — <text>
  - Automated: ❌
  - Manual: #1 (core)
- **AC3** — <text>
  - Automated: partial (`file.test.ts` happy path only)
  - Manual: #2 (edge case)

----

## Files Reviewed
<list>
```

## Severity classification

- 🔴 **Critical** — clear, traceable reproduction path to real failure under normal usage. Not theoretical.
- 🟡 **Important** — breaks under realistic edge case, or meaningful coverage gap (untested logic, missing regression test, untested multi-state flag transitions).
- 🔵 **Recommendation** — theoretical risk, polish item, or test-quality nit.

Avoid severity inflation. Most reviews have zero 🔴.

## Manual plan format rules

- Each item: `[ ] <action with exact inputs> → <expected result>` plus parenthetical reason: `(real browser only / no automated coverage / cross-tab)`
- Reproducible: exact input values (`paste "  " (two spaces)`, not "whitespace").
- Destructive actions: prefix `⚠️ destructive`.
- No browser/viewport matrix unless diff touches CSS, viewport-sensitive layout, or browser API.
- If `jira_context` available: each AC covered by *either* automated test (cite it) *or* manual test line.
- Length target: 3–10 lines total (core + gaps). More than 15 is always wrong.
