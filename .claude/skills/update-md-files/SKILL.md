---
name: update-md-files
description: Sync repo `.md` and `.mdc` docs (AGENTS.md, CLAUDE.md, rules, READMEs intended for LLM agents) against recent changes. Updates only on contradictions, supersedes, or new load-bearing invariants. Not a changelog. Trigger phrases - "sync docs", "update AGENTS.md", "update CLAUDE.md", "update rules", "/update-md-files". Auto-invoked by orchestrate-feature Stage 4c.
---

# Update MD Files

Keep repo agent-oriented docs (`.md`, `.mdc`) aligned with reality after changes. Living spec, not history log.

**Purpose**: prevent doc rot. **Scope**: any `.md`/`.mdc` at repo root or under `.claude/`, `.cursor/`, `rules/`, `docs/` consumed by LLM agents. Skip user-facing prose docs (CHANGELOG, public README marketing copy).

## When to run

- End of orchestrated feature pipeline (Stage 4c of `orchestrate-feature`).
- Manual: user asks "sync docs" / "update AGENTS.md" / "update CLAUDE.md" after notable changes.
- Skip if no candidate `.md`/`.mdc` files touched by change context.

## Inputs (when invoked by orchestrator)

- Plan file path
- Implementation changelog (Stage 2 return)
- Code review file path
- QA review file path

Manual run: derive context from `git diff` vs main + recent commits.

## Hard rules

### Read first

- Discover candidate docs: `AGENTS.md`, `CLAUDE.md`, files under `.claude/`, `.cursor/rules/`, `rules/`, `docs/` matching `*.md`/`*.mdc`.
- Read candidates before reading inputs. Skip files not touched by change scope.

### Update only on

- Contradiction — existing rule no longer true.
- Supersede — path moved, dependency renamed, backend swapped, command renamed.
- New load-bearing invariant — new "do NOT" rule, new porting/migration constraint, new ordering dependency.
- Goal/scope shift documented in plan.

### Do NOT add

- Changelog entries.
- Dated notes ("as of YYYY-MM-DD…").
- "Recently added" / "Recent changes" sections.
- PR-style summaries.
- Implementation details belonging in code/TSDoc/JSDoc.
- Directory listings, file catalogs, component inventories — agent searches faster than reads prose.
- Tech stack listings — build file is source of truth.
- Class-purpose lists, established patterns describing how things work — discoverable from code in 2-3 reads.
- Version numbers, file counts, domain counts — stale immediately.
- Restatements of constraints already in another rule file.

### Apply the gate

Before adding any line, ask: **"Would an agent get this wrong even after reading 2-3 files in the relevant area?"** If no — cut it. Doc explains **why** and **where to look**, not **what** exists.

### Style — match LLM-oriented formatting

- Terse. Drop articles, filler, hedging. Fragments OK.
- Imperative, not descriptive. `Set X before Y` not `X should be set before Y`.
- One concern per bullet. No semicolon-chaining.
- No markdown tables. Hierarchical bullets instead. Exception: 2-column genuine comparison.
- Subheadings (`###`) when section has 3+ bullets clustering into distinct topics.
- Code refs (file paths, symbol names) over duplicating source.
- Action-oriented — every line prevents a mistake or prescribes a specific action. Else cut.
- Preserve existing tone of each file. Match its `.md style` block if present.

### Scope discipline

- Touch only sections directly contradicted or superseded.
- Edit only `.md`/`.mdc` files. No source, no tests, no config.
- One file may be updated, another untouched in same run — fine.

## Output

No update needed:
```
## MD sync: no changes needed
<1-line reason — what was checked, why nothing qualified>
```

Updated:
```
## MD sync: updated
- <path/to/file.md> → <section headings touched> — <1-line rationale>
- <path/to/other.mdc> → <section> — <1-line rationale>
```

## Decision examples

- New component in `src/lib/` → none. Discoverable from code.
- Backend/dependency swapped for another service → update the relevant section in `AGENTS.md`.
- New "do NOT simplify" invariant found in review → add bullet under "Adaptation guidelines".
- Bug fix in existing component → none.
- A referenced external link/ID changed → update the doc that points to it.
- New porting rule established → add under the porting section.
- Test coverage added → none. Derivable from test files.
- Rule file in `.cursor/rules/` references a renamed module → update path ref.
- New CLI command added to repo → none unless it replaces a documented one.
- Ordering dependency discovered (template upload order, env setup sequence) → add under relevant invariants section.
