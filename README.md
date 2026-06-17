# Todontic

Agentic to-do list — BYO-AI, central command for the orchestration stack, markdown-native.

> Product, scope, and architecture decisions live in the **plan vault**, not here:
> `../todontic-plan` (Obsidian). See `AGENTS.md` for the load-bearing invariants.

## Status

Phase 1 (v0.1 MVP) — scaffold. Phase 0 spike passed (see `../todontic-spike/FINDINGS.md`);
both D-001 (BYO-AI detection) and D-008 (install MCPs into the user's CLI config) are retired.

## Stack

Electron + React + TypeScript · pnpm workspaces · Vite (via electron-vite) · Biome ·
Vitest (unit) · Playwright (e2e). Outliner: BlockNote (Tiptap/ProseMirror).

## Layout

```
apps/desktop/        Electron app (main · preload · renderer)
packages/
  core/              Pure TS — outliner model, markdown ser/de (PRD-01/02)
  agents/            BYO-AI capability layer + CLI adapters (PRD-05/06)
  mcp-installer/     Write/cleanup MCP entries in user's CLI config (PRD-15, D-008)
  skills/            Skill format + loader (PRD-09/12-14)
  shared/            Shared types + utils
mcps/                Source for bundled MCP servers (filesystem, pencil-bridge, image-gen)
docs/
```

## Develop

```sh
pnpm install      # requires Node >=20.19, pnpm 10
pnpm dev          # launch the Electron shell
pnpm test         # unit tests (Vitest)
pnpm typecheck    # project-wide tsc
pnpm lint         # Biome
```
