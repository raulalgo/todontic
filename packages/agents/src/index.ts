/**
 * BYO-AI capability layer + CLI adapters (PRD-05 / PRD-06).
 *
 * Detects installed LLM CLIs (Claude Code, Codex, Gemini, Ollama) and exposes a
 * unified `AgentBackend` interface over them. Each agent call runs in its own
 * child process (subprocess, JSON-over-stdio). Per D-001 we never bundle an LLM
 * or hold user keys; the SDK/BYOK path is a fallback, not the primary route.
 *
 * Spike learnings feeding the Claude Code adapter (../../../todontic-spike):
 *  - Invoke with `claude -p <prompt> --output-format stream-json --verbose`.
 *  - Spawn detached with a hard self-timeout; on timeout SIGKILL the process
 *    group so a hung handshake takes MCP children down too.
 *
 * Intentionally empty until PRD-05 lands.
 */

export {}
