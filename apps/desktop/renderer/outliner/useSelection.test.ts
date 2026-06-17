import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Bullet } from '@todontic/core'
import { flattenBulletIds, rangeSelect, useSelection } from './useSelection'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b(id: string, children: Bullet[] = []): Bullet {
  return { id, text: id, collapsed: false, blockId: undefined, children }
}

const FLAT_TREE = [b('a'), b('b'), b('c'), b('d')]
const NESTED_TREE = [
  b('a', [b('a1'), b('a2')]),
  b('b'),
  b('c', [b('c1')]),
]

// ─── flattenBulletIds ─────────────────────────────────────────────────────────

describe('flattenBulletIds', () => {
  it('returns ids in document order for flat list', () => {
    expect(flattenBulletIds(FLAT_TREE)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns ids depth-first for nested list', () => {
    expect(flattenBulletIds(NESTED_TREE)).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1'])
  })

  it('returns empty array for empty tree', () => {
    expect(flattenBulletIds([])).toEqual([])
  })
})

// ─── rangeSelect ─────────────────────────────────────────────────────────────

describe('rangeSelect', () => {
  const allIds = ['a', 'b', 'c', 'd', 'e']

  it('selects range anchor→target (forward)', () => {
    expect(rangeSelect(allIds, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  it('selects range target→anchor (backward, same result)', () => {
    expect(rangeSelect(allIds, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  it('selects single item when anchor === target', () => {
    expect(rangeSelect(allIds, 'c', 'c')).toEqual(['c'])
  })

  it('returns empty when anchor not found', () => {
    expect(rangeSelect(allIds, 'z', 'b')).toEqual([])
  })
})

// ─── useSelection ─────────────────────────────────────────────────────────────

describe('useSelection — initial state', () => {
  it('starts with empty selection', () => {
    const { result } = renderHook(() => useSelection())
    expect(result.current.state.selectedIds.size).toBe(0)
    expect(result.current.state.anchorId).toBeNull()
  })
})

describe('useSelection — selectOne', () => {
  it('selects a single bullet and sets anchor', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    expect(result.current.state.selectedIds.has('a')).toBe(true)
    expect(result.current.state.anchorId).toBe('a')
  })

  it('replaces previous selection', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.selectOne('b') })
    expect(result.current.state.selectedIds.size).toBe(1)
    expect(result.current.state.selectedIds.has('b')).toBe(true)
  })
})

describe('useSelection — toggleSelect (Cmd-click)', () => {
  it('adds a bullet to selection', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.toggleSelect('b') })
    expect(result.current.state.selectedIds.has('a')).toBe(true)
    expect(result.current.state.selectedIds.has('b')).toBe(true)
  })

  it('removes a selected bullet', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.toggleSelect('a') })
    expect(result.current.state.selectedIds.has('a')).toBe(false)
  })

  it('does not move anchor', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.toggleSelect('b') })
    expect(result.current.state.anchorId).toBe('a')
  })
})

describe('useSelection — rangeSelectTo (Shift-click)', () => {
  it('selects range from anchor to target in document order', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('b') }) // anchor
    act(() => { result.current.rangeSelectTo('d', FLAT_TREE) })
    const selected = [...result.current.state.selectedIds].sort()
    expect(selected).toEqual(['b', 'c', 'd'])
  })

  it('selects range in reverse (click above anchor)', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('d') }) // anchor
    act(() => { result.current.rangeSelectTo('b', FLAT_TREE) })
    const selected = [...result.current.state.selectedIds].sort()
    expect(selected).toEqual(['b', 'c', 'd'])
  })

  it('preserves anchor after range select', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('b') })
    act(() => { result.current.rangeSelectTo('d', FLAT_TREE) })
    expect(result.current.state.anchorId).toBe('b')
  })
})

describe('useSelection — extendSelect (Shift-arrow)', () => {
  it('extends down from anchor', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('b') })
    act(() => { result.current.extendSelect('down', 'b', FLAT_TREE) })
    const selected = [...result.current.state.selectedIds]
    expect(selected).toContain('b')
    expect(selected).toContain('c')
  })

  it('extends up from anchor', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('c') })
    act(() => { result.current.extendSelect('up', 'c', FLAT_TREE) })
    const selected = [...result.current.state.selectedIds]
    expect(selected).toContain('b')
    expect(selected).toContain('c')
  })

  it('does not extend past the beginning of the list', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.extendSelect('up', 'a', FLAT_TREE) })
    const selected = [...result.current.state.selectedIds]
    expect(selected).toEqual(['a']) // clamped at start
  })

  it('does not extend past the end of the list', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('d') })
    act(() => { result.current.extendSelect('down', 'd', FLAT_TREE) })
    const selected = [...result.current.state.selectedIds]
    expect(selected).toEqual(['d']) // clamped at end
  })
})

describe('useSelection — clearSelection (Esc / navigation)', () => {
  it('clears selection and anchor', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.clearSelection() })
    expect(result.current.state.selectedIds.size).toBe(0)
    expect(result.current.state.anchorId).toBeNull()
  })
})

describe('useSelection — count', () => {
  it('returns 0 when nothing selected', () => {
    const { result } = renderHook(() => useSelection())
    expect(result.current.count).toBe(0)
  })

  it('returns the number of selected bullets', () => {
    const { result } = renderHook(() => useSelection())
    act(() => { result.current.selectOne('a') })
    act(() => { result.current.toggleSelect('b') })
    expect(result.current.count).toBe(2)
  })
})
