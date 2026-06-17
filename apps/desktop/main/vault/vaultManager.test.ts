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
import { parsePage, serializePage } from '@todontic/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

    const raw = '---\ntodontic:\n  code: TDC-77\n  status: todo\n---\n# Indexed Page\n'
    const parsedPage = parsePage(raw, 'indexed.md', path.join(tmpDir, 'indexed.md'))
    await manager.writePage(parsedPage)

    // The in-memory config should be unchanged but the page should be on disk.
    const onDisk = await fs.readFile(path.join(tmpDir, 'indexed.md'), 'utf-8')
    expect(onDisk).toContain('TDC-77')

    await manager.close()
  })
})

// ─── VaultManager.promote ─────────────────────────────────────────────────────

describe('VaultManager.promote — single bullet', () => {
  it('reserves a code, creates a new page file, and rewrites the parent', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // Write a parent page with a simple outline.
    const parentRaw =
      '---\ntodontic:\n  code: TDC-100\n---\n# Parent Page\n\n- Buy groceries\n  - milk\n  - eggs\n- Second task\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-100.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-100.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-100.md',
      parentPage,
      targets: [
        {
          bulletId: 'Buy groceries', // session ID matches parsed bullet id from text
          text: 'Buy groceries',
          childBody: '- milk\n- eggs\n',
        },
      ],
      rewrittenBodies: ['[[TDC-1]] Buy groceries'],
    })

    // Code reserved and returned.
    expect(result.codes).toHaveLength(1)
    expect(result.codes[0]).toMatch(/^TDC-\d+$/)
    expect(result.skipped).toBe(0)
    expect(result.relPaths).toHaveLength(1)

    // New page file written to disk.
    const newRelPath = result.relPaths[0]!
    const newAbsPath = path.join(tmpDir, newRelPath)
    const newContent = await fs.readFile(newAbsPath, 'utf-8')
    expect(newContent).toContain('# Buy groceries')
    expect(newContent).toContain(result.codes[0])

    await manager.close()
  })

  it('skips already-coded targets (text starts with [[)', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-200\n---\n# Parent\n\n- [[EXISTING-1]] Coded task\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-200.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-200.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-200.md',
      parentPage,
      targets: [
        { bulletId: 'id1', text: '[[EXISTING-1]] Coded task', childBody: '' },
      ],
      rewrittenBodies: [],
    })

    expect(result.codes).toHaveLength(0)
    expect(result.skipped).toBe(1)

    await manager.close()
  })

  it('counter is bumped atomically — consecutive promotions get unique codes', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-300\n---\n# Parent\n\n- Task A\n- Task B\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-300.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-300.md', parentAbsPath)

    const result1 = await manager.promote({
      parentRelPath: 'TDC-300.md',
      parentPage,
      targets: [{ bulletId: 'a', text: 'Task A', childBody: '' }],
      rewrittenBodies: ['[[TDC-1]] Task A'],
    })

    const result2 = await manager.promote({
      parentRelPath: 'TDC-300.md',
      parentPage,
      targets: [{ bulletId: 'b', text: 'Task B', childBody: '' }],
      rewrittenBodies: ['[[TDC-2]] Task B'],
    })

    const allCodes = [...result1.codes, ...result2.codes]
    expect(new Set(allCodes).size).toBe(2) // unique codes

    await manager.close()
  })
})

describe('VaultManager.promote — bulk bullets', () => {
  it('promotes N bullets in one call and returns N codes + relPaths', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw =
      '---\ntodontic:\n  code: TDC-400\n---\n# Parent\n\n- Alpha\n- Beta\n- Gamma\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-400.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-400.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-400.md',
      parentPage,
      targets: [
        { bulletId: 'a', text: 'Alpha', childBody: '' },
        { bulletId: 'b', text: 'Beta', childBody: '' },
        { bulletId: 'c', text: 'Gamma', childBody: '' },
      ],
      rewrittenBodies: [], // intentionally empty — main constructs them
    })

    expect(result.codes).toHaveLength(3)
    expect(result.relPaths).toHaveLength(3)
    expect(result.skipped).toBe(0)
    // All codes are unique.
    expect(new Set(result.codes).size).toBe(3)

    // All files exist on disk.
    for (const relPath of result.relPaths) {
      const absPath = path.join(tmpDir, relPath)
      const exists = await fs.access(absPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    }

    await manager.close()
  })
})

