/**
 * Code-counter store with in-process async mutex.
 *
 * Guarantees "reserve N or none" at the persistence boundary:
 *   1. Acquire the exclusive lock.
 *   2. Load the current config from disk.
 *   3. Call `core.reserveCodes` (pure — no side-effects).
 *   4. Atomically write the updated config.
 *   5. Return the allocated codes.
 *   6. Release the lock.
 *
 * If the atomic write fails in step 4, no codes are returned and the
 * on-disk counter is left unchanged (no codes lost, no codes double-allocated).
 *
 * This file intentionally does NOT import `electron` so it remains testable
 * under Vitest's node environment.
 */

import { reserveCodes } from '@todontic/core'
import { loadConfig, saveConfig } from './configStore.js'

// ─── Simple async mutex ───────────────────────────────────────────────────────

/**
 * A minimal non-reentrant async mutex.
 *
 * All operations that must not interleave (load → reserve → persist) acquire
 * this single lock.  A single in-process lock is sufficient because Todontic
 * has exactly one main-process instance.
 */
class AsyncMutex {
  private queue: Array<() => void> = []
  private locked = false

  /** Acquire the lock. Resolves when the lock is held. */
  acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  /** Release the lock and wake the next waiter (if any). */
  release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}

// One mutex shared across all counter operations for the current vault.
const mutex = new AsyncMutex()

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reserve `n` monotonic codes for `prefix` in the vault at `rootPath`.
 *
 * The operation is serialised through an in-process async mutex so concurrent
 * callers never see overlapping code ranges.
 *
 * @param rootPath - Absolute vault root path.
 * @param prefix   - Code prefix (must already exist in config.codePrefixes).
 * @param n        - Number of codes to reserve (≥ 1).
 * @returns Allocated codes, e.g. `['TDC-1', 'TDC-2']`.
 * @throws if `prefix` is not in the config or the write fails.
 */
export async function reserveCodesLocked(
  rootPath: string,
  prefix: string,
  n: number,
): Promise<string[]> {
  await mutex.acquire()
  try {
    const { config: currentConfig } = await loadConfig(rootPath)
    const { config: updatedConfig, codes } = reserveCodes(currentConfig, prefix, n)
    // Persist the bumped counter before returning codes — all-or-none.
    await saveConfig(rootPath, updatedConfig)
    return codes
  } finally {
    mutex.release()
  }
}
