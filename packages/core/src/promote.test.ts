import { describe, expect, it } from 'vitest'
import type { Bullet } from './outline.js'
import {
  applyPromotionToParentBullets,
  isAlreadyCoded,
  planBulkPromotion,
  planPromotion,
  serializeChildrenBody,
} from './promote.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b(text: string, opts: Partial<Omit<Bullet, 'text'>> = {}): Bullet {
  return {
    id: opts.id ?? text,
    text,
    collapsed: false,
    blockId: undefined,
    children: [],
    ...opts,
  }
}

// ─── isAlreadyCoded ───────────────────────────────────────────────────────────

describe('isAlreadyCoded', () => {
  it('returns true for bullets whose text starts with [[', () => {
    expect(isAlreadyCoded(b('[[TDC-1]] some task'))).toBe(true)
  })

  it('returns false for normal bullets', () => {
    expect(isAlreadyCoded(b('a normal task'))).toBe(false)
  })

  it('handles leading whitespace', () => {
    expect(isAlreadyCoded(b('  [[TDC-1]] task'))).toBe(true)
  })
})

// ─── serializeChildrenBody ────────────────────────────────────────────────────

describe('serializeChildrenBody', () => {
  it('returns empty string for no children', () => {
    expect(serializeChildrenBody([])).toBe('')
  })

  it('serialises children as a bullet list', () => {
    const children = [b('child one'), b('child two')]
    const body = serializeChildrenBody(children)
    expect(body).toContain('- child one')
    expect(body).toContain('- child two')
  })
})

// ─── planPromotion ─────────────────────────────────────────────────────────────

describe('planPromotion — single bullet', () => {
  it('creates a new page body with H1 heading', () => {
    const bullet = b('Buy groceries')
    const plan = planPromotion(bullet, 'TDC-42')
    expect(plan.newPageTitle).toBe('Buy groceries')
    expect(plan.newPageBody).toContain('# Buy groceries')
  })

  it('moves sub-bullets into the new page body', () => {
    const child = b('milk')
    const parent = b('Shopping list', { children: [child] })
    const plan = planPromotion(parent, 'TDC-42')
    expect(plan.newPageBody).toContain('- milk')
  })

  it('rewrites the parent bullet to [[CODE]] text', () => {
    const bullet = b('Buy groceries')
    const plan = planPromotion(bullet, 'TDC-42')
    expect(plan.rewrittenLine).toBe('- [[TDC-42]] Buy groceries')
  })

  it('preserves existing blockId on the rewritten wikilink line', () => {
    const bullet = b('Buy groceries', { blockId: 'abc123' })
    const plan = planPromotion(bullet, 'TDC-42')
    expect(plan.rewrittenLine).toBe('- [[TDC-42]] Buy groceries ^abc123')
  })

  it('does NOT include blockId when absent', () => {
    const bullet = b('No id')
    const plan = planPromotion(bullet, 'TDC-1')
    expect(plan.rewrittenLine).not.toContain('^')
  })

  it('title equals bullet text (trimmed)', () => {
    const bullet = b('  Task with spaces  ')
    const plan = planPromotion(bullet, 'TDC-1')
    expect(plan.newPageTitle).toBe('Task with spaces')
    expect(plan.newPageBody).toContain('# Task with spaces')
  })
})

// ─── planBulkPromotion ────────────────────────────────────────────────────────

describe('planBulkPromotion — bulk', () => {
  const tree = [
    b('task one', { id: 'b1' }),
    b('task two', { id: 'b2' }),
    b('[[TDC-1]] already coded', { id: 'b3' }),
    b('task four', { id: 'b4' }),
  ]

  it('creates plans for non-coded bullets in order', () => {
    const { plans, skippedIndices } = planBulkPromotion(
      tree,
      ['b1', 'b2', 'b3', 'b4'],
      ['TDC-10', 'TDC-11', 'TDC-12'], // 3 codes for 3 non-skipped
    )
    expect(plans).toHaveLength(3)
    expect(plans[0]?.rewrittenLine).toContain('TDC-10')
    expect(plans[1]?.rewrittenLine).toContain('TDC-11')
    expect(plans[2]?.rewrittenLine).toContain('TDC-12')
    expect(skippedIndices).toContain(2) // b3 skipped (already coded)
  })

  it('records document order in plans', () => {
    const { plans } = planBulkPromotion(
      tree,
      ['b4', 'b1'], // reversed order
      ['TDC-10', 'TDC-11'],
    )
    expect(plans[0]?.newPageTitle).toBe('task four')
    expect(plans[1]?.newPageTitle).toBe('task one')
  })

  it('skips already-coded bullets and records their indices', () => {
    const { skippedIndices } = planBulkPromotion(
      tree,
      ['b1', 'b3', 'b4'],
      ['TDC-10', 'TDC-11'],
    )
    expect(skippedIndices).toEqual([1]) // b3 at index 1 in targetIds
  })
})

// ─── applyPromotionToParentBullets ────────────────────────────────────────────

describe('applyPromotionToParentBullets', () => {
  it('rewrites promoted bullets in place', () => {
    const tree = [b('alpha', { id: 'b1' }), b('beta', { id: 'b2' })]
    const plan = planPromotion(tree[0]!, 'TDC-42')
    const result = applyPromotionToParentBullets(
      tree,
      ['b1'],
      [plan],
      new Set([]),
    )
    expect(result[0]?.text).toContain('[[TDC-42]]')
    expect(result[1]?.text).toBe('beta') // unchanged
  })

  it('strips children from promoted bullets (they moved to new page)', () => {
    const child = b('child', { id: 'c1' })
    const parent = b('parent', { id: 'p1', children: [child] })
    const plan = planPromotion(parent, 'TDC-1')
    const result = applyPromotionToParentBullets([parent], ['p1'], [plan], new Set([]))
    expect(result[0]?.children).toHaveLength(0)
  })

  it('preserves non-promoted bullets unchanged', () => {
    const tree = [b('alpha', { id: 'b1' }), b('beta', { id: 'b2' })]
    const plan = planPromotion(tree[0]!, 'TDC-42')
    const result = applyPromotionToParentBullets(tree, ['b1'], [plan], new Set([]))
    expect(result[1]?.text).toBe('beta')
    expect(result[1]?.id).toBe('b2')
  })

  it('handles skipped indices correctly (skipped bullets not rewritten)', () => {
    const tree = [
      b('alpha', { id: 'b1' }),
      b('[[TDC-1]] coded', { id: 'b2' }),
      b('gamma', { id: 'b3' }),
    ]
    const plan = planPromotion(tree[0]!, 'TDC-42')
    // b2 is at index 1 and is skipped.
    const result = applyPromotionToParentBullets(
      tree,
      ['b1', 'b2', 'b3'],
      [plan, planPromotion(tree[2]!, 'TDC-43')],
      new Set([1]), // b2 skipped
    )
    expect(result[0]?.text).toContain('[[TDC-42]]')
    expect(result[1]?.text).toBe('[[TDC-1]] coded') // unchanged
    expect(result[2]?.text).toContain('[[TDC-43]]')
  })
})
