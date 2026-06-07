/**
 * useSelection — multi-select state for the outliner (US-008).
 *
 * Maintains an ordered set of selected bullet session IDs. Selection is:
 *  - **Shift-click**: range select (document order, inclusive).
 *  - **Cmd/Ctrl-click**: toggle individual bullet.
 *  - **Shift-↑/↓**: extend selection up/down in document order.
 *  - **Esc**: clear selection.
 *  - **Ephemeral**: cleared on page navigation (§9).
 *
 * "Document order" means the flattened depth-first traversal order of the
 * bullet tree (the order bullets appear on screen when fully expanded).
 *
 * This hook is FS-free and does not depend on BlockNote.
 */

import { useCallback, useState } from 'react'
import type { Bullet } from '@todontic/core'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Multi-select state. */
export interface SelectionState {
  /** Ordered set of selected bullet session IDs (in selection order, not doc order). */
  selectedIds: Set<string>
  /** The "anchor" bullet ID for shift-range operations. */
  anchorId: string | null
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Flatten a bullet tree into document order (depth-first traversal).
 *
 * Returns only the visible (non-collapsed-past) bullets for range computation.
 * For simplicity in range selection, we flatten the full tree regardless of
 * collapse state — collapsed bullets are still selectable.
 *
 * @param bullets - The bullet tree.
 * @returns Flat array of bullet session IDs in document order.
 */
export function flattenBulletIds(bullets: Bullet[]): string[] {
  const ids: string[] = []
  function traverse(bs: Bullet[]) {
    for (const b of bs) {
      ids.push(b.id)
      traverse(b.children)
    }
  }
  traverse(bullets)
  return ids
}

/**
 * Compute the range of IDs between `anchorId` and `targetId` (inclusive)
 * in document order.
 *
 * @param allIds - All bullet IDs in document order.
 * @param anchorId - The anchor ID.
 * @param targetId - The target ID.
 * @returns Slice of `allIds` from `anchorId` to `targetId` (inclusive).
 */
export function rangeSelect(allIds: string[], anchorId: string, targetId: string): string[] {
  const anchorIdx = allIds.indexOf(anchorId)
  const targetIdx = allIds.indexOf(targetId)
  if (anchorIdx === -1 || targetIdx === -1) return []
  const start = Math.min(anchorIdx, targetIdx)
  const end = Math.max(anchorIdx, targetIdx)
  return allIds.slice(start, end + 1)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Multi-select state hook.
 *
 * @returns Selection state and mutation callbacks.
 */
export function useSelection() {
  const [state, setState] = useState<SelectionState>({
    selectedIds: new Set(),
    anchorId: null,
  })

  // ── Clear ─────────────────────────────────────────────────────────────────

  /** Clear the selection (Esc or navigation). */
  const clearSelection = useCallback(() => {
    setState({ selectedIds: new Set(), anchorId: null })
  }, [])

  // ── Single click (no modifier) ────────────────────────────────────────────

  /**
   * Select a single bullet (no modifier key). Sets the anchor.
   *
   * @param id - Bullet session ID.
   */
  const selectOne = useCallback((id: string) => {
    setState({ selectedIds: new Set([id]), anchorId: id })
  }, [])

  // ── Cmd/Ctrl-click: toggle ────────────────────────────────────────────────

  /**
   * Toggle a bullet's selection (Cmd/Ctrl-click). Does not move the anchor.
   *
   * @param id - Bullet session ID.
   */
  const toggleSelect = useCallback((id: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      // Anchor stays, or becomes the toggled item if set was empty.
      return { selectedIds: next, anchorId: prev.anchorId ?? id }
    })
  }, [])

  // ── Shift-click: range ────────────────────────────────────────────────────

  /**
   * Range-select from the current anchor to `targetId` (Shift-click).
   * Replaces the current selection with the computed range.
   *
   * @param targetId  - The clicked bullet ID.
   * @param allBullets - Full bullet tree (used for document-order traversal).
   */
  const rangeSelectTo = useCallback(
    (targetId: string, allBullets: Bullet[]) => {
      setState((prev) => {
        const anchor = prev.anchorId ?? targetId
        const allIds = flattenBulletIds(allBullets)
        const range = rangeSelect(allIds, anchor, targetId)
        return { selectedIds: new Set(range), anchorId: anchor }
      })
    },
    [],
  )

  // ── Shift-arrow: extend ───────────────────────────────────────────────────

  /**
   * Extend the selection by one item in document order (Shift-↑/↓).
   *
   * @param direction  - `'up'` or `'down'`.
   * @param focusedId  - The currently focused bullet ID (used if selection is empty).
   * @param allBullets - Full bullet tree.
   */
  const extendSelect = useCallback(
    (direction: 'up' | 'down', focusedId: string, allBullets: Bullet[]) => {
      const allIds = flattenBulletIds(allBullets)
      setState((prev) => {
        const anchor = prev.anchorId ?? focusedId
        const anchorIdx = allIds.indexOf(anchor)
        if (anchorIdx === -1) return prev

        // Find the farthest extent of the current selection in the given direction.
        const selectedArr = [...prev.selectedIds]
        const extentIdx = direction === 'down'
          ? Math.max(...selectedArr.map((id) => allIds.indexOf(id)).filter((i) => i !== -1), anchorIdx)
          : Math.min(...selectedArr.map((id) => allIds.indexOf(id)).filter((i) => i !== -1), anchorIdx)

        const newExtentIdx = direction === 'down'
          ? Math.min(extentIdx + 1, allIds.length - 1)
          : Math.max(extentIdx - 1, 0)

        const newExtentId = allIds[newExtentIdx]
        if (!newExtentId) return prev

        const range = rangeSelect(allIds, anchor, newExtentId)
        return { selectedIds: new Set(range), anchorId: anchor }
      })
    },
    [],
  )

  return {
    state,
    clearSelection,
    selectOne,
    toggleSelect,
    rangeSelectTo,
    extendSelect,
    /** Convenience: selected count. */
    count: state.selectedIds.size,
  }
}
