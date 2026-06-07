/**
 * Unit tests for the BlockNote ↔ Bullet[] adapter.
 *
 * These tests are intentionally pure — they use minimal type stubs for BlockNote
 * blocks rather than importing the real BlockNote editor (which requires a DOM
 * environment the test runner cannot fully provide). Only the adapter's mapping
 * logic is exercised here; real editor behaviour is covered by Playwright e2e.
 */

import { describe, expect, it } from 'vitest'
import type { Block } from '@blocknote/core'
import type { Bullet } from '@todontic/core'
import {
  BLOCK_ID_PROP,
  blocksToBullets,
  bulletsToBlocks,
  stripBlockIds,
} from './blocknoteAdapter'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBullet(
  text: string,
  opts: Partial<Omit<Bullet, 'id' | 'text'>> = {},
): Bullet {
  return {
    id: 'b1',
    text,
    collapsed: false,
    children: [],
    ...opts,
  }
}

/** Minimal BlockNote block stub that satisfies the adapter's type reads. */
function makeBlock(
  text: string,
  opts: { blockId?: string; children?: Block[] } = {},
): Block {
  return {
    id: 'block-id',
    type: 'bulletListItem',
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    props: {
      [BLOCK_ID_PROP]: opts.blockId ?? '',
    },
    children: opts.children ?? [],
  } as unknown as Block
}

// ─── bulletsToBlocks ──────────────────────────────────────────────────────────

describe('bulletsToBlocks', () => {
  it('converts a flat bullet list to PartialBlock[]', () => {
    const bullets = [makeBullet('alpha'), makeBullet('beta')]
    const blocks = bulletsToBlocks(bullets)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.type).toBe('bulletListItem')
    // Text should be in content.
    const content0 = blocks[0]?.content as Array<{ text: string }>
    expect(content0[0]?.text).toBe('alpha')
  })

  it('stores blockId in the custom prop', () => {
    const b = makeBullet('item', { blockId: 'abc123' })
    const [block] = bulletsToBlocks([b])
    expect((block?.props as Record<string, string>)?.[BLOCK_ID_PROP]).toBe('abc123')
  })

  it('stores empty string prop when blockId is absent', () => {
    const b = makeBullet('item')
    const [block] = bulletsToBlocks([b])
    expect((block?.props as Record<string, string>)?.[BLOCK_ID_PROP]).toBe('')
  })

  it('converts nested bullets to nested children', () => {
    const child = makeBullet('child')
    const parent = makeBullet('parent', { children: [child] })
    const [block] = bulletsToBlocks([parent])
    const children = block?.children ?? []
    expect(children).toHaveLength(1)
    const childContent = (children[0] as { content: Array<{ text: string }> })?.content
    expect(childContent?.[0]?.text).toBe('child')
  })

  it('produces empty content array for empty text', () => {
    const b = makeBullet('')
    const [block] = bulletsToBlocks([b])
    expect(block?.content).toEqual([])
  })
})

// ─── blocksToBullets ──────────────────────────────────────────────────────────

describe('blocksToBullets', () => {
  it('converts a flat BlockNote block list to Bullet[]', () => {
    const blocks = [makeBlock('alpha'), makeBlock('beta')]
    const bullets = blocksToBullets(blocks)
    expect(bullets).toHaveLength(2)
    expect(bullets[0]?.text).toBe('alpha')
    expect(bullets[1]?.text).toBe('beta')
  })

  it('recovers blockId from the custom prop (exactly 6 chars)', () => {
    const block = makeBlock('item', { blockId: 'abc123' })
    const [b] = blocksToBullets([block])
    expect(b?.blockId).toBe('abc123')
  })

  it('sets blockId to undefined when prop is empty', () => {
    const block = makeBlock('item', { blockId: '' })
    const [b] = blocksToBullets([block])
    expect(b?.blockId).toBeUndefined()
  })

  it('sets blockId to undefined when prop has wrong length', () => {
    const block = makeBlock('item', { blockId: 'abc12' }) // only 5 chars
    const [b] = blocksToBullets([block])
    expect(b?.blockId).toBeUndefined()
  })

  it('converts nested children', () => {
    const child = makeBlock('child')
    const parent = makeBlock('parent', { children: [child] })
    const [b] = blocksToBullets([parent])
    expect(b?.children).toHaveLength(1)
    expect(b?.children[0]?.text).toBe('child')
  })

  it('sets collapsed to false on all bullets (overlay is applied separately)', () => {
    const block = makeBlock('item')
    const [b] = blocksToBullets([block])
    expect(b?.collapsed).toBe(false)
  })
})

// ─── Round-trip: Bullet[] → blocks → Bullet[] ─────────────────────────────────

describe('Bullet[] → blocks → Bullet[] round-trip', () => {
  it('preserves text and blockId through a full round-trip', () => {
    const original: Bullet[] = [
      makeBullet('alpha', { blockId: 'abc123' }),
      makeBullet('beta'),
    ]
    const blocks = bulletsToBlocks(original)
    const recovered = blocksToBullets(blocks as unknown as Block[])
    expect(recovered[0]?.text).toBe('alpha')
    expect(recovered[0]?.blockId).toBe('abc123')
    expect(recovered[1]?.text).toBe('beta')
    expect(recovered[1]?.blockId).toBeUndefined()
  })

  it('preserves nested structure through a full round-trip', () => {
    const child = makeBullet('child', { blockId: 'def456' })
    const parent = makeBullet('parent', { children: [child] })
    const blocks = bulletsToBlocks([parent])
    const recovered = blocksToBullets(blocks as unknown as Block[])
    expect(recovered[0]?.children[0]?.text).toBe('child')
    expect(recovered[0]?.children[0]?.blockId).toBe('def456')
  })
})

// ─── stripBlockIds ─────────────────────────────────────────────────────────────

describe('stripBlockIds', () => {
  it('removes blockId from all bullets (cross-page paste)', () => {
    const bullets = [
      makeBullet('a', { blockId: 'aaa111' }),
      makeBullet('b', { blockId: 'bbb222' }),
    ]
    const stripped = stripBlockIds(bullets)
    expect(stripped[0]?.blockId).toBeUndefined()
    expect(stripped[1]?.blockId).toBeUndefined()
  })

  it('removes blockId recursively from children', () => {
    const child = makeBullet('child', { blockId: 'ccc333' })
    const parent = makeBullet('parent', { blockId: 'ppp444', children: [child] })
    const [stripped] = stripBlockIds([parent])
    expect(stripped?.blockId).toBeUndefined()
    expect(stripped?.children[0]?.blockId).toBeUndefined()
  })

  it('returns a new array (does not mutate input)', () => {
    const bullets = [makeBullet('a', { blockId: 'aaa111' })]
    const stripped = stripBlockIds(bullets)
    expect(bullets[0]?.blockId).toBe('aaa111') // original unchanged
    expect(stripped[0]?.blockId).toBeUndefined()
  })
})
