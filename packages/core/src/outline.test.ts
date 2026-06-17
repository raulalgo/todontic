import { describe, expect, it } from 'vitest'
import { parseOutline, serializeOutline } from './outline.js'
import type { Bullet } from './outline.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Bullet for test use. */
function bullet(
  text: string,
  opts: Partial<Omit<Bullet, 'id' | 'text'>> = {},
): Bullet {
  return {
    id: 'test',
    text,
    collapsed: false,
    children: [],
    ...opts,
  }
}

// ─── parseOutline ─────────────────────────────────────────────────────────────

describe('parseOutline — flat list', () => {
  it('parses a simple two-item flat list', () => {
    const body = '- alpha\n- beta\n'
    const { prefix, bullets, suffix } = parseOutline(body)
    expect(prefix).toBe('')
    expect(suffix).toBe('')
    expect(bullets).toHaveLength(2)
    expect(bullets[0]?.text).toBe('alpha')
    expect(bullets[1]?.text).toBe('beta')
  })

  it('returns empty bullets for a body with no list', () => {
    const body = '# Title\n\nJust prose here.\n'
    const { prefix, bullets, suffix } = parseOutline(body)
    expect(bullets).toHaveLength(0)
    expect(prefix).toBe(body)
    expect(suffix).toBe('')
  })

  it('returns empty bullets for an empty body', () => {
    const { bullets } = parseOutline('')
    expect(bullets).toHaveLength(0)
  })
})

describe('parseOutline — nested lists', () => {
  it('parses two-space nested items', () => {
    const body = '- parent\n  - child\n  - child2\n- sibling\n'
    const { bullets } = parseOutline(body)
    expect(bullets).toHaveLength(2)
    expect(bullets[0]?.text).toBe('parent')
    expect(bullets[0]?.children).toHaveLength(2)
    expect(bullets[0]?.children[0]?.text).toBe('child')
    expect(bullets[0]?.children[1]?.text).toBe('child2')
    expect(bullets[1]?.text).toBe('sibling')
  })

  it('parses three levels of nesting', () => {
    const body = '- a\n  - b\n    - c\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.text).toBe('a')
    const bBullet = bullets[0]?.children[0]
    expect(bBullet?.text).toBe('b')
    expect(bBullet?.children[0]?.text).toBe('c')
  })

  it('parses four-space indent as one depth level', () => {
    const body = '- parent\n    - child\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.children[0]?.text).toBe('child')
  })
})

describe('parseOutline — block IDs', () => {
  it('extracts block ID from bullet text', () => {
    const body = '- item with id ^abc123\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.blockId).toBe('abc123')
    expect(bullets[0]?.text).toBe('item with id')
  })

  it('leaves text without block ID unchanged', () => {
    const body = '- plain item\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.blockId).toBeUndefined()
    expect(bullets[0]?.text).toBe('plain item')
  })

  it('handles nested bullets with block IDs', () => {
    const body = '- parent ^aaa111\n  - child ^bbb222\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.blockId).toBe('aaa111')
    expect(bullets[0]?.children[0]?.blockId).toBe('bbb222')
  })
})

describe('parseOutline — prefix / suffix preservation', () => {
  it('extracts prose prefix before the list (byte-exact)', () => {
    const body = '# Heading\n\n- item\n'
    const { prefix, bullets, suffix } = parseOutline(body)
    expect(prefix).toBe('# Heading\n\n')
    expect(bullets).toHaveLength(1)
    expect(suffix).toBe('')
  })

  it('extracts prose suffix after the list (byte-exact)', () => {
    const body = '- item\n\nSome prose after.\n'
    const { prefix, bullets, suffix } = parseOutline(body)
    expect(prefix).toBe('')
    expect(bullets).toHaveLength(1)
    expect(suffix).toBe('\n\nSome prose after.\n')
  })

  it('handles prefix + list + suffix', () => {
    const body = '# H\n\n- item\n\nFootnote.\n'
    const { prefix, bullets, suffix } = parseOutline(body)
    expect(prefix).toBe('# H\n\n')
    expect(bullets).toHaveLength(1)
    expect(suffix).toBe('\n\nFootnote.\n')
  })
})

describe('parseOutline — foreign markers', () => {
  it('accepts * marker', () => {
    const body = '* item\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.text).toBe('item')
    expect(bullets[0]?.sourceMarker).toBe('*')
  })

  it('accepts + marker', () => {
    const body = '+ item\n'
    const { bullets } = parseOutline(body)
    expect(bullets[0]?.text).toBe('item')
    expect(bullets[0]?.sourceMarker).toBe('+')
  })
})

// ─── serializeOutline ─────────────────────────────────────────────────────────

describe('serializeOutline — basic', () => {
  it('serialises a flat list with - marker', () => {
    const region = { prefix: '', bullets: [bullet('alpha'), bullet('beta')], suffix: '' }
    const out = serializeOutline(region)
    expect(out).toBe('- alpha\n- beta')
  })

  it('returns prefix+suffix when bullets are empty', () => {
    const region = { prefix: '# Title\n\n', bullets: [], suffix: '\nExtra.\n' }
    expect(serializeOutline(region)).toBe('# Title\n\n\nExtra.\n')
  })

  it('serialises nested bullets with two-space indent', () => {
    const child = bullet('child')
    const parent = bullet('parent', { children: [child] })
    const region = { prefix: '', bullets: [parent], suffix: '' }
    expect(serializeOutline(region)).toBe('- parent\n  - child')
  })

  it('emits block ID suffix for bullets that have one', () => {
    const b = bullet('item', { blockId: 'abc123' })
    const region = { prefix: '', bullets: [b], suffix: '' }
    expect(serializeOutline(region)).toBe('- item ^abc123')
  })

  it('does NOT emit blockId when absent', () => {
    const b = bullet('item')
    const region = { prefix: '', bullets: [b], suffix: '' }
    expect(serializeOutline(region)).toBe('- item')
  })

  it('normalises * marker to -', () => {
    const b = bullet('item', { sourceMarker: '*' })
    const region = { prefix: '', bullets: [b], suffix: '' }
    expect(serializeOutline(region)).toBe('- item')
  })

  it('splices prefix and suffix around serialised region', () => {
    const b = bullet('item')
    const region = { prefix: '# Title\n\n', bullets: [b], suffix: '\n\nEnd.\n' }
    expect(serializeOutline(region)).toBe('# Title\n\n- item\n\nEnd.\n')
  })
})