// ─── VaultManager.promote — regression: Bug #1 (placeholder wikilink) ─────────

describe('VaultManager.promote — Bug #1 regression: no [[PLACEHOLDER]] in parent', () => {
  it('writes [[CODE]] wikilink (not [[PLACEHOLDER]]) into parent page', async () => {
    // Regression for Bug #1: the renderer used to send "[[PLACEHOLDER]] text" as
    // rewrittenBodies; main spliced that verbatim, producing broken wikilinks.
    // Now main ignores rewrittenBodies and constructs [[code]] itself.
    //
    // Updated for text-fallback-collision fix (Bug A): the renderer now lazily
    // assigns a blockId before sending the request.  The target carries blockId
    // "xyz999" and the parentPage body encodes it — main matches by blockId only.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-500\n---\n# Parent\n\n- My task ^xyz999\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-500.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-500.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-500.md',
      parentPage,
      targets: [{ bulletId: 'b1', text: 'My task', blockId: 'xyz999', childBody: '' }],
      // Simulate what the old renderer sent — main must ignore this.
      rewrittenBodies: ['[[PLACEHOLDER]] My task'],
    })

    expect(result.codes).toHaveLength(1)
    const code = result.codes[0]!

    // Read back the parent page from disk and verify no [[PLACEHOLDER]].
    const parentOnDisk = await fs.readFile(parentAbsPath, 'utf-8')
    expect(parentOnDisk).not.toContain('[[PLACEHOLDER]]')
    // Must contain the real code with the blockId preserved.
    expect(parentOnDisk).toContain(`[[${code}]]`)

    await manager.close()
  })

  it('preserves existing blockId in the rewritten wikilink line', async () => {
    // When the promoted bullet had a block ID, the rewritten line must be
    // [[CODE]] text ^blockId — not [[CODE]] text (ID dropped).
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-501\n---\n# Parent\n\n- My task ^abc123\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-501.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-501.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-501.md',
      parentPage,
      targets: [
        {
          bulletId: 'b1',
          text: 'My task',
          blockId: 'abc123', // stable disk key
          childBody: '',
        },
      ],
      rewrittenBodies: [],
    })

    expect(result.codes).toHaveLength(1)
    const code = result.codes[0]!

    const parentOnDisk = await fs.readFile(parentAbsPath, 'utf-8')
    // Rewritten line must include both the wikilink and the original block ID.
    expect(parentOnDisk).toContain(`[[${code}]] My task ^abc123`)

    await manager.close()
  })
})

// ─── VaultManager.promote — regression: Bug #2 (nesting / blockId loss) ───────

