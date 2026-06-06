/**
 * MCP install / management (PRD-15, per D-008).
 *
 * Todontic is NOT in the MCP runtime call path. This package downloads + verifies
 * skill-bundled MCP server binaries and writes the corresponding entries into the
 * user's own LLM CLI config; at runtime the user's LLM talks to the MCPs directly.
 *
 * Invariants retired by the Phase 0 spike (../../../todontic-spike/FINDINGS.md):
 *  - Claude Code config is `~/.claude.json` (top-level `mcpServers` key) — NOT
 *    `~/.claude/config.json` (which does not exist).
 *  - Cleanliness is verified at the `mcpServers` subtree level (stable-stringify),
 *    never whole-file: Claude Code rewrites the file on nearly every run.
 *  - Only ever touch our own keys; never rewrite the whole file.
 *  - Reference MCP binaries by absolute path; never rely on runtime `npx -y` fetch.
 *  - Per-CLI schema adapters (Claude Code / Codex / Gemini differ) are the real work.
 *
 * Intentionally empty until PRD-15 lands.
 */

export {}
