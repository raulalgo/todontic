import { describe, expect, it } from 'vitest'
import type { IndexSummary } from '@todontic/shared'
import {
  filterAutocomplete,
  parseWikilink,
  resolveWikilink,
} from './wikilinkResolve'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSummary(
  pages: Array<{ code: string; title: string | null }>,
  blockIdKeys: string[] = [],
): IndexSummary {
  return { pages, blockIdKeys }
}

// ─── parseWikilink ─────────────────────────────────────────────────────────────

describe('parseWikilink', () => {
  it('parses a plain code link', () => {
    const w = parseWikilink('TDC-42')
    expect(w.rawCode).toBe('TDC-42')
    expect(w.rawBlockId).toBeUndefined()
  })

  it('parses a block-suffixed link', () => {
    const w = parseWikilink('TDC-42#^abc123')
    expect(w.rawCode).toBe('TDC-42')
    expect(w.rawBlockId).toBe('abc123')
  })

  it('trims whitespace', () => {
    const w = parseWikilink('  TDC-42  ')
    expect(w.rawCode).toBe('TDC-42')
  })
})

// ─── resolveWikilink ───────────────────────────────────────────────────────────

describe('resolveWikilink — code hit', () => {
  it('resolves by exact code', () => {
    const summary = makeSummary([{ code: 'TDC-42', title: 'My Page' }])
    const result = resolveWikilink({ rawCode: 'TDC-42' }, summary)
    expect(result.kind).toBe('found')
    if (result.kind === 'found') {
      expect(result.code).toBe('TDC-42')
      expect(result.title).toBe('My Page')
    }
  })

  it('code match is case-sensitive (TDC-42 ≠ tdc-42)', () => {
    const summary = makeSummary([{ code: 'TDC-42', title: null }])
    const result = resolveWikilink({ rawCode: 'tdc-42' }, summary)
    // No title match either → broken.
    expect(result.kind).toBe('broken')
  })
})

describe('resolveWikilink — title fallback', () => {
  it('falls back to case-insensitive title match', () => {
    const summary = makeSummary([{ code: 'TDC-42', title: 'My Page' }])
    const result = resolveWikilink({ rawCode: 'my page' }, summary)
    expect(result.kind).toBe('found')
    if (result.kind === 'found') {
      expect(result.code).toBe('TDC-42')
    }
  })

  it('title match is case-insensitive', () => {
    const summary = makeSummary([{ code: 'TDC-42', title: 'Hello World' }])
    const result = resolveWikilink({ rawCode: 'HELLO WORLD' }, summary)
    expect(result.kind).toBe('found')
  })
})

describe('resolveWikilink — block suffix', () => {
  it('resolves a block-suffixed link when block exists', () => {
    const summary = makeSummary(
      [{ code: 'TDC-42', title: null }],
      ['TDC-42#^abc123'],
    )
    const result = resolveWikilink({ rawCode: 'TDC-42', rawBlockId: 'abc123' }, summary)
    expect(result.kind).toBe('found')
    if (result.kind === 'found') {
      expect(result.blockId).toBe('abc123')
    }
  })

  it('returns broken when block ID does not exist on the page', () => {
    const summary = makeSummary([{ code: 'TDC-42', title: null }], [])
    const result = resolveWikilink({ rawCode: 'TDC-42', rawBlockId: 'abc123' }, summary)
    expect(result.kind).toBe('broken')
    if (result.kind === 'broken') {
      expect(result.rawBlockId).toBe('abc123')
    }
  })
})

describe('resolveWikilink — broken', () => {
  it('returns broken for an unknown code with no title match', () => {
    const summary = makeSummary([{ code: 'TDC-1', title: 'First' }])
    const result = resolveWikilink({ rawCode: 'TDC-999' }, summary)
    expect(result.kind).toBe('broken')
    if (result.kind === 'broken') {
      expect(result.rawCode).toBe('TDC-999')
    }
  })

  it('returns broken for empty summary', () => {
    const result = resolveWikilink({ rawCode: 'TDC-1' }, makeSummary([]))
    expect(result.kind).toBe('broken')
  })
})

// ─── filterAutocomplete ────────────────────────────────────────────────────────

describe('filterAutocomplete', () => {
  const summary = makeSummary([
    { code: 'TDC-1', title: 'Alpha' },
    { code: 'TDC-2', title: 'Beta task' },
    { code: 'TDC-3', title: 'Gamma' },
    { code: 'PRJ-1', title: 'Project start' },
  ])

  it('returns all pages for empty query', () => {
    expect(filterAutocomplete('', summary)).toHaveLength(4)
  })

  it('filters by code prefix (case-insensitive)', () => {
    const results = filterAutocomplete('tdc', summary)
    expect(results.every((r) => r.code.startsWith('TDC'))).toBe(true)
    expect(results).toHaveLength(3)
  })

  it('filters by title substring (case-insensitive)', () => {
    const results = filterAutocomplete('task', summary)
    expect(results).toHaveLength(1)
    expect(results[0]?.code).toBe('TDC-2')
  })

  it('respects limit parameter', () => {
    const results = filterAutocomplete('', summary, 2)
    expect(results).toHaveLength(2)
  })
})
