/**
 * Pure utilities for overlaying / extracting collapsed state on `Bullet[]` trees.
 *
 * `collapsed` is a runtime flag on bullets — it is NOT encoded in the markdown
 * body. Instead it lives in `frontmatter.todontic.collapsed` as an array of
 * bare 6-char block IDs (FR-6).
 *
 * These helpers are FS-free and do not depend on BlockNote so they can be unit-
 * tested independently (R6 mitigation).
 */

import type { Bullet } from '@todontic/core'
import { generateBlockId } from '@todontic/core'

// ─── Overlay (disk → memory) ──────────────────────────────────────────────────

/**
 * Overlay the `collapsed` flag onto a bullet tree from a set of collapsed IDs.
 *
 * Any bullet whose `blockId` appears in `collapsedIds` has `collapsed = true`;
 * all others have `collapsed = false`.
 *
 * Returns a new tree (does not mutate the input).
 *
 * @param bullets - The bullet tree from `parseOutline`.
 * @param collapsedIds - Set of bare 6-char block IDs from `todontic.collapsed`.
 * @returns New `Bullet[]` with `collapsed` flags applied.
 */
export function overlayCollapsed(bullets: Bullet[], collapsedIds: Set<string>): Bullet[] {
  return bullets.map((b) => ({
    ...b,
    collapsed: b.blockId ? collapsedIds.has(b.blockId) : false,
    children: overlayCollapsed(b.children, collapsedIds),
  }))
}

// ─── Extract (memory → disk) ──────────────────────────────────────────────────

/**
 * Extract the set of block IDs for all collapsed bullets.
 *
 * Bullets without a block ID that are collapsed are skipped here — the caller
 * must assign an ID before calling this (via `assignBlockIdIfCollapsing`).
 *
 * @param bullets - The current bullet tree.
 * @returns Set of bare 6-char block IDs of collapsed bullets.
 */
export function extractCollapsedIds(bullets: Bullet[]): Set<string> {
  const ids = new Set<string>()
  collectCollapsedIds(bullets, ids)
  return ids
}

function collectCollapsedIds(bullets: Bullet[], ids: Set<string>): void {
  for (const b of bullets) {
    if (b.collapsed && b.blockId) {
      ids.add(b.blockId)
    }
    collectCollapsedIds(b.children, ids)
  }
}

// ─── Toggle helpers ───────────────────────────────────────────────────────────

/**
 * Toggle the `collapsed` flag of a single bullet by ID, assigning a block ID
 * lazily if the bullet does not yet have one (FR-6, FR-7).
 *
 * Returns a tuple of:
 *  - The new tree (immutable update).
 *  - The final bullet ID that was toggled (same as input if already had one, or
 *    the newly assigned ID).
 *
 * **Callers must persist the new blockId** to disk on the next debounced save.
 *
 * @param bullets - Current bullet tree.
 * @param bulletSessionId - The `Bullet.id` (session ID) of the bullet to toggle.
 * @param rng - Optional rng for deterministic tests.
 * @returns `[newBullets, assignedBlockId | null]`. `null` if bullet not found.
 */
export function toggleCollapsed(
  bullets: Bullet[],
  bulletSessionId: string,
  rng?: () => number,
): [Bullet[], string | null] {
  let assignedBlockId: string | null = null

  function toggle(bs: Bullet[]): Bullet[] {
    return bs.map((b) => {
      if (b.id === bulletSessionId) {
        let blockId = b.blockId
        if (!blockId) {
          // Lazy assignment (FR-7).
          blockId = generateBlockId(rng)
          assignedBlockId = blockId
        }
        return { ...b, blockId, collapsed: !b.collapsed, children: b.children }
      }
      return { ...b, children: toggle(b.children) }
    })
  }

  const newBullets = toggle(bullets)
  return [newBullets, assignedBlockId]
}

/**
 * Toggle ALL bullets to the target collapsed state.
 *
 * Used for `Cmd-Shift-,` (collapse all) and expand all.
 * Bullets without a block ID that would be collapsed get IDs assigned lazily.
 *
 * @param bullets - Current bullet tree.
 * @param collapsed - Target state (`true` = collapse all, `false` = expand all).
 * @param rng - Optional rng for deterministic tests.
 * @returns New `Bullet[]` with all bullets set to the target state.
 */
export function toggleAllCollapsed(
  bullets: Bullet[],
  collapsed: boolean,
  rng?: () => number,
): Bullet[] {
  return bullets.map((b) => {
    let blockId = b.blockId
    if (collapsed && !blockId) {
      blockId = generateBlockId(rng)
    }
    return {
      ...b,
      blockId,
      collapsed,
      children: toggleAllCollapsed(b.children, collapsed, rng),
    }
  })
}

/**
 * Find a bullet by its session ID anywhere in the tree.
 *
 * @param bullets - The bullet tree.
 * @param id - The `Bullet.id` session ID to find.
 * @returns The matching `Bullet` or `null` if not found.
 */
export function findBullet(bullets: Bullet[], id: string): Bullet | null {
  for (const b of bullets) {
    if (b.id === id) return b
    const found = findBullet(b.children, id)
    if (found) return found
  }
  return null
}
