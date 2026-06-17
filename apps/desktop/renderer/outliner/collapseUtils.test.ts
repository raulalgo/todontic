import { describe, expect, it } from 'vitest'
import type { Bullet } from '@todontic/core'
import {
  extractCollapsedIds,
  findBullet,
  overlayCollapsed,
  toggleAllCollapsed,
  toggleCollapsed,
} from './collapseUtils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b(
  text: string,
  opts: Partial<Omit<Bullet, 'text'>> = {},
): Bullet {
  return {
    id: opts.id ?? text,
    text,
    collapsed: false,
    blockId: undefined,
    children: [],
    ...opts,
  }
}

// ─── overlayCollapsed ──────────────────────────────────────────────────────────

describe('overlayCollapsed', () => {
  it('sets collapsed=true for bullets whose blockId is in the set', () => {
    const bullets = [b('a', { blockId: 'aaa111' }), b('b', { blockId: 'bbb222' })]
    const result = overlayCollapsed(bullets, new Set(['aaa111']))
    expect(result[0]?.collapsed).toBe(true)
    expect(result[1]?.collapsed).toBe(false)
  })

  it('leaves collapsed=false for bullets without a blockId', () => {
    const bullets = [b('a')] // no blockId
    const result = overlayCollapsed(bullets, new Set(['aaa111']))
    expect(result[0]?.collapsed).toBe(false)
  })

  it('applies recursively to children', () => {
    const child = b('child', { blockId: 'ccc333' })
    const parent = b('parent', { children: [child] })
    const result = overlayCollapsed([parent], new Set(['ccc333']))
    expect(result[0]?.children[0]?.collapsed).toBe(true)
  })

  it('returns a new array (does not mutate input)', () => {
    const bullets = [b('a', { blockId: 'aaa111' })]
    overlayCollapsed(bullets, new Set(['aaa111']))
    expect(bullets[0]?.collapsed).toBe(false) // original unchanged
  })
})

// ─── extractCollapsedIds ───────────────────────────────────────────────────────

describe('extractCollapsedIds', () => {
  it('returns IDs of collapsed bullets', () => {
    const bullets = [
      b('a', { blockId: 'aaa111', collapsed: true }),
      b('b', { blockId: 'bbb222', collapsed: false }),
    ]
    const ids = extractCollapsedIds(bullets)
    expect(ids).toContain('aaa111')
    expect(ids).not.toContain('bbb222')
  })

  it('skips collapsed bullets without a blockId', () => {
    const bullets = [b('a', { collapsed: true })] // no blockId
    const ids = extractCollapsedIds(bullets)
    expect(ids.size).toBe(0)
  })

  it('collects IDs recursively from children', () => {
    const child = b('child', { blockId: 'ccc333', collapsed: true })
    const parent = b('parent', { children: [child] })
    const ids = extractCollapsedIds([parent])
    expect(ids).toContain('ccc333')
  })
})

// ─── toggleCollapsed ───────────────────────────────────────────────────────────

describe('toggleCollapsed', () => {
  it('toggles collapsed=false → true', () => {
    const bullets = [b('a', { id: 'b1', blockId: 'aaa111', collapsed: false })]
    const [newBullets] = toggleCollapsed(bullets, 'b1')
    expect(newBullets[0]?.collapsed).toBe(true)
  })

  it('toggles collapsed=true → false', () => {
    const bullets = [b('a', { id: 'b1', blockId: 'aaa111', collapsed: true })]
    const [newBullets] = toggleCollapsed(bullets, 'b1')
    expect(newBullets[0]?.collapsed).toBe(false)
  })

  it('assigns a blockId lazily when the bullet has none (FR-7)', () => {
    const bullets = [b('a', { id: 'b1' })] // no blockId
    const rng = () => 0 // deterministic → 'aaaaaa'
    const [newBullets, assignedId] = toggleCollapsed(bullets, 'b1', rng)
    expect(newBullets[0]?.blockId).toBe('aaaaaa')
    expect(assignedId).toBe('aaaaaa')
  })

  it('does not reassign an existing blockId', () => {
    const bullets = [b('a', { id: 'b1', blockId: 'aaa111' })]
    const [newBullets, assignedId] = toggleCollapsed(bullets, 'b1')
    expect(newBullets[0]?.blockId).toBe('aaa111')
    expect(assignedId).toBeNull() // no new ID assigned
  })

  it('returns null as the assigned ID when bullet already has a blockId', () => {
    const bullets = [b('a', { id: 'b1', blockId: 'aaa111' })]
    const [, assignedId] = toggleCollapsed(bullets, 'b1')
    expect(assignedId).toBeNull()
  })

  it('returns null if bullet ID not found', () => {
    const bullets = [b('a', { id: 'b1' })]
    const [, assignedId] = toggleCollapsed(bullets, 'nonexistent')
    expect(assignedId).toBeNull()
  })

  it('toggles nested children', () => {
    const child = b('child', { id: 'c1', blockId: 'ccc333', collapsed: false })
    const parent = b('parent', { id: 'p1', children: [child] })
    const [newBullets] = toggleCollapsed([parent], 'c1')
    expect(newBullets[0]?.children[0]?.collapsed).toBe(true)
  })
})

// ─── toggleAllCollapsed ────────────────────────────────────────────────────────

describe('toggleAllCollapsed', () => {
  it('collapses all bullets', () => {
    const bullets = [
      b('a', { id: 'b1', blockId: 'aaa111' }),
      b('b', { id: 'b2', blockId: 'bbb222' }),
    ]
    const result = toggleAllCollapsed(bullets, true)
    expect(result[0]?.collapsed).toBe(true)
    expect(result[1]?.collapsed).toBe(true)
  })

  it('expands all bullets', () => {
    const bullets = [
      b('a', { id: 'b1', blockId: 'aaa111', collapsed: true }),
    ]
    const result = toggleAllCollapsed(bullets, false)
    expect(result[0]?.collapsed).toBe(false)
  })

  it('assigns blockIds lazily to bullets being collapsed without one', () => {
    const rng = () => 0 // deterministic → 'aaaaaa'
    const bullets = [b('a', { id: 'b1' })] // no blockId
    const result = toggleAllCollapsed(bullets, true, rng)
    expect(result[0]?.blockId).toBe('aaaaaa')
  })

  it('does not assign blockIds when expanding', () => {
    const bullets = [b('a', { id: 'b1', collapsed: true })] // no blockId
    const result = toggleAllCollapsed(bullets, false)
    expect(result[0]?.blockId).toBeUndefined()
  })

  it('applies recursively to children', () => {
    const child = b('child', { id: 'c1', blockId: 'ccc333' })
    const parent = b('parent', { id: 'p1', blockId: 'ppp444', children: [child] })
    const result = toggleAllCollapsed([parent], true)
    expect(result[0]?.collapsed).toBe(true)
    expect(result[0]?.children[0]?.collapsed).toBe(true)
  })
})

// ─── findBullet ────────────────────────────────────────────────────────────────

describe('findBullet', () => {
  it('finds a bullet at root level', () => {
    const bullets = [b('a', { id: 'b1' }), b('b', { id: 'b2' })]
    expect(findBullet(bullets, 'b2')?.text).toBe('b')
  })

  it('finds a nested bullet', () => {
    const child = b('child', { id: 'c1' })
    const parent = b('parent', { id: 'p1', children: [child] })
    expect(findBullet([parent], 'c1')?.text).toBe('child')
  })

  it('returns null when not found', () => {
    const bullets = [b('a', { id: 'b1' })]
    expect(findBullet(bullets, 'nope')).toBeNull()
  })
})
