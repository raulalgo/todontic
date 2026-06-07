/**
 * useZoom — zoom state and lazy block ID assignment for the outliner (US-009).
 *
 * When zoomed into a bullet, only that bullet's subtree is visible in the editor.
 * The bullet's text is shown as a header; its children are the visible outline.
 *
 * Lazy block ID assignment (FR-7, FR-8):
 *  On the first zoom into a bullet that has no block ID, a 6-char alnum block ID
 *  is generated and returned so the caller can persist it. The caller must:
 *  1. Update the bullet's `blockId` in the bullet tree.
 *  2. Schedule a save (via `useOutlinerDoc.updateBullets`).
 *  The ID is NOT generated again on subsequent zooms (idempotent once assigned).
 *
 * Session behaviour (FR-9):
 *  Zoom state is in-memory per window; it is not persisted to disk. Reloading
 *  the app returns to page root.
 *
 * Integration with useNavigation:
 *  Each zoom-in/out pushes/pops a NavEntry with `zoomBlockId` set. The navigation
 *  history therefore records zoom context (shared stack with page navigation).
 */

import { useCallback, useState } from 'react'
import { generateBlockId } from '@todontic/core'
import type { Bullet } from '@todontic/core'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Zoom state for the current editor view. */
export interface ZoomState {
  /**
   * The block ID the view is zoomed into, or null for page root.
   * This is the bare 6-char ID (without `^`).
   */
  zoomedBlockId: string | null
  /** Ancestor breadcrumb path from root to the current zoom target. */
  breadcrumb: BreadcrumbItem[]
}

/** One item in the zoom breadcrumb chain. */
export interface BreadcrumbItem {
  /** Bullet text (used for display). */
  text: string
  /** Block ID (used for navigation back up the zoom chain). */
  blockId: string | null
}

/** Result of zooming into a bullet. */
export interface ZoomInResult {
  /** The block ID that was used for the zoom. */
  blockId: string
  /**
   * If a new block ID was just assigned (lazy), this is it. The caller MUST
   * persist the updated bullet tree. Null if the bullet already had an ID.
   */
  newlyAssignedBlockId: string | null
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Find a bullet by its block ID anywhere in the tree.
 *
 * @param bullets - The full bullet tree.
 * @param blockId - The bare block ID to find.
 * @returns The matching bullet or null.
 */
export function findBulletByBlockId(bullets: Bullet[], blockId: string): Bullet | null {
  for (const b of bullets) {
    if (b.blockId === blockId) return b
    const found = findBulletByBlockId(b.children, blockId)
    if (found) return found
  }
  return null
}

/**
 * Collect the ancestor path from the root to the bullet with the given block ID.
 *
 * Returns the path including the target bullet itself.
 */
export function collectAncestorPath(bullets: Bullet[], targetBlockId: string): Bullet[] | null {
  for (const b of bullets) {
    if (b.blockId === targetBlockId) return [b]
    const childPath = collectAncestorPath(b.children, targetBlockId)
    if (childPath) return [b, ...childPath]
  }
  return null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Zoom state hook.
 *
 * @param rng - Optional injectable rng for deterministic tests (lazy ID assignment).
 */
export function useZoom(rng?: () => number) {
  const [zoomedBlockId, setZoomedBlockId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([])

  // ── Zoom into a bullet ────────────────────────────────────────────────────

  /**
   * Zoom into the given bullet. Lazily assigns a block ID if the bullet has none.
   *
   * @param bullet - The bullet to zoom into.
   * @param allBullets - Full bullet tree (for breadcrumb construction).
   * @returns `ZoomInResult` with the block ID used and any newly-assigned ID.
   */
  const zoomIn = useCallback(
    (bullet: Bullet, allBullets: Bullet[]): ZoomInResult => {
      let blockId = bullet.blockId
      let newlyAssignedBlockId: string | null = null

      if (!blockId) {
        // Lazy assignment (FR-7).
        blockId = generateBlockId(rng)
        newlyAssignedBlockId = blockId
      }

      // Bug #3 fix: build the breadcrumb BEFORE the new blockId is assigned to
      // the tree (the caller is responsible for persisting it).  When a blockId
      // was just minted, `collectAncestorPath` would search the OLD tree for the
      // NEW id — and fail.  Instead we:
      //  1. Locate the bullet in the tree by its EXISTING identity (blockId if it
      //     already has one, or by the bullet object's session `id`).
      //  2. If found, build the ancestor path from that position.
      //  3. Patch the LEAF entry with the newly-assigned blockId so the breadcrumb
      //     reflects the id that zoomOut will later need to zoom back.
      let path: Bullet[] | null = null
      if (!newlyAssignedBlockId) {
        // blockId was already present — normal lookup.
        path = collectAncestorPath(allBullets, blockId)
      } else {
        // Newly assigned: search the tree by session ID instead.
        function collectAncestorPathById(bullets: Bullet[], targetId: string): Bullet[] | null {
          for (const b of bullets) {
            if (b.id === targetId) return [b]
            const childPath = collectAncestorPathById(b.children, targetId)
            if (childPath) return [b, ...childPath]
          }
          return null
        }
        const pathById = collectAncestorPathById(allBullets, bullet.id)
        if (pathById) {
          // Patch the last entry (the target bullet) with the newly-assigned blockId.
          path = pathById.map((b, i) =>
            i === pathById.length - 1 ? { ...b, blockId } : b,
          )
        }
      }

      const fallback: Bullet = { ...bullet, blockId }
      const effectivePath = path ?? [fallback]
      const newBreadcrumb: BreadcrumbItem[] = effectivePath.map((b) => ({
        text: b.text,
        blockId: b.blockId ?? null,
      }))

      setZoomedBlockId(blockId)
      setBreadcrumb(newBreadcrumb)

      return { blockId, newlyAssignedBlockId }
    },
    [rng],
  )

  // ── Zoom to a specific block ID (e.g. from wikilink or breadcrumb) ────────

  /**
   * Zoom to a specific block ID.
   *
   * @param blockId - The target block ID.
   * @param allBullets - Full bullet tree (for breadcrumb construction).
   */
  const zoomToBlockId = useCallback((blockId: string, allBullets: Bullet[]) => {
    const path = collectAncestorPath(allBullets, blockId) ?? []
    const newBreadcrumb: BreadcrumbItem[] = path.map((b) => ({
      text: b.text,
      blockId: b.blockId ?? null,
    }))
    setZoomedBlockId(blockId)
    setBreadcrumb(newBreadcrumb)
  }, [])

  // ── Zoom out (back to root or parent) ─────────────────────────────────────

  /** Zoom back to page root. */
  const zoomOut = useCallback(() => {
    setZoomedBlockId(null)
    setBreadcrumb([])
  }, [])

  /**
   * Zoom to a breadcrumb item (ancestor zoom level).
   *
   * @param blockId - The block ID of the ancestor, or null for page root.
   * @param allBullets - Full bullet tree.
   */
  const zoomToBreadcrumb = useCallback(
    (blockId: string | null, allBullets: Bullet[]) => {
      if (!blockId) {
        zoomOut()
        return
      }
      zoomToBlockId(blockId, allBullets)
    },
    [zoomOut, zoomToBlockId],
  )

  return {
    state: { zoomedBlockId, breadcrumb } satisfies ZoomState,
    zoomIn,
    zoomOut,
    zoomToBlockId,
    zoomToBreadcrumb,
  }
}
