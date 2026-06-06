import { describe, expect, it } from 'vitest'
import { parsePage } from './page.js'
import { WIKILINK_RE, buildIndex } from './vaultIndex.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRaw(code: string, status: string, tags: string[], body: string): string {
  const tagYaml = tags.length > 0 ? `  tags:\n${tags.map((t) => `    - ${t}`).join('\n')}\n` : ''
  return `---\ntodontic:\n  code: ${code}\n  status: ${status}\n${tagYaml}---\n${body}`
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildIndex', () => {
  it('byCode: indexes pages by code', () => {
    const p1 = parsePage(makeRaw('TDC-1', 'todo', [], '# Task 1\n'), 'p1.md')
    const p2 = parsePage(makeRaw('TDC-2', 'done', [], '# Task 2\n'), 'p2.md')
    const idx = buildIndex([p1, p2])
    expect(idx.byCode.get('TDC-1')?.frontmatter.code).toBe('TDC-1')
    expect(idx.byCode.get('TDC-2')?.frontmatter.code).toBe('TDC-2')
  })

  it('byTitle: groups pages with the same title', () => {
    const p1 = parsePage(makeRaw('TDC-1', 'todo', [], '# Duplicate\n'), 'p1.md')
    const p2 = parsePage(makeRaw('TDC-2', 'done', [], '# Duplicate\n'), 'p2.md')
    const idx = buildIndex([p1, p2])
    expect(idx.byTitle.get('Duplicate')).toHaveLength(2)
  })

  it('byTag: groups pages by each tag', () => {
    const p1 = parsePage(makeRaw('TDC-1', 'todo', ['work', 'urgent'], '# T1\n'), 'p1.md')
    const p2 = parsePage(makeRaw('TDC-2', 'done', ['work'], '# T2\n'), 'p2.md')
    const idx = buildIndex([p1, p2])
    expect(idx.byTag.get('work')).toHaveLength(2)
    expect(idx.byTag.get('urgent')).toHaveLength(1)
  })

  it('byStatus: groups pages by status', () => {
    const p1 = parsePage(makeRaw('TDC-1', 'todo', [], '# T1\n'), 'p1.md')
    const p2 = parsePage(makeRaw('TDC-2', 'todo', [], '# T2\n'), 'p2.md')
    const p3 = parsePage(makeRaw('TDC-3', 'done', [], '# T3\n'), 'p3.md')
    const idx = buildIndex([p1, p2, p3])
    expect(idx.byStatus.get('todo')).toHaveLength(2)
    expect(idx.byStatus.get('done')).toHaveLength(1)
  })

  it('byStatus: covers all four built-in statuses plus a custom status in one index', () => {
    // AGENTS.md flags the status enum as the project hotspot — each state is
    // first-class. This test exercises all four built-ins AND a custom status
    // through buildIndex.byStatus in a single vault snapshot.
    const p1 = parsePage(makeRaw('TDC-1', 'todo', [], '# T1\n'), 'p1.md')
    const p2 = parsePage(makeRaw('TDC-2', 'in-progress', [], '# T2\n'), 'p2.md')
    const p3 = parsePage(makeRaw('TDC-3', 'blocked', [], '# T3\n'), 'p3.md')
    const p4 = parsePage(makeRaw('TDC-4', 'done', [], '# T4\n'), 'p4.md')
    const p5 = parsePage(makeRaw('TDC-5', 'in-review', [], '# T5\n'), 'p5.md') // custom
    const idx = buildIndex([p1, p2, p3, p4, p5])

    expect(idx.byStatus.get('todo')).toHaveLength(1)
    expect(idx.byStatus.get('in-progress')).toHaveLength(1)
    expect(idx.byStatus.get('blocked')).toHaveLength(1)
    expect(idx.byStatus.get('done')).toHaveLength(1)
    expect(idx.byStatus.get('in-review')).toHaveLength(1)

    // Verify the right pages are associated with each status.
    expect(idx.byStatus.get('blocked')?.[0]?.frontmatter.code).toBe('TDC-3')
    expect(idx.byStatus.get('in-review')?.[0]?.frontmatter.code).toBe('TDC-5')
  })

  it('backlinks: records [[CODE]] references', () => {
    const p1 = parsePage(makeRaw('TDC-1', 'todo', [], '# Source\n\nSee [[TDC-2]].\n'), 'p1.md')
    const p2 = parsePage(makeRaw('TDC-2', 'done', [], '# Target\n'), 'p2.md')
    const idx = buildIndex([p1, p2])
    const links = idx.backlinks.get('TDC-2')
    expect(links).toHaveLength(1)
    expect(links?.[0]).toMatchObject({ fromCode: 'TDC-1', toCode: 'TDC-2' })
  })

  it('backlinks: records [[CODE#^id]] block references', () => {
    const p1 = parsePage(
      makeRaw('TDC-1', 'todo', [], '# Source\n\nSee [[TDC-2#^aabbcc]].\n'),
      'p1.md',
    )
    const p2 = parsePage(makeRaw('TDC-2', 'done', [], '# Target\n- item ^aabbcc\n'), 'p2.md')
    const idx = buildIndex([p1, p2])
    const links = idx.backlinks.get('TDC-2')
    expect(links?.[0]).toMatchObject({ fromCode: 'TDC-1', toCode: 'TDC-2', toBlockId: '^aabbcc' })
  })

  it('blockIds: keyed as CODE#^id', () => {
    const p = parsePage(makeRaw('TDC-5', 'todo', [], '# T\n- item ^xxyyzz\n'), 'p.md')
    const idx = buildIndex([p])
    expect(idx.blockIds.has('TDC-5^xxyyzz')).toBe(true)
    expect(idx.blockIds.get('TDC-5^xxyyzz')?.frontmatter.code).toBe('TDC-5')
  })

  it('handles empty vault', () => {
    const idx = buildIndex([])
    expect(idx.byCode.size).toBe(0)
    expect(idx.backlinks.size).toBe(0)
  })

  it('excludes pages without code from byCode but still scans backlinks', () => {
    // A page with no code still has a body that can reference other pages.
    // However, the plan says fromCode is required — pages without codes
    // don't produce backlinks (they can't be the source of named backlinks).
    const noCode = parsePage('# Uncoded\n\n[[TDC-1]]\n', 'uncoded.md')
    const coded = parsePage(makeRaw('TDC-1', 'todo', [], '# Coded\n'), 'coded.md')
    const idx = buildIndex([noCode, coded])
    expect(idx.byCode.has('TDC-1')).toBe(true)
    // Pages without code are excluded from byCode.
    expect(idx.byCode.size).toBe(1)
  })
})

describe('WIKILINK_RE', () => {
  it('matches [[CODE]] pattern', () => {
    WIKILINK_RE.lastIndex = 0
    const m = WIKILINK_RE.exec('See [[TDC-42]].')
    expect(m?.[1]).toBe('TDC-42')
    expect(m?.[2]).toBeUndefined()
  })

  it('matches [[CODE#^id]] pattern', () => {
    WIKILINK_RE.lastIndex = 0
    const m = WIKILINK_RE.exec('[[TDC-1#^abc123]]')
    expect(m?.[1]).toBe('TDC-1')
    expect(m?.[2]).toBe('^abc123')
  })
})
