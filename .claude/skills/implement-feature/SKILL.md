---
name: implement-feature
description: Use when implementing a feature, building new functionality, or executing planned work. Requires an existing plan — stops and asks user to create one if none exists.
---

# Implement Feature

Execute strictly from approved plan. No plan = no work.

## Plan requirement

**Stop before writing any code.** Proceed only if one of:

1. Active plan in conversation from `Plan` agent or `EnterPlanMode` (visible steps, files, approach).
2. Plan doc user explicitly points at (e.g. `docs/plans/*.md`, linked design doc, pasted plan).
3. Prior plan user explicitly references by name, still retrievable in context.

If none true, stop and respond:

> No plan found. Create one first with the `Plan` agent or `/plan`, then re-invoke this skill. I will not implement without an approved plan.

Do not infer, guess, or fabricate a plan. Vague verbal descriptions ("just add a button") are not plans — push back.

## Workflow

1. **Restate scope.** List files to touch and behavior to add. Confirm match with plan. Ask before coding if plan is ambiguous.
2. **Track steps.** Use `TaskCreate` for plans with 3+ discrete steps. One task per plan step. Mark complete as you go.
3. **Implement step-by-step.** Follow plan order unless dependency forces reorder. Note any reorder.
4. **Stay in scope.** No refactors, no new abstractions, no "while I'm here" cleanups. Plan is contract.
5. **Surface deviations.** If implementation reveals plan is wrong or incomplete, stop and surface the gap. Do not silently expand scope.
6. **Verify per step.** Run type checker / tests / lint for changed files. Do not batch verification to end.
7. **Report at end.** What shipped vs. plan, anything skipped, anything needing follow-up.

## Hard rules

- No plan → no code.
- No scope creep. Plan items only.
- No speculative error handling, no future-proofing, no compatibility shims unless plan calls for them.
- Match project conventions already in repo. Read neighbouring files before writing new ones.
- Prefer editing existing files over creating new ones.
- **Test with realistic, code-independent fixtures.** Never shape a test's mock/fixture to match what your code happens to do — that just re-asserts your own assumption and passes while the app breaks. Use a realistic specimen (a plain/uncoded/empty case, ideally from the project's sample/test data), and derive the expected value independently of how the SUT derives it. If your feature reads a data source, write at least one test proving it handles the *general* case, not just the demo-shaped one.
- **Wiring is part of the feature.** A component/hook/function that exists and passes unit tests but isn't mounted in a reachable route, or is fed a narrower data source than the real one, is NOT done. For any user-facing slice, add or extend a test (e2e if the project has one, else an app-level integration test) that proves the headline journey is reachable from where a real user starts, with realistic data.
- **UI changes: actually run the real app** (browser/Electron) per project root guidance before claiming done — or, if you cannot launch it, say so explicitly in your report and ensure an e2e covers the journey. "Unit tests green" is not "it works."

## Mid-implementation unrelated change request

Pause. Ask: extend current plan, or finish current plan first then new plan for new work. Do not silently absorb.