// ─── Idempotence (D2) ─────────────────────────────────────────────────────────

describe('serializeOutline — idempotence on Todontic-normalised input', () => {
  it('round-trips a flat list byte-exact', () => {
    const body = '- alpha\n- beta\n'
    const region = parseOutline(body)
    // First serialize re-emits without trailing newline in the list.
    const out = serializeOutline(region)
    // Parse again and re-serialize.
    const region2 = parseOutline(out)
    const out2 = serializeOutline(region2)
    expect(out2).toBe(out)
  })

  it('round-trips a nested list byte-exact', () => {
    const body = '- parent\n  - child\n    - grandchild\n- sibling\n'
    const region = parseOutline(body)
    const out = serializeOutline(region)
    const out2 = serializeOutline(parseOutline(out))
    expect(out2).toBe(out)
  })

  it('round-trips block IDs byte-exact', () => {
    const body = '- item ^abc123\n  - nested ^def456\n'
    const region = parseOutline(body)
    const out = serializeOutline(region)
    const out2 = serializeOutline(parseOutline(out))
    expect(out2).toBe(out)
  })

  it('normalises foreign markers on first serialize, stable thereafter', () => {
    const body = '* alpha\n* beta\n'
    const first = serializeOutline(parseOutline(body))
    const second = serializeOutline(parseOutline(first))
    expect(first).toBe(second) // idempotent after first pass
    expect(first).toContain('- alpha') // normalised
  })

  it('normalises 4-space indent to 2-space on first serialize, stable thereafter', () => {
    const body = '- parent\n    - child\n'
    const first = serializeOutline(parseOutline(body))
    expect(first).toContain('  - child') // two-space indent
    const second = serializeOutline(parseOutline(first))
    expect(second).toBe(first)
  })
})

// ─── Prefix/suffix byte-exact (D2 — unedited surrounding prose) ───────────────

describe('parseOutline + serializeOutline — prefix/suffix preserved byte-exact', () => {
  it('preserves prose prefix even with exotic characters', () => {
    const prefix = '# Heading with "quotes" & <angle>\n\n'
    const body = `${prefix}- item\n`
    const { prefix: p } = parseOutline(body)
    expect(p).toBe(prefix)
  })

  it('full round-trip: prefix+list+suffix body is stable after serialize', () => {
    const body = '# H\n\n- alpha ^abc123\n  - beta\n- gamma\n\nPost-list prose.\n'
    const region = parseOutline(body)
    const out = serializeOutline(region)
    // Second pass must be stable.
    expect(serializeOutline(parseOutline(out))).toBe(out)
  })
})

// ─── Bug #6 regression: trailing newline preserved on first save ───────────────

describe('serializeOutline — Bug #6 regression: trailing newline preserved', () => {
  it('preserves trailing newline on the first serialize of a normalised body', () => {
    // Before the fix, `serializeOutline(parseOutline('- a\n- b\n'))` returned
    // `'- a\n- b'` (no trailing newline), causing a "No newline at end of file"
    // diff on the first save of any existing normalised Todontic page.
    const body = '- a\n- b\n'
    const out = serializeOutline(parseOutline(body))
    expect(out).toBe(body) // byte-stable on first serialize
  })

  it('preserves trailing newline for a single-item list', () => {
    const body = '- only item\n'
    expect(serializeOutline(parseOutline(body))).toBe(body)
  })

  it('preserves trailing newline for nested list', () => {
    const body = '- parent\n  - child\n'
    expect(serializeOutline(parseOutline(body))).toBe(body)
  })

  it('preserves trailing newline with prefix heading', () => {
    const body = '# Title\n\n- item\n'
    expect(serializeOutline(parseOutline(body))).toBe(body)
  })

  it('does NOT add spurious trailing newline when body has no trailing newline', () => {
    // Bodies without trailing newline should remain without one.
    // (These are non-normalised but we must not worsen them.)
    const body = '- a\n- b'
    const out = serializeOutline(parseOutline(body))
    expect(out).toBe(body)
  })

  it('is idempotent after first serialize (stable on subsequent saves)', () => {
    const body = '- x\n- y\n'
    const first = serializeOutline(parseOutline(body))
    const second = serializeOutline(parseOutline(first))
    expect(second).toBe(first)
    expect(first).toBe(body)
  })

  it('does not double-add newline when suffix already starts with newline', () => {
    // When suffix is non-empty (prose after the list), the suffix already begins
    // with '\n'; serializeOutline must NOT prepend another '\n'.
    const body = '- item\n\nPost-list prose.\n'
    const out = serializeOutline(parseOutline(body))
    expect(out).toBe(body)
    // Specifically: only one blank line between the list and the prose.
    expect(out).not.toContain('\n\n\n')
  })
})
