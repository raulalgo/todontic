/**
 * useOutlinerDoc — document model + save/load + watcher reconciliation.
 *
 * Owns the in-memory state of the currently-open page:
 *  - `ParsedPage` + `Bullet[]` tree (from `parseOutline`).
 *  - `dirty` flag + 200ms debounced save (FR-2).
 *  - Collapsed state overlay (FR-6) + extraction on save.
 *  - Watcher reconciliation (US-003 / FR-3):
 *      - `changed` + clean → hot-reload.
 *      - `changed` + dirty → conflict banner.
 *      - `unlinked` → deleted banner.
 *
 * Architecture (D2):
 *  - Only the "outline region" (contiguous bullet list) is re-serialised on save.
 *    `prefix` / `suffix` around the list are preserved byte-exact.
 *  - `writePage` is NEVER called on pages the user has not edited.
 *  - `serializePage` is untouched — body is managed by `serializeOutline` + splice.
 *
 * This hook does NOT import BlockNote — it is a pure React/TS layer. The
 * BlockNote ↔ Bullet[] mapping lives in `blocknoteAdapter.ts`.
 */

import { parseOutline, serializeOutline } from '@todontic/core'
import type { Bullet, OutlineRegion } from '@todontic/core'
import type { ParsedPage, VaultEventPayload } from '@todontic/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { extractCollapsedIds, overlayCollapsed } from './collapseUtils'

// ─── Types ────────────────────────────────────────────────────────────────────

/** The state of the currently-open document. */
export interface OutlinerDocState {
  /** The full parsed page (frontmatter + body). */
  page: ParsedPage | null
  /** The bullet tree with collapsed flags overlaid. */
  bullets: Bullet[]
  /** The outline region (prefix/suffix preserved byte-exact). */
  region: OutlineRegion | null
  /** Whether there are unsaved changes. */
  dirty: boolean
  /** Watcher reconciliation banners. */
  conflict: boolean
  deleted: boolean
  /** True while the initial page load is in progress. */
  loading: boolean
  /** Error message from load/save, or null. */
  error: string | null
  /**
   * Monotonically increasing counter, incremented on every successful content
   * load (initial load + hot-reload + reload-from-disk). Outliner uses this to
   * detect same-path reloads and repaint the BlockNote editor (Bug #5 fix).
   */
  loadSeq: number
}

/** Minimal IPC surface required by the hook (mirrors VaultApi). */
export interface OutlinerDocVaultApi {
  readPage(relPath: string): Promise<ParsedPage | null>
  writePage(page: ParsedPage): Promise<void>
  onVaultEvent(cb: (payload: VaultEventPayload) => void): () => void
}

// ─── Debounce delay ───────────────────────────────────────────────────────────

const DEBOUNCE_MS = 200

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that manages the open page's document model.
 *
 * @param relPath - Vault-relative path of the page to open, or null.
 * @param vault   - IPC surface (real or mock in tests).
 * @returns Document state + mutation callbacks.
 */
