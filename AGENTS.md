# AGENTS.md — Todontic

Agent-facing conventions and invariants. Terse by design. When in doubt about *product/scope/architecture intent*, the plan vault (below) wins; when in doubt about *code*, read neighbouring files.

## Source of truth: the plan vault

**All product, scope, and architecture decisions live in the plan vault, NOT in this repo:**

`/Users/raulalgo/Documents/60 Trabajos/Todontic/todontic-plan`

An Obsidian markdown vault. Before planning or implementing any feature, read the relevant docs there. Do not re-derive intent from code or chat — the vault is authoritative.

Structure:
- `01 Planning/Decisions-log.md` — ADR-style decisions, `D-NNN`, append-only. **Cite the governing `D-NNN` when a plan touches a decided question.** Newest at top; never edit a historical entry — supersede with a new one.
- `01 Planning/Scope-MVP.md` — what is in/out of scope for v0.1. Check before adding anything.
- `03 PRDs/PRD-NN-*.md` — per-feature requirements (outliner, detail view, codes/status, BYO-AI, agents, MCP installer, skills, image-gen, etc.).
- `02 Architecture/` — `Tech-stack.md`, `Data-model.md`, `Agent-runtime.md`, `MCP-strategy.md`, `Orchestration-scope.md`.
- `00 Intro/` — `Vision-summary.md`, `Philosophy.md` (11 principles; some marked *load-bearing*).

`plan-feature` and `architecture-review`: treat the vault as the primary context source. Pull the specific PRD + any `D-NNN` the feature implicates into the plan.

## Stack

Per `02 Architecture/Tech-stack.md`:
- **Electron + React + TypeScript.** pnpm monorepo (workspaces).
- **Build/dev:** Vite. **Lint/format:** Biome (not ESLint/Prettier). **Unit tests:** Vitest. **E2E:** Playwright on the Electron build.
- **Outliner:** BlockNote (Tiptap/ProseMirror) — off-the-shelf, no custom build (D-011).
- **Secrets:** keytar (OS keychain) — never plaintext on disk.
- Layout: `apps/desktop/{main,preload,renderer}`, `packages/{core,agents,mcp-installer,skills,shared}`, `mcps/`, `docs/`.

**Playwright e2e IS in scope here** — do NOT flag Playwright/e2e tooling as out-of-scope (this overrides the reviewer skills' generic "unit+integration only" default).

## Load-bearing invariants — do not violate

Subtle enough that an agent gets them wrong without being told. Detail in `02 Architecture/Data-model.md`.

### Data
- **Markdown files on disk are the source of truth.** The in-memory index (backlinks, tags, status, block-IDs) is derived and **always rebuildable** — never make it authoritative.
- **Frontmatter lives under a single `todontic:` key.** Never write top-level frontmatter keys — collides with Obsidian/Dataview (D-009).
- **The user's text is sacred** (Philosophy #10). Everything below the frontmatter is the user's content, byte-preserved. No auto-rewrite/summarize/reorder without an explicit, undoable user action.
- **Markdown round-trip must be loss-free** (write → read → write ≈ byte-stable). The #1 project risk (D-011). Any change to ser/de is high-risk; add a round-trip test.
- **Block IDs** (`^xxxxxx`, 6-char alphanumeric): assigned lazily, unique per file, **never reused**, survive edit/move/indent, do NOT survive cross-page paste (reassign on paste).
- **Codes** (`<PREFIX>-<NUM>`, default prefix `TDC`): monotonic per prefix, **forever-unique — never reuse**, even after delete/demote.
- **Promotion is atomic.** Bulk promote = one transaction: all codes reserved or none; all file writes succeed or all roll back; document order preserved; single undo; already-coded bullets skipped silently.

### Architecture
- **Todontic is NOT in the MCP runtime call path** (D-008, supersedes D-005). It installs/manages skills + their MCPs into the *user's* LLM CLI config (`~/.claude/config.json` etc.); at runtime the user's LLM talks to MCPs directly. Do not build an MCP host/proxy.
- **BYO-AI** (D-001): never bundle an LLM, hold user keys, or mark up tokens. The agent runtime is a thin orchestration layer over detected CLIs (subprocess, JSON-over-stdio).
- **Central command, deferred visualization** (D-004): never build artifact renderers — no in-app code editor, design canvas, doc renderer, spreadsheet grid, or image editor. Every change answers "meta-layer or artifact-layer?"; artifact-layer rendering is out of scope. Canonical reference: `02 Architecture/Orchestration-scope.md`.
- **The list is the spine** (Philosophy #6): the outliner is the most important and riskiest code. No kanban/calendar/board as a primary surface — only views over the list.
- **Preload must be bundled as CJS.** Electron 33's sandboxed renderer rejects ESM preloads at runtime (no error thrown during build). `electron.vite.config.ts` sets `lib.formats: ['cjs']` for preload — do not change to ESM.
- **`packages/core` must stay FS-free.** No Node `fs`/`path`-import allowed in `core` — it must run in any JS environment. All FS operations belong in `apps/desktop/main/`.

## Conventions

- **Doc-comments (TSDoc)** on exported functions, types, and non-trivial components. Skip one-liners and obvious getters.
- **Status enum** is the project's multi-state domain hotspot: `todo | in-progress | blocked | done`, user-extendable. Treat each state as a first-class test case.
- **License is proprietary** (D-014) — closed core. BUT the skill/MCP packaging format is open and documented; first-party skills (PM-refine, Designer, Code-handoff, Image-gen) use the *same* format the marketplace exposes (Philosophy #8, D-013). The skill format is the most important spec — keep it stable.
- No proprietary binary format for user work items; markdown-on-disk only (D-009).

## Design system

No `DESIGN.md` yet — the app has no first-party design system at this stage. (`.pen`/Pencil is an *artifact* tool Todontic orchestrates, not the app's own UI kit.) Create `DESIGN.md` when UI tokens are established.
