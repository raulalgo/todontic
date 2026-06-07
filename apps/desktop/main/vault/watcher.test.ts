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
 *
 * Integration tests (real chokidar + real FS) verify that:
 *   - An `unlink` for a registerSelfWrite-registered path does NOT emit an
 *     `unlinked` event (QA Bug #4 fix).
 *   - An `unlink` for an unregistered path DOES emit `unlinked`.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

// ─── Integration: real chokidar + real FS ────────────────────────────────────
//
// These tests call watcher.start() and perform actual FS operations so that
// the full handleUnlink / handleAddChange pipeline is exercised.  They use
// real timers (vi.useRealTimers already active after the unit describe block).
//
// Timeout: chokidar's awaitWriteFinish stabilityThreshold is 100 ms; we poll
// for up to 3 s total to avoid flakiness on slow CI disks.

describe('VaultWatcher — real chokidar unlink suppression (QA Bug #4 fix)', () => {
  let tmpDir: string
  let watcher: VaultWatcher

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'todontic-watcher-'))
  })

  afterEach(async () => {
    await watcher?.stop()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * Wait up to `timeoutMs` for `predicate` to return true, polling every
   * `intervalMs`.  Returns true if predicate became true, false if it timed out.
   */
  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 3000,
    intervalMs = 50,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return true
      await new Promise<void>((res) => setTimeout(res, intervalMs))
    }
    return false
  }

  it('registered unlink is suppressed — no unlinked event emitted', async () => {
    const events: Array<{ type: string; relPath: string }> = []
    watcher = new VaultWatcher(tmpDir, (event) => {
      events.push({ type: event.type, relPath: event.relPath })
    })
    watcher.start()

    // Write a file and wait for chokidar to settle (ignoreInitial means the
    // add event may or may not fire; we don't care — we just need the watcher
    // to be ready before we unlink).
    const filePath = path.join(tmpDir, 'self-written.md')
    await fs.writeFile(filePath, '# Self\n', 'utf-8')

    // Brief pause for chokidar to pick up the add (if any) and settle.
    await new Promise<void>((res) => setTimeout(res, 300))

    // Clear any spurious add/change events before the test proper.
    events.length = 0

    // Register the self-write BEFORE removing the file (mirrors vaultManager).
    watcher.registerSelfWrite(filePath)
    await fs.unlink(filePath)

    // Wait 1 s — enough for chokidar to fire if it were going to.
    await new Promise<void>((res) => setTimeout(res, 1000))

    const unlinkedEvents = events.filter(
      (e) => e.type === 'unlinked' && e.relPath === 'self-written.md',
    )
    expect(unlinkedEvents).toHaveLength(0)
  }, 8000)

  it('unregistered unlink IS emitted', async () => {
    const events: Array<{ type: string; relPath: string }> = []
    watcher = new VaultWatcher(tmpDir, (event) => {
      events.push({ type: event.type, relPath: event.relPath })
    })
    watcher.start()

    // Write and settle.
    const filePath = path.join(tmpDir, 'external.md')
    await fs.writeFile(filePath, '# External\n', 'utf-8')
    await new Promise<void>((res) => setTimeout(res, 300))
    events.length = 0

    // Remove WITHOUT registering — simulates an external deletion.
    await fs.unlink(filePath)

    // Wait for chokidar to emit the unlink event.
    const seen = await waitFor(() =>
      events.some((e) => e.type === 'unlinked' && e.relPath === 'external.md'),
    )
    expect(seen).toBe(true)
  }, 8000)
})
