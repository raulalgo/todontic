/**
 * Unit tests for recentVaults.ts.
 *
 * `recentVaults.ts` calls `app.getPath('userData')` from Electron, which is
 * not available in the vitest Node environment.  We mock the `electron` module
 * so `app.getPath` returns a real tmp directory — this lets us exercise the
 * actual file-read/write paths without Electron.
 *
 * Cases:
 *   - add 6 vaults → only newest 5 kept (MAX_RECENT trim)
 *   - re-add existing path → moves to top without duplication (dedupe + promote)
 *   - corrupt/empty JSON file → listRecent returns []
 *   - non-array vaults field → listRecent returns []
 *   - getLastVault returns top path, or null when list is empty
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock `electron` before importing recentVaults ────────────────────────────

// The vi.mock factory runs before module imports, so recentVaults.ts will
// receive our mocked `app.getPath` when it imports `electron`.
let mockUserDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => mockUserDataDir,
  },
}))

// Import after mock registration.
const { addRecent, getLastVault, listRecent } = await import('./recentVaults.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'todontic-rv-'))
}

function recentFilePath(): string {
  return path.join(mockUserDataDir, 'recent-vaults.json')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('recentVaults', () => {
  beforeEach(async () => {
    mockUserDataDir = await makeTmpDir()
  })

  afterEach(async () => {
    if (mockUserDataDir) {
      await fs.rm(mockUserDataDir, { recursive: true, force: true })
    }
  })

  it('listRecent returns [] when no file exists', async () => {
    const result = await listRecent()
    expect(result).toEqual([])
  })

  it('addRecent persists a single vault entry', async () => {
    await addRecent('/vaults/my-vault')
    const result = await listRecent()
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe('/vaults/my-vault')
  })

  it('addRecent keeps newest first (newest-first ordering)', async () => {
    await addRecent('/vaults/a')
    await addRecent('/vaults/b')
    await addRecent('/vaults/c')
    const result = await listRecent()
    expect(result[0]?.path).toBe('/vaults/c')
    expect(result[1]?.path).toBe('/vaults/b')
    expect(result[2]?.path).toBe('/vaults/a')
  })

  it('MAX_RECENT trim: adding 6 vaults keeps only newest 5', async () => {
    for (let i = 1; i <= 6; i++) {
      await addRecent(`/vaults/vault-${i}`)
    }
    const result = await listRecent()
    expect(result).toHaveLength(5)
    // Newest first.
    expect(result[0]?.path).toBe('/vaults/vault-6')
    // Oldest (vault-1) is trimmed.
    expect(result.some((v) => v.path === '/vaults/vault-1')).toBe(false)
  })

  it('dedupe + promote: re-adding an existing path moves it to top without duplicating', async () => {
    await addRecent('/vaults/a')
    await addRecent('/vaults/b')
    await addRecent('/vaults/c')
    // Re-open /vaults/a — should move to top.
    await addRecent('/vaults/a')

    const result = await listRecent()
    expect(result[0]?.path).toBe('/vaults/a')
    // No duplicates.
    const paths = result.map((v) => v.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(result).toHaveLength(3)
  })

  it('corrupt JSON file → listRecent returns []', async () => {
    await fs.writeFile(recentFilePath(), '{ this is not json }', 'utf-8')
    const result = await listRecent()
    expect(result).toEqual([])
  })

  it('empty file → listRecent returns []', async () => {
    await fs.writeFile(recentFilePath(), '', 'utf-8')
    const result = await listRecent()
    expect(result).toEqual([])
  })

  it('non-array vaults field → listRecent returns []', async () => {
    await fs.writeFile(recentFilePath(), JSON.stringify({ vaults: 'not-an-array' }), 'utf-8')
    const result = await listRecent()
    expect(result).toEqual([])
  })

  it('getLastVault returns the most-recently-added path', async () => {
    await addRecent('/vaults/first')
    await addRecent('/vaults/second')
    const last = await getLastVault()
    expect(last).toBe('/vaults/second')
  })

  it('getLastVault returns null when list is empty', async () => {
    const last = await getLastVault()
    expect(last).toBeNull()
  })
})