export function useOutlinerDoc(relPath: string | null, vault: OutlinerDocVaultApi | null) {
  const [state, setState] = useState<OutlinerDocState>({
    page: null,
    bullets: [],
    region: null,
    dirty: false,
    conflict: false,
    deleted: false,
    loading: false,
    error: null,
    loadSeq: 0,
  })

  // Monotonic counter that increments on every successful page load.
  // Stored in a ref so loadPage can read/write it without re-creating itself.
  const loadSeqRef = useRef(0)

  // Ref to track dirty state without triggering re-renders in watcher handler.
  const dirtyRef = useRef(false)
  // Ref to the current bullets (for debounced save).
  const bulletsRef = useRef<Bullet[]>([])
  // Ref to the current page + region (for debounced save).
  const pageRef = useRef<ParsedPage | null>(null)
  const regionRef = useRef<OutlineRegion | null>(null)
  // Debounce timer.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load page ───────────────────────────────────────────────────────────────

  const loadPage = useCallback(
    async (path: string) => {
      if (!vault) return
      setState((s) => ({ ...s, loading: true, error: null, conflict: false, deleted: false }))
      try {
        const page = await vault.readPage(path)
        if (!page) {
          setState((s) => ({ ...s, loading: false, deleted: true }))
          return
        }
        const region = parseOutline(page.body)
        const collapsedIds = new Set<string>(
          Array.isArray(page.frontmatter.collapsed) ? (page.frontmatter.collapsed as string[]) : [],
        )
        const bullets = overlayCollapsed(region.bullets, collapsedIds)
        pageRef.current = page
        regionRef.current = { ...region, bullets }
        bulletsRef.current = bullets
        dirtyRef.current = false
        // Increment loadSeq on every successful load so the editor sync effect
        // can distinguish a same-path reload from no change (Bug #5 fix).
        const seq = ++loadSeqRef.current
        setState({
          page,
          bullets,
          region: { ...region, bullets },
          dirty: false,
          conflict: false,
          deleted: false,
          loading: false,
          error: null,
          loadSeq: seq,
        })
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },
    [vault],
  )

  // Load page when relPath changes.
  useEffect(() => {
    if (!relPath) {
      setState({
        page: null,
        bullets: [],
        region: null,
        dirty: false,
        conflict: false,
        deleted: false,
        loading: false,
        error: null,
        loadSeq: 0,
      })
      return
    }
    void loadPage(relPath)
  }, [relPath, loadPage])

  // ── Debounced save ──────────────────────────────────────────────────────────

  const scheduleSave = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      void performSave()
    }, DEBOUNCE_MS)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const performSave = useCallback(async () => {
    const page = pageRef.current
    const region = regionRef.current
    const bullets = bulletsRef.current
    if (!page || !region || !vault) return

    // Serialize the bullet region, preserving prefix/suffix byte-exact (D2).
    const newRegion = { ...region, bullets }
    const newBody = serializeOutline(newRegion)

    // Extract collapsed IDs to persist in frontmatter (FR-6).
    const collapsedIds = [...extractCollapsedIds(bullets)]

    const updatedPage: ParsedPage = {
      ...page,
      body: newBody,
      frontmatter: {
        ...page.frontmatter,
        collapsed: collapsedIds.length > 0 ? collapsedIds : undefined,
      },
    }

    try {
      await vault.writePage(updatedPage)
      pageRef.current = updatedPage
      dirtyRef.current = false
      setState((s) => ({ ...s, dirty: false, page: updatedPage }))
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }, [vault])

  // ── Public mutation: updateBullets ──────────────────────────────────────────

  /**
   * Update the bullet tree and schedule a debounced save.
   * Called by the BlockNote onChange handler (via the adapter).
   */
  const updateBullets = useCallback(
    (newBullets: Bullet[]) => {
      bulletsRef.current = newBullets
      dirtyRef.current = true
      if (regionRef.current) {
        regionRef.current = { ...regionRef.current, bullets: newBullets }
      }
      setState((s) => ({ ...s, bullets: newBullets, dirty: true }))
      scheduleSave()
    },
    [scheduleSave],
  )

  // ── Watcher reconciliation ──────────────────────────────────────────────────

  useEffect(() => {
    if (!vault || !relPath) return
    const unsub = vault.onVaultEvent((payload) => {
      if (payload.type === 'changed' && payload.relPath === relPath) {
        if (dirtyRef.current) {
          // User has unsaved changes — show conflict banner.
          setState((s) => ({ ...s, conflict: true }))
        } else {
          // Clean — hot-reload from disk.
          void loadPage(relPath)
        }
      } else if (payload.type === 'unlinked' && payload.relPath === relPath) {
        setState((s) => ({ ...s, deleted: true }))
      }
    })
    return unsub
  }, [vault, relPath, loadPage])

  // ── Cleanup debounce on unmount — flush any pending save (QA Bug #2) ────────
  // Previously only cleared the timer without flushing, silently losing edits
  // made within the 200ms debounce window before unmount or page navigation.
  // Now we flush synchronously (fire-and-forget but initiated before teardown).

  // Keep a stable ref to performSave so the cleanup closure captures the latest
  // version without triggering a re-registration of this effect.
  const performSaveRef = useRef(performSave)
  useEffect(() => {
    performSaveRef.current = performSave
  }, [performSave])

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
        // Flush the pending save so edits within the debounce window are not lost.
        void performSaveRef.current()
      }
    }
  }, [])

  // ── Conflict resolution ─────────────────────────────────────────────────────

  /** Keep local changes (dismiss conflict banner). */
  const keepMine = useCallback(() => {
    setState((s) => ({ ...s, conflict: false }))
  }, [])

  /** Reload from disk (accept external change, discard local edits). */
  const reloadFromDisk = useCallback(() => {
    if (!relPath) return
    dirtyRef.current = false
    setState((s) => ({ ...s, conflict: false, dirty: false }))
    void loadPage(relPath)
  }, [relPath, loadPage])

  // ── Force save (used by tests + undo) ───────────────────────────────────────

  const flushSave = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }
    await performSave()
  }, [performSave])

  return {
    state,
    updateBullets,
    keepMine,
    reloadFromDisk,
    flushSave,
    loadPage,
  }
}
