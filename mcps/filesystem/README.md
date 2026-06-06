# mcp-filesystem (bundled)

Filesystem MCP server bundled with Todontic. Scoped to user-selected allow-list
paths; used by PM-refine, Designer, and Code-handoff to write back to the vault
and to referenced code/doc folders.

Per the Phase 0 spike: ship as an installed dependency referenced by **absolute
path** from the user's CLI config — never via runtime `npx -y` fetch (cold-start
hang). Stub — implementation lands with PRD-15.