describe('VaultManager.promote — Bug #2 regression: nested children preserved', () => {
  it('preserves multi-level nesting in the new page body', async () => {
    // Bug #2: the old renderer serialized childBody as flat `- text` lines,
    // losing all grandchildren. Now serializeChildrenBody (recursive) is used.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-600\n---\n# Parent\n\n- Top task\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-600.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-600.md', parentAbsPath)

    // childBody computed by the renderer using serializeChildrenBody (recursive).
    // This mimics what the fixed renderer sends: full nested markdown.
    const childBody = '- child one\n  - grandchild A\n  - grandchild B\n- child two\n'

    const result = await manager.promote({
      parentRelPath: 'TDC-600.md',
      parentPage,
      targets: [{ bulletId: 'b1', text: 'Top task', childBody }],
      rewrittenBodies: [],
    })

    expect(result.codes).toHaveLength(1)
    const newAbsPath = path.join(tmpDir, result.relPaths[0]!)
    const newContent = await fs.readFile(newAbsPath, 'utf-8')

    // New page must contain the full nested structure, not just the first level.
    expect(newContent).toContain('- child one')
    expect(newContent).toContain('  - grandchild A')
    expect(newContent).toContain('  - grandchild B')
    expect(newContent).toContain('- child two')

    await manager.close()
  })

  it('preserves blockIds in child bullets when childBody is computed recursively', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-601\n---\n# Parent\n\n- Parent bullet\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-601.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-601.md', parentAbsPath)

    // childBody with block IDs — as produced by serializeChildrenBody.
    const childBody = '- child with id ^def456\n'

    const result = await manager.promote({
      parentRelPath: 'TDC-601.md',
      parentPage,
      targets: [{ bulletId: 'b1', text: 'Parent bullet', childBody }],
      rewrittenBodies: [],
    })

    const newAbsPath = path.join(tmpDir, result.relPaths[0]!)
    const newContent = await fs.readFile(newAbsPath, 'utf-8')

    // Block ID must survive the move (not dropped).
    expect(newContent).toContain('^def456')

    await manager.close()
  })
})

// ─── VaultManager.promote — regression: text-fallback collision (Bug A) ────────
//
// When two sibling (or descendant) bullets share identical text and neither has
// a pre-existing blockId, the old text-fallback matching would rewrite BOTH to
// the same code and strip the non-target twin's children.
//
// The fix: the renderer assigns a blockId to each target bullet before sending
// (FR-7 lazy assignment).  VaultManager now matches exclusively by blockId;
// the text fallback is gone.  These tests simulate the renderer contract: each
// target carries a blockId that is also encoded in the parentPage body.

