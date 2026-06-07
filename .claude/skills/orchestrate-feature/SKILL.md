---
name: orchestrate-feature
description: Use to drive a full feature pipeline end-to-end (plan → implement → code-review → qa-review) via specialised subagents. Orchestrator only orchestrates, course-corrects, and synthesises subagent output. Trigger phrases - "orchestrate feature", "run full pipeline", "/orchestrate-feature", "plan + implement + review".
---

# Orchestrate Feature

Drive feature pipeline. Four stages, four subagents. Orchestrator never edits code, never reads the diff, never runs tests except final smoke. Job: dispatch, gate, course-correct, summarise.

## Hard Rules

- **Orchestrator is a router.** No `Read`/`Edit`/`Write` on application code. No grep/glob on src/. No inline plan writing, implementation, or review prose. All substance comes from subagent return values.
- **Sequence is fixed.** plan → implement → code-review → fix loop → qa-review → fix loop / hand off. No skipping. No parallel.
- **Test execution is gated.** Only implementator subagent and orchestrator itself may run tests/typecheck (the project's test + typecheck commands). Code-reviewer and qa-reviewer prompts MUST forbid running tests — they analyse, not execute.
- **Planner can stop.** If planner returns "needs user input", surface questions verbatim and wait. Do not answer for user.
- **One subagent at a time.** No parallel fan-out across stages. Within a stage, subagent may fan out internally.
- **Course-correct, do not re-do.** If subagent returns garbage, re-spawn with tighter prompt — do not write deliverable yourself.
- **No phase 7 self-update on subagents.** All subagent prompts include "orchestrator / invoked by workflow / skip feedback" — kills interactive feedback prompts in `code-reviewer` / `qa-reviewer` phase 7.

## Stage Map

- **Stage 1: Plan** — subagent: `general-purpose` running `plan-feature` skill; model: opus, thinking: high; runs tests: no
- **Stage 2: Implement** — subagent: `general-purpose` running `implement-feature` skill; model: sonnet, thinking: high; runs tests: yes
- **Stage 3: Code review** — subagent: `general-purpose` running `code-reviewer` skill; model: opus, thinking: high; runs tests: no
- **Stage 3b: Fix loop** — subagent: `general-purpose` running `implement-feature` skill (targeted); model: sonnet, thinking: high; runs tests: yes
- **Stage 4: QA review** — subagent: `general-purpose` running `qa-reviewer` skill; model: opus, thinking: high; runs tests: no
- **Stage 4b: Fix loop or hand off** — subagent: `general-purpose` running `implement-feature` skill (targeted) OR user; model: sonnet, thinking: high; runs tests: yes
- **Stage 4c: MD sync** — subagent: `general-purpose`; model: sonnet, thinking: medium; runs tests: no

## Execution

### Stage 0: Intake

1. Receive feature request from user.
2. Confirm in 1-2 sentences what pipeline will do. No questions yet — planner asks those.
3. Create scratch dir if missing: `mkdir -p .claude/temp`.
4. Generate run id: `orchestrate-<short-slug>-<YYYYMMDD-HHMMSS>`. Use for all artefact filenames in this run.

### Stage 1: Plan (Opus high)

Spawn planner subagent. Prompt template:

```
You are running the `plan-feature` skill as part of an orchestrated pipeline.

USE EXTENDED THINKING AT HIGH BUDGET — think hard before answering.

Feature request:
<verbatim user request>

Run id: <run id>

Hard rules for this run:
- You are the planner. Follow `.claude/skills/plan-feature/SKILL.md` in full.
- If Phase 1 (Intake and Clarify) surfaces open questions, STOP and return them as a structured list under heading `## Questions for user`. Do not invent answers.
- Do NOT run tests. Do NOT modify application code. Plan file only.
- Save plan to `.claude/temp/plan-<run id>.md`.
- Return: (a) absolute path to the plan file, OR (b) the questions block if you stopped early.
```

Spawn with `subagent_type: "general-purpose"`, `model: "opus"`.

After return:

- **Returned questions** → surface verbatim to user. Wait for answers. Re-spawn planner with original prompt + answers appended. Loop until plan file path returned.
- **Returned plan path** → verify file exists (`ls` via Bash). Store as `plan_path`. Tell user `Plan ready: <path>. Proceeding to implementation.`. Move to Stage 2.

### Stage 2: Implement (Sonnet high)

Spawn implementator subagent.

```
You are running the `implement-feature` skill as part of an orchestrated pipeline.

USE EXTENDED THINKING AT HIGH BUDGET — think hard before answering.

Plan file: <plan_path> (read it; this is your contract)

Run id: <run id>

Hard rules for this run:
- Implement strictly from the plan. No scope creep.
- You ARE permitted to run the project's test, typecheck, lint, and format commands (per the plan / project docs). Do so per-step.
- Use `TaskCreate` if plan has 3+ steps.
- If the plan is wrong/incomplete, STOP and return `## Plan gap` with the specific gap and proposed change. Do not silently expand scope.
- Skip phase 7 feedback prompts — invoked by workflow.
- Return: (a) `## Implementation complete` with a terse changelog (files touched, behaviour added, test commands run, pass/fail), OR (b) `## Plan gap` block.
```

Spawn with `subagent_type: "general-purpose"`, `model: "sonnet"`.

After return:

- **Plan gap** → surface to user. Decide with user: amend plan (re-spawn planner with delta) or extend scope. Do not improvise.
- **Implementation complete + any test failure** → re-spawn implementator with failing test output. Do not move on with red tests.
- **Implementation complete + green** → store changelog. Move to Stage 3.

### Stage 3: Code review (Opus high)

Spawn code-reviewer subagent.

```
You are running the `code-reviewer` skill as part of an orchestrated pipeline.

USE EXTENDED THINKING AT HIGH BUDGET — think hard before answering.

Mode: Branch comparison (current branch vs base). Do not ask the user for mode.

Run id: <run id>

Hard rules for this run:
- Follow `code-reviewer` SKILL.md, INCLUDING its Independence Rule (do NOT read the plan file).
- Do NOT run tests or typecheck. You analyse the diff; you do not execute. If you want to validate a hypothesis, read code only.
- Skip Phase 7 feedback prompts — invoked by workflow.
- Return: path to saved review file + a terse top-level list of 🔴 Critical and 🟡 Important findings (titles + file:line). Drop 🔵 from the return summary (keep them in the saved file).
```

Spawn with `subagent_type: "general-purpose"`, `model: "opus"`.

After return:

1. Store `review_path`.
2. If 0 Critical and 0 Important → move to Stage 4.
3. Else: surface Critical + Important list to user, then re-spawn implementator (Stage 3b) with review file path and instruction to fix findings.

### Stage 3b: Fix loop after code review (Sonnet high)

Spawn implementator subagent. Prompt:

```
You are running `implement-feature` to address code review findings.

USE EXTENDED THINKING AT HIGH BUDGET — think hard.

Review file: <review_path>

Hard rules:
- Address every 🔴 Critical and 🟡 Important finding. 🔵 Recommendations: skip unless trivial.
- Stay in scope of the original plan. New issues uncovered by review that are NOT in the original plan → flag back, do not silently fix.
- You may run the project's test and typecheck commands. Verify green after fixes.
- Skip phase 7 feedback prompts — invoked by workflow.
- Return: terse list of findings addressed + commit-ready summary + test status.
```

After return:

- Tests red → re-spawn with failing output.
- Tests green → re-spawn **code-reviewer** (Stage 3) for verification pass. Cap re-review loop at **2 iterations**. After 2, surface remaining findings to user and ask whether to proceed to QA or keep iterating.

### Stage 4: QA review (Opus high)

Only enter after Stage 3 returned with 0 Critical + 0 Important (or user approved proceeding).

Spawn qa-reviewer subagent.

```
You are running the `qa-reviewer` skill as part of an orchestrated pipeline.

USE EXTENDED THINKING AT HIGH BUDGET — think hard before answering.

Mode: Branch comparison (current branch vs base). Do not ask for mode.

Run id: <run id>

Hard rules for this run:
- Follow `qa-reviewer` SKILL.md, INCLUDING its Independence Rule (do NOT read the plan file or this orchestrator's prior messages).
- Do NOT run tests or typecheck. Read test files to assess coverage; do not execute.
- Skip Phase 7 feedback prompts — invoked by workflow.
- Return: path to saved QA review file + terse list of 🔴 / 🟡 bug findings (titles + file:line) + count of manual-test items.
```

Spawn with `subagent_type: "general-purpose"`, `model: "opus"`.

After return:

1. Store `qa_review_path`.
2. Route based on findings:
   - **Automatable findings present** (🔴 / 🟡 bugs OR 🟡 coverage gaps) → Stage 4b fix loop.
   - **Only manual-test items + 🔵 polish** → Stage 5 hand off.

### Stage 4b: Fix loop after QA (Sonnet high)

Spawn implementator subagent.

```
You are running `implement-feature` to address QA findings.

USE EXTENDED THINKING AT HIGH BUDGET — think hard.

QA review file: <qa_review_path>

Hard rules:
- Address 🔴 Critical bugs and 🟡 Important bugs.
- Address 🟡 coverage gaps by adding missing unit / integration tests called out.
- 🔵 Recommendations: skip unless trivial.
- Manual-test items: ignore (they are for the user).
- Stay in scope. New issues not in plan → flag back.
- You may run tests. Verify green after fixes.
- Skip phase 7 feedback prompts — invoked by workflow.
- Return: list of findings addressed + test status.
```

After return:

- Tests red → re-spawn with failing output.
- Tests green → re-spawn **qa-reviewer** (Stage 4) for verification pass. Cap re-QA loop at **2 iterations**. After 2, surface remaining findings to user and proceed to Stage 4c with a clear "manual triage needed" note.

### Stage 4c: MD sync (Sonnet medium)

Runs after QA clean (or hand-off decision). Skip if no candidate `.md`/`.mdc` agent docs exist in repo.

Spawn subagent running `update-md-files` skill:

```
You are running `update-md-files` skill as part of orchestrated pipeline.

USE EXTENDED THINKING AT MEDIUM BUDGET.

Inputs:
- Plan file: <plan_path>
- Implementation changelog (Stage 2): <verbatim changelog block>
- Code review file: <review_path>
- QA review file: <qa_review_path>

Follow `.claude/skills/update-md-files/SKILL.md` in full. Return result block per skill spec.
```

Spawn with `subagent_type: "general-purpose"`, `model: "sonnet"`. Store result for hand-off. Move to Stage 5.

### Stage 5: Hand off

1. **Final smoke check** (only test run orchestrator does itself):
   - Run the project's typecheck command (if the stack has one)
   - Run the project's test command (if a test framework is wired)
   - **Run the project's e2e suite if one exists** (Playwright/Cypress/etc.) — build first if it requires a build. Unit + jsdom tests run against mocks and routinely pass while the real app is broken; the e2e is the only stage that exercises the actual wiring. This is mandatory for any user-facing change. If there is no e2e for the feature's headline journey, that is itself a gap (see step 1b).
   - Confirm green. If red, stop and surface — do not hand off red.
   1b. **Real-app reachability gate (user-facing features only).** Before declaring done, confirm the headline user journey is *proven reachable in the real app with realistic data* — not just covered by unit tests. The acceptable proofs, in order: (a) an e2e test that launches the real app, seeds a **realistic specimen** (a plain/uncoded/empty case, ideally from the project's sample/test fixtures — NOT a fixture hand-shaped to match the implementation), and drives the journey; or (b) you run the app and observe it. If neither exists, do NOT hand off as complete: spawn one more implementator pass to add the e2e, or surface to the user that the feature is unverified end-to-end. Twice-burned rule: "green unit suite" is not "it works." The recurring failure is a component that exists and passes mocked tests but is unreachable or fed the wrong data source — catch it here if QA's reachability lens didn't.
2. **Produce handover message.** Structure:

```markdown
# Orchestration complete — <run id>

## Pipeline summary
- Plan: <plan_path>
- Implementation: <terse changelog from Stage 2>
- Code review: <review_path> — <N Critical, M Important resolved>
- QA review: <qa_review_path> — <N bugs resolved, K coverage gaps closed>
- MD sync: <no changes needed | files+sections touched>
- Final test status: ✅ green

## Outstanding (user attention required)
- <any unresolved 🟡 / 🔴 that exceeded re-review cap>
- <plan gaps the user opted not to amend>

## Manual test plan (from QA)
<verbatim "Manual Test Plan" section of qa_review_path — orchestrator does not re-author it>

## Suggested next steps
- Run the manual test plan above in a real browser.
- Commit + open PR.
```

3. Tell user pipeline is done. Do not commit, push, or open PR unless asked.

## Course-correction patterns

- **Subagent returns wrong format** (e.g. planner returns code instead of plan file) → re-spawn with format requirement bolded at top of prompt. Don't accept malformed output.
- **Subagent gets stuck in loop** (re-asks same question, re-flags same finding after fix) → stop, surface to user, ask for direction.
- **Implementation diverges from plan** (file count balloons, scope creep in changelog) → stop next stage. Ask user: amend plan or revert.
- **Review finds something the plan caused** (e.g. wrong layer, wrong abstraction) → do NOT fix in implement-feature. Re-spawn planner with review finding as input. Then re-spawn implementator from amended plan.

## Invariants

### Never

- Read source files in `src/`.
- Edit / write source files.
- Run application servers (e.g. the project's dev server).
- Decide on UX / scope unilaterally — push to user or planner.
- Read plan file before code-review or qa-review (preserves their Independence Rule via orchestrator process, not just within subagent).
- Re-author findings in own words — quote subagent output, do not embellish.

### Always

- Spawn subagents with right model + thinking level + skill reference.
- Validate return values exist (paths, structured headings).
- Surface questions and blockers verbatim.
- Cap fix-loop iterations and escalate to user.
- Run final type-check + test smoke before hand-off — INCLUDING the e2e suite if one exists, and a real-app reachability check for user-facing features (Stage 5 step 1/1b). A green unit suite is not proof the feature works.
- Produce final hand-off summary by stitching subagent return values.

## Invocation

Trigger: "orchestrate `<feature>`", "run full pipeline for `<feature>`", "/orchestrate-feature `<feature>`", or feature spec pasted with "drive this through plan-implement-review-qa".

If feature description is empty / one-word, ask once for 2-4 sentence description before spawning planner. Do not start planner with no input.
