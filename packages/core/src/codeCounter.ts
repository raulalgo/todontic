/**
 * Pure code-counter algebra.
 *
 * Codes are monotonic, forever-unique identifiers (`<PREFIX>-<NUM>`, e.g.
 * `TDC-42`).  They are NEVER reused, even after delete/demote (AGENTS.md
 * load-bearing invariant).
 *
 * This module is pure: it takes a config, computes new codes, and returns the
 * *updated* config alongside the allocated codes.  The main-process
 * `codeCounterStore` wraps this in an async lock + persist step — the
 * "reserve-N-or-none at persistence level" guarantee lives there.
 */

import type { VaultConfig } from '@todontic/shared'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reserve `n` monotonic codes for `prefix` from the counter stored in `config`.
 *
 * Returns the allocated codes (e.g. `['TDC-1', 'TDC-2']`) and the *updated*
 * config with the bumped counter.  The caller is responsible for persisting the
 * returned config atomically before using the codes.
 *
 * @throws {Error} if `prefix` is not present in `config.codePrefixes` — the
 *   caller must seed the prefix first (add `{ next: 1 }` to codePrefixes and
 *   persist config before reserving).
 * @throws {Error} if `n` is less than 1.
 */
export function reserveCodes(
  config: VaultConfig,
  prefix: string,
  n: number,
): { config: VaultConfig; codes: string[] } {
  if (n < 1) {
    throw new Error(`reserveCodes: n must be ≥ 1, got ${n}`)
  }

  const prefixEntry = config.codePrefixes[prefix]
  if (!prefixEntry) {
    throw new Error(
      `reserveCodes: prefix '${prefix}' not found in config.codePrefixes. Add it and persist the config before reserving codes.`,
    )
  }

  const start = prefixEntry.next
  const codes: string[] = []
  for (let i = 0; i < n; i++) {
    codes.push(`${prefix}-${start + i}`)
  }

  // Return a new config with the bumped counter — never mutate the input.
  const updatedConfig: VaultConfig = {
    ...config,
    codePrefixes: {
      ...config.codePrefixes,
      [prefix]: { next: start + n },
    },
  }

  return { config: updatedConfig, codes }
}

/**
 * Peek at the next code that would be allocated for `prefix` without consuming
 * it.  Useful for display ("next code will be TDC-5").
 *
 * @throws {Error} if `prefix` is not present in `config.codePrefixes`.
 */
export function peekNext(config: VaultConfig, prefix: string): string {
  const prefixEntry = config.codePrefixes[prefix]
  if (!prefixEntry) {
    throw new Error(`peekNext: prefix '${prefix}' not found in config.codePrefixes`)
  }
  return `${prefix}-${prefixEntry.next}`
}