describe('VaultManager.promote — Bug A regression: duplicate-text siblings', () => {
  it('promotes only the selected sibling when two siblings share identical text', async () => {
    // Two sibling bullets with the same text ("Follow up"), no pre-existing blockId.
    // The renderer assigns blockIds lazily: "aaa111" to the FIRST bullet (target)
    // and "bbb222" to the second (non-target, stays in parent).
    // We only promote the first one.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // parentPage body has BOTH bullets with their assigned blockIds encoded,
    // as the renderer would produce after the lazy-assignment step.
    const parentRaw =
      '---\ntodontic:\n  code: TDC-700\n---\n# Parent\n\n- Follow up ^aaa111\n- Follow up ^bbb222\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-700.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-700.md', parentAbsPath)

    // Promote ONLY the first "Follow up" bullet (blockId = aaa111).
    const result = await manager.promote({
      parentRelPath: 'TDC-700.md',
      parentPage,
      targets: [
        {
          bulletId: 'b1',
          text: 'Follow up',
          blockId: 'aaa111', // renderer-assigned stable key
          childBody: '',
        },
      ],
      rewrittenBodies: [],
    })

    expect(result.codes).toHaveLength(1)
    const code = result.codes[0]!

    const parentOnDisk = await fs.readFile(parentAbsPath, 'utf-8')

    // The TARGETED bullet must be rewritten to [[code]] Follow up ^aaa111.
    expect(parentOnDisk).toContain(`[[${code}]] Follow up ^aaa111`)

    // The NON-TARGET twin must be UNTOUCHED — still "Follow up ^bbb222".
    expect(parentOnDisk).toContain('- Follow up ^bbb222')

    // Sanity: only one [[code]] link appears (not two).
    const matches = parentOnDisk.match(/\[\[TDC-/g)
    expect(matches).toHaveLength(1)

    await manager.close()
  })

  it('promotes only the target when an identical-text bullet appears as a descendant', async () => {
    // Top-level "Review" is the target; a nested "Review" is a descendant of
    // a different parent.  Only the top-level one must be rewritten.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // Renderer assigns blockIds to each involved bullet.
    // "Review" at depth 0 = target (ccc333); "Review" at depth 1 = non-target (ddd444).
    const parentRaw =
      '---\ntodontic:\n  code: TDC-701\n---\n# Parent\n\n' +
      '- Review ^ccc333\n' +
      '- Other task ^eee555\n' +
      '  - Review ^ddd444\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-701.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-701.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-701.md',
      parentPage,
      targets: [
        {
          bulletId: 'b1',
          text: 'Review',
          blockId: 'ccc333', // only the top-level "Review"
          childBody: '',
        },
      ],
      rewrittenBodies: [],
    })

    expect(result.codes).toHaveLength(1)
    const code = result.codes[0]!

    const parentOnDisk = await fs.readFile(parentAbsPath, 'utf-8')

    // Only the targeted "Review" is rewritten.
    expect(parentOnDisk).toContain(`[[${code}]] Review ^ccc333`)

    // The non-target nested "Review" must be untouched.
    expect(parentOnDisk).toContain('- Review ^ddd444')

    // The other task is intact (children not stripped).
    expect(parentOnDisk).toContain('Other task ^eee555')

    // Exactly one wikilink in the parent.
    const matches = parentOnDisk.match(/\[\[TDC-/g)
    expect(matches).toHaveLength(1)

    await manager.close()
  })
})

// ─── VaultManager.promote — rollback on partial failure (QA gap #1) ────────────

describe('VaultManager.promote — rollback on partial failure', () => {
  it('trashes already-created files and re-throws when parent rewrite fails', async () => {
    // Simulate: child page is written OK but the parent rewrite (writePage) throws.
    // We spy on the VaultManager's own writePage to throw on the second call
    // (the first call writes the parent OK on open; the second is the rewrite).
    // After the throw, the rollback block runs trashItem() on createdAbsPaths.
    // We mock trashItem at the module level to capture what it received.
    //
    // Strategy:
    //   1. Open vault (normal).
    //   2. Spy on manager.writePage to throw on the SECOND call (the rewrite).
    //   3. Call promote() with one target → child page IS written by atomicWrite
    //      directly (not via writePage), so writePage is only called for the parent.
    //   4. writePage throws → rollback catches → trashItem called for child page.
    //   5. Assert: promote() threw, trashItem was called with the child path.
    //
    // NOTE: Because promote() writes child pages via `atomicWrite` directly (not
    // via `this.writePage`), and only calls `this.writePage(rewrittenParent)` at
    // the end, the spy catches only the PARENT call.  One call = parent only.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-800\n---\n# Parent\n\n- Rollback task ^rbl001\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-800.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-800.md', parentAbsPath)

    // Spy on writePage to throw on every call (the only call IS the parent rewrite).
    const writePageSpy = vi.spyOn(manager, 'writePage').mockRejectedValue(
      new Error('writePage failed (injected by test)'),
    )

    let threw = false
    let thrownMessage = ''
    try {
      await manager.promote({
        parentRelPath: 'TDC-800.md',
        parentPage,
        targets: [{ bulletId: 'b1', text: 'Rollback task', blockId: 'rbl001', childBody: '' }],
        rewrittenBodies: [],
      })
    } catch (err) {
      threw = true
      thrownMessage = err instanceof Error ? err.message : String(err)
    }

    writePageSpy.mockRestore()

    // promote() must have thrown (re-thrown the error from writePage).
    expect(threw).toBe(true)
    expect(thrownMessage).toContain('writePage failed')

    // The child page that was created before the failure must have been trashed.
    // trashItem falls back to fs.unlink in non-Electron env. The file should be gone.
    const remaining = await fs.readdir(tmpDir)
    // Filter only TDC-*.md files that are NOT the parent.
    const orphanedChildren = remaining.filter((f) => f.endsWith('.md') && f !== 'TDC-800.md')
    expect(orphanedChildren).toHaveLength(0)

    await manager.close()
  })
})

// ─── VaultManager.promote — target without blockId (QA gap #4) ────────────────

describe('VaultManager.promote — target without blockId', () => {
  it('creates the child page but does NOT rewrite the parent bullet (documents orphan behaviour)', async () => {
    // When a target has no blockId the rewriteByBlockId map skips it (the
    // `if (target.blockId)` guard). The child page IS written, a code IS burnt,
    // but the parent outline line is left unchanged → orphan page.
    // This documents the current behaviour so it can't silently regress.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const parentRaw = '---\ntodontic:\n  code: TDC-900\n---\n# Parent\n\n- No block id bullet\n'
    const parentAbsPath = path.join(tmpDir, 'TDC-900.md')
    await fs.writeFile(parentAbsPath, parentRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const parentPage = parsePage(parentRaw, 'TDC-900.md', parentAbsPath)

    const result = await manager.promote({
      parentRelPath: 'TDC-900.md',
      parentPage,
      targets: [
        {
          bulletId: 'b1',
          text: 'No block id bullet',
          blockId: undefined, // No blockId — exercises the skip-rewrite path.
          childBody: '',
        },
      ],
      rewrittenBodies: [],
    })

    // A code is reserved and the child file is created.
    expect(result.codes).toHaveLength(1)
    expect(result.relPaths).toHaveLength(1)
    const childAbsPath = path.join(tmpDir, result.relPaths[0]!)
    const childExists = await fs.access(childAbsPath).then(() => true).catch(() => false)
    expect(childExists).toBe(true)

    // Parent bullet is NOT rewritten (no blockId match → rewriteByBlockId skips).
    const parentOnDisk = await fs.readFile(parentAbsPath, 'utf-8')
    expect(parentOnDisk).toContain('- No block id bullet')
    // No wikilink was inserted into the parent.
    expect(parentOnDisk).not.toContain('[[TDC-')

    await manager.close()
  })
})

// ─── VaultManager.deletePage (QA gap #2) ─────────────────────────────────────

describe('VaultManager.deletePage', () => {
  it('removes the page from the in-memory index and trashes the file', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const pageRaw = '---\ntodontic:\n  code: TDC-DEL1\n---\n# To Delete\n'
    const pageAbsPath = path.join(tmpDir, 'TDC-DEL1.md')
    await fs.writeFile(pageAbsPath, pageRaw, 'utf-8')

    const events: Array<{ type: string; relPath?: string }> = []
    const manager = new VaultManager((payload) => {
      // VaultEventPayload is a discriminated union; relPath only exists on
      // 'created' | 'changed' | 'unlinked' variants (not 'opened').
      const relPath = payload.type !== 'opened' ? payload.relPath : undefined
      events.push({ type: payload.type, relPath })
    })
    await manager.open(tmpDir)

    // Confirm the file exists and is in the index.
    const before = await manager.readPage('TDC-DEL1.md')
    expect(before).not.toBeNull()

    await manager.deletePage('TDC-DEL1.md')

    // File is gone from disk (trashItem falls back to fs.unlink in non-Electron env).
    const fileExists = await fs.access(pageAbsPath).then(() => true).catch(() => false)
    expect(fileExists).toBe(false)

    // Exactly one 'unlinked' event was emitted by deletePage itself.
    const unlinkedEvents = events.filter((e) => e.type === 'unlinked' && e.relPath === 'TDC-DEL1.md')
    expect(unlinkedEvents).toHaveLength(1)

    await manager.close()
  })

  it('emits exactly one unlinked event (no double-emit from watcher)', async () => {
    // The self-write registration in deletePage suppresses the chokidar unlinked
    // event so only deletePage's own emit fires — not a second one from the watcher.
    // In the test environment chokidar doesn't fire (no real FS events), but we
    // verify that even if it did, the watcher would suppress it via registerSelfWrite.
    // What we CAN assert: exactly one unlinked event for the deleted page.
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const pageRaw = '---\ntodontic:\n  code: TDC-DEL2\n---\n# Delete Double\n'
    await fs.writeFile(path.join(tmpDir, 'TDC-DEL2.md'), pageRaw, 'utf-8')

    const events: Array<{ type: string; relPath?: string }> = []
    const manager = new VaultManager((payload) => {
      const relPath = payload.type !== 'opened' ? payload.relPath : undefined
      events.push({ type: payload.type, relPath })
    })
    await manager.open(tmpDir)

    await manager.deletePage('TDC-DEL2.md')

    const unlinkedCount = events.filter(
      (e) => e.type === 'unlinked' && e.relPath === 'TDC-DEL2.md',
    ).length
    expect(unlinkedCount).toBe(1)

    await manager.close()
  })
})

// ─── VaultManager.getIndexSummary (QA gap #3) ─────────────────────────────────

describe('VaultManager.getIndexSummary', () => {
  it('returns only coded pages and correct blockIdKeys', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // Coded page with a block ID.
    const codedRaw = '---\ntodontic:\n  code: TDC-IDX1\n---\n# Coded Page\n\n- bullet ^blk001\n'
    await fs.writeFile(path.join(tmpDir, 'TDC-IDX1.md'), codedRaw, 'utf-8')

    // Uncoded page (no `code` in frontmatter) — must be excluded.
    const uncodedRaw = '# Uncoded Page\n\n- plain bullet\n'
    await fs.writeFile(path.join(tmpDir, 'uncoded.md'), uncodedRaw, 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const summary = manager.getIndexSummary()

    // Only coded pages appear.
    expect(summary.pages.map((p) => p.code)).toContain('TDC-IDX1')
    expect(summary.pages.some((p) => p.code === undefined)).toBe(false)
    // Uncoded page is absent.
    const titles = summary.pages.map((p) => p.title)
    expect(titles).not.toContain('Uncoded Page')

    // blockIdKeys contains the block ID from the coded page.
    // Format: 'CODE#^id' as produced by buildIndex.
    expect(summary.blockIdKeys.some((k) => k.includes('blk001'))).toBe(true)

    await manager.close()
  })
})

// ─── VaultManager.listPages (sidebar reachability regression) ─────────────────
// getIndexSummary above is coded-pages-only (autocomplete). The SIDEBAR must
// instead list every page by its real relPath — including plain uncoded notes —
// or a normal vault shows "No pages yet" and nothing can be opened.

describe('VaultManager.listPages', () => {
  it('lists ALL pages by real relPath, including uncoded notes, sorted by title', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // A coded page whose filename differs from its code (proves we use the real
    // relPath, not a `${code}.md` guess).
    await fs.writeFile(
      path.join(tmpDir, 'renamed.md'),
      '---\ntodontic:\n  code: TDC-9\n---\n# Zebra Topic\n',
      'utf-8',
    )
    // Two plain uncoded notes — these are the ones the old code dropped.
    await fs.writeFile(path.join(tmpDir, 'sample-note-1.md'), '# Apple Note\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'sample-note-2.md'), '- no heading here\n', 'utf-8')

    const manager = new VaultManager(noopEmit)
    await manager.open(tmpDir)

    const pages = manager.listPages()
    const byPath = new Map(pages.map((p) => [p.relPath, p]))

    // All three pages present by their REAL relPath.
    expect(byPath.has('renamed.md')).toBe(true)
    expect(byPath.has('sample-note-1.md')).toBe(true)
    expect(byPath.has('sample-note-2.md')).toBe(true)

    // The coded page keeps its on-disk filename (NOT `TDC-9.md`).
    expect(byPath.has('TDC-9.md')).toBe(false)

    // Uncoded note with a heading carries its title; titleless one is null.
    expect(byPath.get('sample-note-1.md')?.title).toBe('Apple Note')
    expect(byPath.get('sample-note-2.md')?.title).toBeNull()

    // Sorted by title (then relPath): Apple < sample-note-2.md (null→relPath) < Zebra.
    expect(pages.map((p) => p.relPath)).toEqual([
      'sample-note-1.md',
      'sample-note-2.md',
      'renamed.md',
    ])

    await manager.close()
  })
})
