---
name: discover-related-projects
description: Use when investigating runtime service dependencies, understanding related microservices, or when the current project references another project that needs to be explored
---

# Discover Related Projects

## Known projects

- None hardcoded. The caller specifies the repo (and org/owner) to explore. If the project later gains a fixed backend or related repo, record it here as `<org>/<repo>` with a one-line purpose.

## Prerequisites

Run before any clone:
```bash
ssh -T git@github.com
```
If this fails, stop — direct user to `README.md` → **"GitHub credentials setup"**. Do not attempt clone without confirmed SSH access.

## Workflow

### Clone

Clone into `.ai/temp/<repo_name>` (gitignored):

1. Derive repo name from service name if not provided (e.g., "Publisher Service" → `publisher-service`).
2. Use caller-specified branch; default `main`, fall back to `master`.
3. Shallow-clone (caller provides `<org>` / repo owner):
   ```bash
   mkdir -p .ai/temp
   git clone --depth 1 --branch <branch> git@github.com:<org>/<repo_name>.git .ai/temp/<repo_name>
   ```
4. On name failure, try common variations (with/without team prefix, singular/plural) before asking user.
5. If clone fails after variations — ask user for exact repo name. Do NOT guess or skip.

Do NOT delete cloned repos — kept in `.ai/temp/` for future reference.

### Explore

Caller must specify what to find (e.g., Kafka topic names, proto definitions, auth token flow).

1. Check `<project>/docs/ai/general.md` first — use if it answers the question; skip full exploration.
2. If docs missing or insufficient, launch explore subagents scoped to caller's goal — not generic questions.
3. Return findings relevant to caller's request only.

## Common mistakes

- Guessing repo name when clone fails — try variations, then ask; names don't always match service names.
- Generic exploration — search for what the caller needs, not a boilerplate summary.
- Skipping `docs/ai/` — check pre-generated docs first; full exploration is fallback.
