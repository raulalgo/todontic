/**
 * VaultManager integration tests.
 *
 * Covers the config/counter interaction that code-unit tests cannot reach:
 *   - reserveCodes updates the in-memory config (getConfig reflects the bump).
 *   - setConfig after reserveCodes never reverts the counter (Finding #1).
 *   - reserveCodes and setConfig share the mutex (no lost-update, Finding #2).
 *   - Concurrent reservations remain non-overlapping when serialised through
 *     VaultManager (not just the standalone codeCounterStore).
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serializePage } from '@todontic/core'
import { afterEach, describe, expect, it } from 'vitest'
import { initVault, loadConfig } from './configStore.js'
import { VaultManager } from './vaultManager.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'todontic-vm-'))
}

// A no-op event emitter — we don't need watcher events in these tests.
const noopEmit = () => {}

// ─── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

describe('VaultManager.reserveCodes', () => {
  it('allocates a single code and returns it', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const codes = await manager.reserveCodes('TDC', 1)
    expect(codes).toEqual(['TDC-1'])
  })

  it('updates in-memory config after reservation (getConfig reflects bumped counter)', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    await manager.reserveCodes('TDC', 3)
    // In-memory config must show next = 4 (not the open-time value of 1).
    expect(manager.getConfig().codePrefixes.TDC?.next).toBe(4)
  })

  it('persists the bumped counter to disk after reservation', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    await manager.reserveCodes('TDC', 2)
    const { config } = await loadConfig(tmpDir)
    expect(config.codePrefixes.TDC?.next).toBe(3)
  })

  it('concurrent reservations yield non-overlapping codes (mutex serialisation)', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    // Fire 5 concurrent reserve-1 calls through the same VaultManager.
    const promises = Array.from({ length: 5 }, () => manager.reserveCodes('TDC', 1))
    const results = await Promise.all(promises)
    const allCodes = results.flat()

    expect(new Set(allCodes).size).toBe(5)
    const nums = allCodes.map((c) => Number(c.split('-')[1])).sort((a, b) => a - b)
    expect(nums).toEqual([1, 2, 3, 4, 5])
  })
})

describe('VaultManager.setConfig', () => {
  it('updates user-editable fields and persists them', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    await manager.setConfig({
      codePrefix: 'PRJ',
      statuses: ['todo', 'done'],
      attachmentsPath: 'files',
    })

    const cfg = manager.getConfig()
    expect(cfg.codePrefix).toBe('PRJ')
    expect(cfg.statuses).toEqual(['todo', 'done'])
    expect(cfg.attachmentsPath).toBe('files')
  })

  it('seeds a new prefix with next:1 when it does not yet exist', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    await manager.setConfig({
      codePrefix: 'PRJ',
      statuses: ['todo'],
      attachmentsPath: 'attachments',
    })

    expect(manager.getConfig().codePrefixes.PRJ?.next).toBe(1)
  })

  it('NEVER reverts a bumped counter (Finding #1 regression)', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    // Step 1: reserve 5 codes → TDC.next bumped to 6 on disk and in memory.
    const first = await manager.reserveCodes('TDC', 5)
    expect(first).toEqual(['TDC-1', 'TDC-2', 'TDC-3', 'TDC-4', 'TDC-5'])

    // Step 2: user opens Settings and saves (the renderer would have a stale
    // snapshot with TDC.next = 1 — but the IPC layer now ignores codePrefixes).
    await manager.setConfig({
      codePrefix: 'TDC',
      statuses: ['todo', 'in-progress', 'blocked', 'done'],
      attachmentsPath: 'attachments',
    })

    // Step 3: next reservation must NOT reissue TDC-1..TDC-5.
    const second = await manager.reserveCodes('TDC', 3)
    expect(second).toEqual(['TDC-6', 'TDC-7', 'TDC-8'])

    // Verify no overlap between the two batches.
    const allCodes = [...first, ...second]
    expect(new Set(allCodes).size).toBe(allCodes.length)
  })

  it('counter is not clobbered by interleaved setConfig + reserveCodes (Finding #2)', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    // Fire setConfig and two reserveCodes concurrently — the mutex must
    // serialise them so no counter bump is lost.
    const [, codes1, codes2] = await Promise.all([
      manager.setConfig({
        codePrefix: 'TDC',
        statuses: ['todo', 'done'],
        attachmentsPath: 'attachments',
      }),
      manager.reserveCodes('TDC', 1),
      manager.reserveCodes('TDC', 1),
    ])

    // Both reservations must have received unique, non-overlapping codes.
    expect(codes1).toBeDefined()
    expect(codes2).toBeDefined()
    expect(codes1?.[0]).not.toBe(codes2?.[0])

    // On-disk counter must reflect both bumps.
    const { config } = await loadConfig(tmpDir)
    expect(config.codePrefixes.TDC?.next).toBe(3)
  })
})

// ─── VaultManager open / readPage / writePage ─────────────────────────────────

describe('VaultManager.setConfig — custom status persistence', () => {
  it('custom status list (with removed built-in) persists to disk and reloads intact', async () => {
    // Status enum hotspot: setConfig must write the exact status list (order +
    // custom + removed built-in) to disk so a subsequent loadConfig returns it
    // unchanged — this is the settings → config.yml → reload round-trip.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const customStatuses = ['todo', 'in-progress', 'in-review', 'done']
    await manager.setConfig({
      codePrefix: 'TDC',
      statuses: customStatuses,
      attachmentsPath: 'attachments',
    })

    // In-memory config must reflect the new statuses immediately.
    expect(manager.getConfig().statuses).toEqual(customStatuses)
    expect(manager.getConfig().statuses).not.toContain('blocked')

    // On-disk config must match (loadConfig re-reads fresh from disk).
    const { config: onDisk, error } = await loadConfig(tmpDir)
    expect(error).toBeUndefined()
    expect(onDisk.statuses).toEqual(customStatuses)
    expect(onDisk.statuses).not.toContain('blocked')
    expect(onDisk.statuses).toContain('in-review')

    await manager.close()
  })
})

describe('VaultManager.open', () => {
  it('scans md files and builds an in-memory index on open', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // Write two .md files directly (bypassing VaultManager) before opening.
    const page1Raw = '---\ntodontic:\n  code: TDC-1\n  status: todo\n---\n# First Page\n'
    const page2Raw = '---\ntodontic:\n  code: TDC-2\n  status: done\n---\n# Second Page\n'
    await fs.writeFile(path.join(tmpDir, 'page1.md'), page1Raw, 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'page2.md'), page2Raw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    expect(manager.isOpen()).toBe(true)
    expect(manager.getRootPath()).toBe(tmpDir)

    // getConfig should reflect what was persisted by initVault.
    const config = manager.getConfig()
    expect(config.codePrefix).toBe('TDC')

    await manager.close()
  })

  it('throws when vault is not initialised', async () => {
    tmpDir = await makeTmpDir()
    // No initVault — just an empty directory.
    const manager = new VaultManager(noopEmit)
    await expect(manager.open(tmpDir)).rejects.toThrow('not initialised')
  })

  it('closes any previously-open vault before re-opening', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)
    expect(manager.isOpen()).toBe(true)

    // Open again (idempotent close + reopen).
    await manager.open(tmpDir)
    expect(manager.isOpen()).toBe(true)

    await manager.close()
    expect(manager.isOpen()).toBe(false)
  })
})

describe('VaultManager.readPage', () => {
  it('returns null for a missing file', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const result = await manager.readPage('does-not-exist.md')
    expect(result).toBeNull()

    await manager.close()
  })

  it('reads and parses a page from disk', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const raw = '---\ntodontic:\n  code: TDC-42\n  status: todo\n---\n# Read Me\n'
    await fs.writeFile(path.join(tmpDir, 'read-me.md'), raw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const page = await manager.readPage('read-me.md')
    expect(page).not.toBeNull()
    expect(page?.frontmatter.code).toBe('TDC-42')
    expect(page?.title).toBe('Read Me')

    await manager.close()
  })
})

describe('VaultManager.writePage', () => {
  it('writes a page to disk byte-equal to serializePage output', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    // Write a new page via writePage.
    const raw =
      '---\ntodontic:\n  code: TDC-10\n  status: in-progress\n---\n# New Page\n\nBody text.\n'
    const page = (await manager.readPage('new-page.md')) ?? {
      relPath: 'new-page.md',
      filePath: path.join(tmpDir, 'new-page.md'),
      frontmatter: { code: 'TDC-10', status: 'in-progress' as const },
      foreignFrontmatter: '',
      todonticFirst: false,
      body: '# New Page\n\nBody text.\n',
      title: 'New Page',
      blockIds: [],
      hadFrontmatter: true,
      eol: '\n' as const,
      trailingNewline: true,
    }

    // Parse the raw to get a proper ParsedPage, then write it.
    const { parsePage } = await import('@todontic/core')
    const parsedPage = parsePage(raw, 'new-page.md', path.join(tmpDir, 'new-page.md'))
    await manager.writePage(parsedPage)

    // Read back from disk and compare bytes.
    const onDisk = await fs.readFile(path.join(tmpDir, 'new-page.md'), 'utf-8')
    expect(onDisk).toBe(serializePage(parsedPage))

    // readPage should return the written content.
    const readBack = await manager.readPage('new-page.md')
    expect(readBack?.frontmatter.code).toBe('TDC-10')
    expect(readBack?.body).toContain('Body text.')

    await manager.close()
  })

  it('writePage updates in-memory index immediately', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const { parsePage } = await import('@todontic/core')
    const raw = '---\ntodontic:\n  code: TDC-77\n  status: todo\n---\n# Indexed Page\n'
    const parsedPage = parsePage(raw, 'indexed.md', path.join(tmpDir, 'indexed.md'))
    await manager.writePage(parsedPage)

    // The in-memory config should be unchanged but the page should be on disk.
    const onDisk = await fs.readFile(path.join(tmpDir, 'indexed.md'), 'utf-8')
    expect(onDisk).toContain('TDC-77')

    await manager.close()
  })
})
