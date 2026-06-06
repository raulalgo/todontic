/**
 * Vault config (`config.yml`) parse / serialize.
 *
 * The config lives at `.todontic/config.yml` and is read/written by the main
 * process via `configStore.ts`.  This module is pure (no FS): string → object
 * and object → string, with safe defaults and validation.
 *
 * Invalid YAML on parse returns an error string so the caller can fall back to
 * the last-valid config without crashing (requirement from the plan).
 */

import type { CodePrefixesConfig, Status, VaultConfig } from '@todontic/shared'
import { BUILTIN_STATUSES, DEFAULT_ATTACHMENTS_PATH, DEFAULT_CODE_PREFIX } from '@todontic/shared'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return a fresh `VaultConfig` with sensible defaults:
 * - Code prefix: `TDC`
 * - Statuses: the four built-in statuses in display order
 * - Attachments path: `attachments`
 * - Code counter: `{ TDC: { next: 1 } }`
 */
export function defaultConfig(): VaultConfig {
  return {
    codePrefix: DEFAULT_CODE_PREFIX,
    statuses: [...BUILTIN_STATUSES] as Status[],
    attachmentsPath: DEFAULT_ATTACHMENTS_PATH,
    codePrefixes: {
      [DEFAULT_CODE_PREFIX]: { next: 1 },
    } as CodePrefixesConfig,
  }
}

/**
 * Parse a raw `config.yml` string into a `VaultConfig`.
 *
 * On invalid YAML or missing required fields the call returns an `error` string
 * and the caller should fall back to the last-valid config (no exception thrown).
 * Partial configs are merged with `defaultConfig()` so callers always get a
 * complete object.
 */
export function parseConfig(raw: string): { config: VaultConfig; error?: string } {
  let parsed: unknown
  try {
    parsed = yamlParse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { config: defaultConfig(), error: `YAML parse error: ${msg}` }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { config: defaultConfig(), error: 'Config file is empty or not a YAML object' }
  }

  const raw_ = parsed as Record<string, unknown>
  const defaults = defaultConfig()

  const codePrefix =
    typeof raw_.codePrefix === 'string' && raw_.codePrefix.trim()
      ? raw_.codePrefix.trim()
      : defaults.codePrefix

  const statuses: Status[] = Array.isArray(raw_.statuses)
    ? (raw_.statuses as unknown[])
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => (s as string).trim() as Status)
    : defaults.statuses

  const attachmentsPath =
    typeof raw_.attachmentsPath === 'string' && raw_.attachmentsPath.trim()
      ? raw_.attachmentsPath.trim()
      : defaults.attachmentsPath

  // Parse codePrefixes — each entry must have a numeric `next` value ≥ 1.
  // A missing, non-numeric, or non-positive `next` is a surfaced error (same
  // treatment as invalid YAML) rather than a silent reset to 1.  Silently
  // resetting to 1 risks code reuse (forever-unique/never-reused invariant).
  let codePrefixError: string | undefined
  const codePrefixes: CodePrefixesConfig =
    typeof raw_.codePrefixes === 'object' && raw_.codePrefixes !== null
      ? (() => {
          const entries: [string, { next: number }][] = []
          for (const [k, v] of Object.entries(raw_.codePrefixes as Record<string, unknown>)) {
            if (typeof v !== 'object' || v === null || !('next' in (v as object))) continue
            const nextRaw = (v as Record<string, unknown>).next
            const nextNum = Number(nextRaw)
            if (!Number.isFinite(nextNum) || nextNum < 1) {
              codePrefixError = `codePrefixes.${k}.next is not a valid positive integer: ${JSON.stringify(nextRaw)}`
              continue // skip the malformed entry rather than silently collapsing to 1
            }
            entries.push([k, { next: Math.floor(nextNum) }])
          }
          return Object.fromEntries(entries)
        })()
      : defaults.codePrefixes

  if (codePrefixError) {
    return { config: defaults, error: codePrefixError }
  }

  // Ensure the active prefix always has a counter entry.
  if (!codePrefixes[codePrefix]) {
    codePrefixes[codePrefix] = { next: 1 }
  }

  return { config: { codePrefix, statuses, attachmentsPath, codePrefixes } }
}

/**
 * Serialize a `VaultConfig` to a YAML string for writing to `config.yml`.
 *
 * Round-trip: `parseConfig(serializeConfig(config)).config` deep-equals `config`.
 */
export function serializeConfig(config: VaultConfig): string {
  return yamlStringify(config, { lineWidth: 0 })
}
