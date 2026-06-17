import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Bullet } from '@todontic/core'
import {
  collectAncestorPath,
  findBulletByBlockId,
  useZoom,
} from './useZoom'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b(text: string, blockId?: string, children: Bullet[] = []): Bullet {
  return {
    id: text,
    text,
    blockId,
    collapsed: false,
    children,
  }
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

describe('findBulletByBlockId', () => {
  it('finds a bullet at root level', () => {
    const bullets = [b('a', 'aaa111'), b('b', 'bbb222')]
    expect(findBulletByBlockId(bullets, 'aaa111')?.text).toBe('a')
  })

  it('finds a nested bullet', () => {
    const child = b('child', 'ccc333')
    const parent = b('parent', 'ppp444', [child])
    expect(findBulletByBlockId([parent], 'ccc333')?.text).toBe('child')
  })

  it('returns null for missing blockId', () => {
    expect(findBulletByBlockId([b('a', 'aaa111')], 'zzz999')).toBeNull()
  })
})

describe('collectAncestorPath', () => {
  it('returns path for root-level bullet', () => {
    const bullets = [b('a', 'aaa111'), b('b', 'bbb222')]
    const path = collectAncestorPath(bullets, 'aaa111')
    expect(path).toHaveLength(1)
    expect(path![0]?.text).toBe('a')
  })

  it('returns path for nested bullet (parent → child)', () => {
    const child = b('child', 'ccc333')
    const parent = b('parent', 'ppp444', [child])
    const path = collectAncestorPath([parent], 'ccc333')
    expect(path).toHaveLength(2)
    expect(path![0]?.text).toBe('parent')
    expect(path![1]?.text).toBe('child')
  })

  it('returns null for missing blockId', () => {
    const path = collectAncestorPath([b('a', 'aaa111')], 'zzz999')
    expect(path).toBeNull()
  })
})

// ─── useZoom hook ──────────────────────────────────────────────────────────────

describe('useZoom — zoomIn', () => {
  it('sets zoomedBlockId on zoom', () => {
    const { result } = renderHook(() => useZoom())
    const bullets = [b('item', 'abc123')]

    act(() => {
      result.current.zoomIn(bullets[0]!, bullets)
    })

    expect(result.current.state.zoomedBlockId).toBe('abc123')
  })

  it('lazily assigns a block ID on first zoom when bullet has none', () => {
    const rng = () => 0 // deterministic → 'aaaaaa'
    const { result } = renderHook(() => useZoom(rng))
    const bullet = b('item') // no blockId

    let zoomResult!: ReturnType<typeof result.current.zoomIn>
    act(() => {
      zoomResult = result.current.zoomIn(bullet, [bullet])
    })

    expect(zoomResult.newlyAssignedBlockId).toBe('aaaaaa')
    expect(result.current.state.zoomedBlockId).toBe('aaaaaa')
  })

  it('does NOT assign a new ID if bullet already has one', () => {
    const { result } = renderHook(() => useZoom())
    const bullet = b('item', 'abc123')

    let zoomResult!: ReturnType<typeof result.current.zoomIn>
    act(() => {
      zoomResult = result.current.zoomIn(bullet, [bullet])
    })

    expect(zoomResult.newlyAssignedBlockId).toBeNull()
    expect(zoomResult.blockId).toBe('abc123')
  })

  it('builds breadcrumb path to zoom target', () => {
    const { result } = renderHook(() => useZoom())
    const child = b('child', 'ccc333')
    const parent = b('parent', 'ppp444', [child])
    const bullets = [parent]

    act(() => {
      result.current.zoomIn(child, bullets)
    })

    const { breadcrumb } = result.current.state
    expect(breadcrumb).toHaveLength(2)
    expect(breadcrumb[0]?.text).toBe('parent')
    expect(breadcrumb[1]?.text).toBe('child')
  })
})

describe('useZoom — zoomOut', () => {
  it('resets zoomedBlockId to null', () => {
    const { result } = renderHook(() => useZoom())
    const bullet = b('item', 'abc123')

    act(() => { result.current.zoomIn(bullet, [bullet]) })
    expect(result.current.state.zoomedBlockId).toBe('abc123')

    act(() => { result.current.zoomOut() })
    expect(result.current.state.zoomedBlockId).toBeNull()
    expect(result.current.state.breadcrumb).toHaveLength(0)
  })
})

describe('useZoom — zoomToBlockId', () => {
  it('zooms to an existing block ID', () => {
    const { result } = renderHook(() => useZoom())
    const bullets = [b('a', 'aaa111'), b('b', 'bbb222')]

    act(() => { result.current.zoomToBlockId('bbb222', bullets) })
    expect(result.current.state.zoomedBlockId).toBe('bbb222')
  })
})

describe('useZoom — reload returns to page root (FR-9)', () => {
  it('initial state is page root (not zoomed)', () => {
    const { result } = renderHook(() => useZoom())
    expect(result.current.state.zoomedBlockId).toBeNull()
    expect(result.current.state.breadcrumb).toHaveLength(0)
  })
})

describe('useZoom — lazy ID assigned once, not reassigned', () => {
  it('the same bullet gets the same ID on second zoom (not reassigned)', () => {
    let callCount = 0
    // rng increments: first call → 'aaaaaa', would return different if called again
    const deterministicRng = () => {
      const vals = [0, 0.5, 0.5, 0.5, 0.5, 0.5] // only first call used
      return vals[callCount++] ?? 0
    }
    const { result } = renderHook(() => useZoom(deterministicRng))
    const bullet = b('item')

    // First zoom: assigns ID.
    let r1!: ReturnType<typeof result.current.zoomIn>
    act(() => {
      r1 = result.current.zoomIn(bullet, [bullet])
    })
    const assignedId = r1.newlyAssignedBlockId!

    // Simulate bullet now has the assigned ID.
    const bulletWithId = { ...bullet, blockId: assignedId }
    act(() => { result.current.zoomOut() })

    // Second zoom: ID already present, NOT reassigned.
    let r2!: ReturnType<typeof result.current.zoomIn>
    act(() => {
      r2 = result.current.zoomIn(bulletWithId, [bulletWithId])
    })
    expect(r2.newlyAssignedBlockId).toBeNull()
    expect(r2.blockId).toBe(assignedId)
  })
})

// ─── QA Bug #3 / gap #7: nested bullet with no blockId retains ancestor breadcrumb

describe('useZoom — nested bullet without blockId retains ancestor breadcrumb (QA Bug #3)', () => {
  it('breadcrumb includes ancestor chain when zooming into a nested bullet with no blockId', () => {
    const rng = () => 0 // deterministic → 'aaaaaa'
    const { result } = renderHook(() => useZoom(rng))

    // Tree: grandparent → parent → child (no blockId)
    const child = b('child') // no blockId — will get lazily assigned
    const parent = b('parent', 'ppp444', [child])
    const grandparent = b('grandparent', 'ggg555', [parent])
    const allBullets = [grandparent]

    let zoomResult!: ReturnType<typeof result.current.zoomIn>
    act(() => {
      // The bullet object we pass is `child` (no blockId); allBullets is the full tree.
      zoomResult = result.current.zoomIn(child, allBullets)
    })

    // A new blockId must have been lazily assigned.
    expect(zoomResult.newlyAssignedBlockId).not.toBeNull()

    const { breadcrumb } = result.current.state
    // Breadcrumb must contain the full ancestor chain: grandparent → parent → child.
    expect(breadcrumb).toHaveLength(3)
    expect(breadcrumb[0]?.text).toBe('grandparent')
    expect(breadcrumb[1]?.text).toBe('parent')
    expect(breadcrumb[2]?.text).toBe('child')
    // Leaf breadcrumb entry has the newly-assigned blockId.
    expect(breadcrumb[2]?.blockId).toBe(zoomResult.newlyAssignedBlockId)
  })

  it('breadcrumb includes ancestor chain for a 2-level nested bullet with no blockId', () => {
    const rng = () => 0
    const { result } = renderHook(() => useZoom(rng))

    // Tree: parent (with blockId) → child (no blockId)
    const child = b('child item') // no blockId
    const parent = b('parent item', 'par001', [child])
    const allBullets = [parent]

    let zoomResult!: ReturnType<typeof result.current.zoomIn>
    act(() => {
      zoomResult = result.current.zoomIn(child, allBullets)
    })

    expect(zoomResult.newlyAssignedBlockId).not.toBeNull()

    const { breadcrumb } = result.current.state
    expect(breadcrumb).toHaveLength(2)
    expect(breadcrumb[0]?.text).toBe('parent item')
    expect(breadcrumb[1]?.text).toBe('child item')
  })
})
