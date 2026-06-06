/**
 * Unit tests for VaultWatcher self-write suppression logic.
 *
 * We test the three branches of `isSelfWrite` (and `registerSelfWrite`)
 * without starting the chokidar watcher:
 *   (a) unregistered path → not suppressed (returns false)
 *   (b) registered path within TTL → suppressed (returns true)
 *   (c) registered path after TTL expiry → not suppressed, entry evicted
 *
 * `isSelfWrite` is private — we access it via a typed helper that casts to
 * `unknown` first (no `any` cast to satisfy biome's no-explicit-any rule).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultWatcher } from './watcher.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Access private methods on VaultWatcher without `any`. */
function asPrivate(w: VaultWatcher): {
  isSelfWrite: (p: string) => boolean
  selfWrites: Map<string, number>
} {
  return w as unknown as {
    isSelfWrite: (p: string) => boolean
    selfWrites: Map<string, number>
  }
}

/** TTL used by watcher.ts (keep in sync with SELF_WRITE_TTL_MS). */
const SELF_WRITE_TTL_MS = 2000

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VaultWatcher — self-write suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('(a) unregistered path → not suppressed', () => {
    const watcher = new VaultWatcher('/tmp/vault', () => {})
    const { isSelfWrite } = asPrivate(watcher)

    expect(isSelfWrite.call(watcher, '/tmp/vault/unregistered.md')).toBe(false)
  })

  it('(b) registered path within TTL → suppressed (returns true)', () => {
    const watcher = new VaultWatcher('/tmp/vault', () => {})
    const { isSelfWrite } = asPrivate(watcher)

    watcher.registerSelfWrite('/tmp/vault/page.md')
    // Advance time to just inside the TTL window.
    vi.advanceTimersByTime(SELF_WRITE_TTL_MS - 1)

    expect(isSelfWrite.call(watcher, '/tmp/vault/page.md')).toBe(true)
  })

  it('(c) registered path after TTL expiry → not suppressed + entry evicted', () => {
    const watcher = new VaultWatcher('/tmp/vault', () => {})
    const { isSelfWrite, selfWrites } = asPrivate(watcher)

    watcher.registerSelfWrite('/tmp/vault/page.md')
    // Advance past TTL.
    vi.advanceTimersByTime(SELF_WRITE_TTL_MS + 1)

    // Should return false (expired).
    expect(isSelfWrite.call(watcher, '/tmp/vault/page.md')).toBe(false)
    // Entry should have been evicted from the map.
    expect(selfWrites.has('/tmp/vault/page.md')).toBe(false)
  })

  it('two different paths are tracked independently', () => {
    const watcher = new VaultWatcher('/tmp/vault', () => {})
    const { isSelfWrite } = asPrivate(watcher)

    watcher.registerSelfWrite('/tmp/vault/a.md')
    vi.advanceTimersByTime(100)
    watcher.registerSelfWrite('/tmp/vault/b.md')

    // Both are still within TTL.
    expect(isSelfWrite.call(watcher, '/tmp/vault/a.md')).toBe(true)
    expect(isSelfWrite.call(watcher, '/tmp/vault/b.md')).toBe(true)
    // Unrelated path is not suppressed.
    expect(isSelfWrite.call(watcher, '/tmp/vault/c.md')).toBe(false)
  })

  it('registerSelfWrite refreshes the TTL on re-registration', () => {
    const watcher = new VaultWatcher('/tmp/vault', () => {})
    const { isSelfWrite } = asPrivate(watcher)

    watcher.registerSelfWrite('/tmp/vault/page.md')
    // Advance to near-expiry.
    vi.advanceTimersByTime(SELF_WRITE_TTL_MS - 100)
    // Re-register (e.g. another write to the same file).
    watcher.registerSelfWrite('/tmp/vault/page.md')
    // Advance past the original TTL — should still be suppressed because
    // re-registration reset the clock.
    vi.advanceTimersByTime(200)

    expect(isSelfWrite.call(watcher, '/tmp/vault/page.md')).toBe(true)
  })
})
