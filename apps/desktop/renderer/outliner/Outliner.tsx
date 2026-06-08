/**
 * Outliner — BlockNote-powered bullet editor.
 *
 * This is the primary workspace surface (PRD-01). It renders a hierarchical
 * bullet list backed by our `parseOutline` / `serializeOutline` markdown
 * serialiser, not BlockNote's own markdown output (Architecture Decisions,
 * Rejected alternative 2).
 *
 * Slices implemented here:
 *  - Slice 0: editor shell, mount from App.tsx.
 *  - Slice 2: adapter (Bullet[]↔blocks) + keymap wired.
 *  - Slice 3: collapse/expand (useOutlinerDoc collapsed overlay).
 *  - Slice 4: save/load + watcher reconciliation (useOutlinerDoc persistence).
 *  - Slice 5: wikilink autocomplete (WikilinkMenu).
 *  - Slice 7: zoom + breadcrumb.
 *  - Slice 8: multi-select highlight + status bar.
 *  - Slice 9: single promote (Cmd-Enter) + navigation to new page.
 *  - Slice 10: bulk promote with PromoteDialog threshold (>10 bullets).
 */

import '@blocknote/mantine/style.css'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import type { Bullet } from '@todontic/core'
import { generateBlockId, serializeChildrenBody, serializeOutline } from '@todontic/core'
import type { IndexSummary, PromotionRequest, VaultApi } from '@todontic/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConflictBanner } from './banners/ConflictBanner'
import { DeletedBanner } from './banners/DeletedBanner'
import { Breadcrumb } from './Breadcrumb'
import { blocksToBullets, bulletsToBlocks } from './blocknoteAdapter'
import { findBullet, toggleAllCollapsed, toggleCollapsed } from './collapseUtils'
import { KEYS } from './keymap'
import { BULK_PROMOTE_THRESHOLD, PromoteDialog } from './PromoteDialog'
import { StatusBar } from './StatusBar'
import { useNavigation } from './useNavigation'
import { useOutlinerDoc } from './useOutlinerDoc'
import { useSelection } from './useSelection'
import { useZoom } from './useZoom'
import { WikilinkMenu } from './wikilink/WikilinkMenu'
import { parseWikilink, resolveWikilink } from './wikilink/wikilinkResolve'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Vault-relative path of the page being viewed, or undefined if none. */
  relPath?: string
  /** The vault IPC surface. Passed from App.tsx. */
  vault?: VaultApi | null
  /**
   * Optional callback invoked when internal navigation changes the active page
   * (e.g. after a single-bullet promote or a wikilink Cmd-Click).
   * App.tsx uses this to keep `activePage` in sync with the sidebar selection.
   */
  onNavigate?: (relPath: string) => void
}

/** The concrete BlockNote editor instance type (default schema). */
export type BlockNoteEditorInstance = ReturnType<typeof useCreateBlockNote>

// ─── PageEditor (keyed, remounts per loaded page) ───────────────────────────────

/** BlockNote requires a non-empty initialContent; placeholder for empty pages. */
const PLACEHOLDER_BLOCK: import('@blocknote/core').PartialBlock = {
  type: 'bulletListItem',
  content: [],
}

/**
 * Owns a single BlockNote editor instance built from `initialBullets`.
 *
 * Rendered with a `key` that changes on every page load (relPath + loadSeq +
 * zoom) so React remounts a fresh editor with the right content — replacing the
 * old imperative `replaceBlocks` swap, which was racy and could blank the editor
 * when switching pages after an in-app navigation. Mounting with `initialContent`
 * does NOT fire `onChange`, so a load is never mistaken for a user edit.
 */
function PageEditor({
  initialBullets,
  onReady,
  onChange,
}: {
  initialBullets: Bullet[]
  onReady: (editor: BlockNoteEditorInstance) => void
  onChange: () => void
}) {
  const editor = useCreateBlockNote({
    initialContent:
      initialBullets.length > 0 ? bulletsToBlocks(initialBullets) : [PLACEHOLDER_BLOCK],
  })
  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])
  return <BlockNoteView editor={editor} onChange={onChange} />
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Outliner host component.
 *
 * Renders a BlockNote editor wired to the page identified by `relPath`.
 * All slices through Slice 9 are integrated here.
 *
 * @param relPath - Vault-relative path of the page being viewed.
 * @param vault   - IPC surface (real: window.todontic.vault; mock in tests).
 */
export function Outliner({ relPath: initialRelPath, vault, onNavigate }: Props) {
  // ── Navigation history (Slice 6) ───────────────────────────────────────────
  const { state: navState, navigateTo, goBack, goForward } = useNavigation(
    initialRelPath ? { relPath: initialRelPath } : undefined,
  )

  const relPath = navState.current?.relPath ?? initialRelPath ?? null

  // ── Keep sidebar selection ⇄ internal nav history in one source of truth ────
  // `useNavigation` reads its initial entry only once (useState initializer), so
  // after any in-app navigation (promote / wikilink / zoom / back-forward) sets
  // `navState.current`, the `initialRelPath` prop alone is ignored — and the
  // sidebar, which drives only that prop, would silently stop switching pages.
  //
  // The two values must stay synced bidirectionally:
  //   - sidebar click → new `initialRelPath` prop → drive the nav history.
  //   - in-app navigation → new `navState.current` → drive App's `activePage`.
  //
  // Naïve "if A !== B, push" effects in BOTH directions oscillate: on the render
  // right after a sidebar click the prop is already the new page but nav state
  // is still the old one, so the prop→nav effect advances nav while the nav→prop
  // effect simultaneously pushes the STALE nav value back to the prop — A↔B
  // forever. The fix: act only on the side that actually changed since the last
  // sync (tracked via refs), never echo a value back to its own origin.
  const currentNavRelPath = navState.current?.relPath ?? null
  const lastPropRelPath = useRef(initialRelPath ?? null)
  const lastNavRelPath = useRef(currentNavRelPath)
  useEffect(() => {
    const propChanged = (initialRelPath ?? null) !== lastPropRelPath.current
    const navChanged = currentNavRelPath !== lastNavRelPath.current
    if (propChanged && initialRelPath && initialRelPath !== currentNavRelPath) {
      // External selection (sidebar / recents) → move the nav history to it.
      navigateTo({ relPath: initialRelPath })
    } else if (navChanged && currentNavRelPath && currentNavRelPath !== initialRelPath) {
      // In-app navigation → mirror the active page up so the sidebar follows.
      onNavigate?.(currentNavRelPath)
    }
    lastPropRelPath.current = initialRelPath ?? null
    lastNavRelPath.current = currentNavRelPath
  }, [initialRelPath, currentNavRelPath, navigateTo, onNavigate])

  // ── Document model (Slice 4) ──────────────────────────────────────────────
  const vaultApi = vault ?? null
  const { state: docState, updateBullets, keepMine, reloadFromDisk } = useOutlinerDoc(
    relPath,
    vaultApi,
  )

  // ── Zoom state (Slice 7) ──────────────────────────────────────────────────
  const { state: zoomState, zoomIn, zoomOut, zoomToBreadcrumb } = useZoom()

  // ── Selection state (Slice 8) ──────────────────────────────────────────────
  const {
    state: selectionState,
    clearSelection,
    selectOne,
    toggleSelect,
    rangeSelectTo,
    extendSelect,
    count: selectionCount,
  } = useSelection()

  // ── Wikilink autocomplete state (Slice 5 / US-004) ────────────────────────
  /**
   * When the user types `[[` in the editor we extract the query text (everything
   * after `[[` up to the cursor) and show the WikilinkMenu.  On selection we
   * insert `[[CODE]]` and close the menu.
   */
  const [wikilinkQuery, setWikilinkQuery] = useState<string | null>(null)
  // Position of the `[[` trigger in the editor text (used for replacement).
  const wikilinkTriggerPosRef = useRef<number | null>(null)
  // Live index summary for autocomplete — fetched once on mount, kept live via events.
  const [indexSummary, setIndexSummary] = useState<IndexSummary>({ pages: [], blockIdKeys: [] })

  // ── Promote state (Slice 9/10) ────────────────────────────────────────────
  const [promoting, setPromoting] = useState(false)
  const [promoteError, setPromoteError] = useState<string | null>(null)
  // Dialog for bulk promote confirmation (>BULK_PROMOTE_THRESHOLD).
  const [pendingTargets, setPendingTargets] = useState<PromotionRequest['targets'] | null>(null)
  const [pendingRelPath, setPendingRelPath] = useState<string | null>(null)
  // Updated parent page (with newly-assigned blockIds) for the pending bulk promote.
  const [pendingParentPage, setPendingParentPage] = useState<import('@todontic/shared').ParsedPage | null>(null)

  // ── Load and keep index summary live (US-004) ────────────────────────────
  useEffect(() => {
    if (!vaultApi) return
    let cancelled = false
    void vaultApi.getIndexSummary().then((summary) => {
      if (!cancelled) setIndexSummary(summary)
    })
    const unsub = vaultApi.onVaultEvent((payload) => {
      if (payload.type === 'created' || payload.type === 'unlinked') {
        void vaultApi.getIndexSummary().then((summary) => {
          if (!cancelled) setIndexSummary(summary)
        })
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [vaultApi])

  // ── BlockNote editor (Slice 0/2) ──────────────────────────────────────────

  // Compute visible bullets: when zoomed, show only the zoomed subtree.
  const visibleBullets: Bullet[] = useMemo(() => {
    const bullets = docState.bullets
    if (!zoomState.zoomedBlockId) return bullets
    // Find the zoomed bullet and return its children as the visible outline.
    function findByBlockId(bs: Bullet[]): Bullet | null {
      for (const b of bs) {
        if (b.blockId === zoomState.zoomedBlockId) return b
        const found = findByBlockId(b.children)
        if (found) return found
      }
      return null
    }
    const zoomed = findByBlockId(bullets)
    return zoomed?.children ?? bullets
  }, [docState.bullets, zoomState.zoomedBlockId])

  // The live BlockNote editor instance. It lives in the keyed <PageEditor>
  // child (below) so a page LOAD remounts a fresh editor with the correct
  // initialContent — no imperative `replaceBlocks`. Imperative content swapping
  // was racy: under load it intermittently left the editor blank when switching
  // pages after an in-app navigation. The child reports its editor up via
  // `handleEditorReady`; all handlers read `editorRef.current` (guarded).
  const editorRef = useRef<BlockNoteEditorInstance | null>(null)
  const handleEditorReady = useCallback((e: BlockNoteEditorInstance) => {
    editorRef.current = e
  }, [])

  // Handle editor changes → updateBullets (debounced save) + wikilink detection.
  const handleChange = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const newBullets = blocksToBullets(editor.document)
    updateBullets(newBullets)

    // US-004: Detect `[[` trigger in the focused block's text.
    // When the user types `[[` we open the wikilink autocomplete menu.
    try {
      const pos = editor.getTextCursorPosition()
      const block = pos.block
      if (!block) { setWikilinkQuery(null); return }
      // Extract text from the focused block.
      const text = Array.isArray(block.content)
        ? block.content
            .map((item: unknown) => {
              if (typeof item === 'object' && item !== null && 'text' in item) {
                return String((item as { text: unknown }).text)
              }
              return ''
            })
            .join('')
        : ''
      // Find last `[[` before cursor (simple heuristic — good enough for the
      // linear palette; a full cursor-offset approach needs BlockNote internals).
      const triggerIdx = text.lastIndexOf('[[')
      if (triggerIdx !== -1) {
        const afterTrigger = text.slice(triggerIdx + 2)
        // If there's no closing `]]` yet, show the menu.
        if (!afterTrigger.includes(']]')) {
          wikilinkTriggerPosRef.current = triggerIdx
          setWikilinkQuery(afterTrigger)
          return
        }
      }
    } catch {
      // Ignore errors reading cursor position.
    }
    setWikilinkQuery(null)
  }, [updateBullets])

  /**
   * Insert a wikilink `[[CODE]]` into the focused block, replacing the `[[query`
   * text that triggered the menu.
   */
  const handleWikilinkSelect = useCallback(
    (code: string) => {
      setWikilinkQuery(null)
      const editor = editorRef.current
      if (!editor) return
      // BlockNote doesn't expose a direct text-replace API in the stable v0.x
      // surface.  The cleanest approach: update the bullet text in our model,
      // then trigger a replaceBlocks so the editor reflects it.
      // We patch the focused block's text: replace `[[<query>` with `[[CODE]]`.
      const pos = editor.getTextCursorPosition()
      const block = pos.block
      if (!block) return
      const text = Array.isArray(block.content)
        ? block.content
            .map((item: unknown) =>
              typeof item === 'object' && item !== null && 'text' in item
                ? String((item as { text: unknown }).text)
                : ''
            )
            .join('')
        : ''
      const triggerIdx = text.lastIndexOf('[[')
      if (triggerIdx === -1) return
      const newText = `${text.slice(0, triggerIdx)}[[${code}]]`
      // Update the editor block.
      editor.updateBlock(block, {
        content: [{ type: 'text', text: newText, styles: {} }],
      })
      // Re-derive bullets and schedule save.
      const newBullets = blocksToBullets(editor.document)
      updateBullets(newBullets)
    },
    [updateBullets],
  )

  // ── Promote handler (Slice 9 / Slice 10) ────────────────────────────────

  /**
   * Execute the promotion for `targets` against `activeRelPath`.
   * Called after optional dialog confirmation.
   */
  const executePromote = useCallback(
    async (
      targets: PromotionRequest['targets'],
      activeRelPath: string,
      parentPageOverride?: import('@todontic/shared').ParsedPage,
    ) => {
      if (!vaultApi || !docState.page) return
      setPromoting(true)
      setPromoteError(null)
      try {
        // rewrittenBodies is intentionally empty: main constructs the actual
        // `[[CODE]] text` strings using the reserved codes it generates, so the
        // renderer never writes a placeholder wikilink (Bug #1 fix).
        //
        // parentPageOverride carries a body already containing the lazily-assigned
        // blockIds for targets that had none, so main can match exclusively by
        // blockId (Bug #3 / text-fallback-collision fix).
        const req: PromotionRequest = {
          parentRelPath: activeRelPath,
          parentPage: parentPageOverride ?? docState.page,
          targets,
          rewrittenBodies: [],
        }
        const result = await vaultApi.promote(req)
        if (result.codes.length > 0 && result.relPaths[0]) {
          // Single promote: navigate to the new page.
          // Bulk promote: stay on current page (US-010 AC).
          if (targets.length === 1) {
            navigateTo({ relPath: result.relPaths[0] })
            // Notify the parent (App.tsx) so the sidebar selection updates.
            onNavigate?.(result.relPaths[0])
          }
          clearSelection()
        }
        // TODO (Slice 11 undo): record undo transaction here.
      } catch (err) {
        setPromoteError(err instanceof Error ? err.message : String(err))
      } finally {
        setPromoting(false)
      }
    },
    [vaultApi, docState.page, navigateTo, clearSelection, onNavigate],
  )

  const handlePromote = useCallback(async () => {
    if (!vaultApi || !relPath || !docState.page || promoting) return
    const editor = editorRef.current
    if (!editor) return

    const bullets = docState.bullets
    if (bullets.length === 0) return

    // Find the focused block from BlockNote.
    const focusedBlock = editor.getTextCursorPosition().block
    if (!focusedBlock) return

    const currentBullets = blocksToBullets(editor.document)

    // Build the target list: multi-select or single focused bullet.
    const targetIds =
      selectionCount > 0
        ? [...selectionState.selectedIds]
        : (() => {
            const idx = editor.document.indexOf(focusedBlock)
            const b = currentBullets[idx]
            return b ? [b.id] : currentBullets[0] ? [currentBullets[0].id] : []
          })()

    if (targetIds.length === 0) return

    // FR-7 / US-005 / text-fallback-collision fix: ensure every target bullet
    // has a stable blockId before sending the promotion request.  Block IDs are
    // assigned lazily here for bullets that don't already have one.  We then
    // patch those IDs into the in-memory bullet tree so that
    // (a) the parentPage body sent to main reflects them (main can match by
    //     blockId exclusively — no text-based fallback needed), and
    // (b) the next debounced save will persist the new blockIds to disk.
    //
    // Map: session-id → assigned blockId (may be pre-existing or newly minted).
    const assignedBlockIds = new Map<string, string>()
    for (const tid of targetIds) {
      const bullet = findBullet(currentBullets, tid)
      if (!bullet) continue
      if (bullet.blockId) {
        assignedBlockIds.set(tid, bullet.blockId)
      } else {
        assignedBlockIds.set(tid, generateBlockId())
      }
    }

    // Walk the live bullet tree and inject any newly-assigned blockIds.
    function injectBlockIds(bs: Bullet[]): Bullet[] {
      return bs.map((b) => {
        const newId = assignedBlockIds.get(b.id)
        const updatedB = newId && !b.blockId ? { ...b, blockId: newId } : b
        return { ...updatedB, children: injectBlockIds(updatedB.children) }
      })
    }
    const updatedBullets = injectBlockIds(currentBullets)

    // Build targets from the updated bullet tree (blockId now always present).
    const targets = targetIds.flatMap((tid) => {
      const bullet = findBullet(updatedBullets, tid)
      if (!bullet) return []
      return [
        {
          bulletId: tid,
          text: bullet.text,
          blockId: bullet.blockId, // guaranteed non-undefined after injection
          // serializeChildrenBody recursively serializes the full subtree,
          // preserving all nesting levels and blockIds (Bug #2 fix).
          childBody: serializeChildrenBody(bullet.children),
        },
      ]
    })

    if (targets.length === 0) return

    // Build an updated parentPage whose body reflects the newly assigned
    // blockIds.  Main will re-parse this body to find target bullets by blockId,
    // so the body must include those IDs before the request is sent.
    let updatedParentPage = docState.page
    if (docState.region) {
      const newBody = serializeOutline({ ...docState.region, bullets: updatedBullets })
      updatedParentPage = { ...docState.page, body: newBody }
    }

    // Show confirmation dialog when selection exceeds the threshold (US-010).
    if (targets.length > BULK_PROMOTE_THRESHOLD) {
      setPendingTargets(targets)
      setPendingRelPath(relPath)
      setPendingParentPage(updatedParentPage)
      return
    }

    await executePromote(targets, relPath, updatedParentPage)
  }, [vaultApi, relPath, docState.page, docState.region, docState.bullets, selectionState, selectionCount, promoting, executePromote])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      const shift = e.shiftKey

      // PROMOTE: Cmd-Enter
      if (mod && e.key === 'Enter' && !shift) {
        e.preventDefault()
        void handlePromote()
        return
      }

      // HISTORY_BACK: Cmd-[
      if (mod && e.key === '[' && !shift) {
        e.preventDefault()
        goBack()
        return
      }

      // HISTORY_FORWARD: Cmd-]
      if (mod && e.key === ']' && !shift) {
        e.preventDefault()
        goForward()
        return
      }

      // COLLAPSE_CURRENT: Cmd-.
      if (mod && e.key === '.' && !shift) {
        e.preventDefault()
        const editor = editorRef.current
        if (!editor) return
        const focusedBlock = editor.getTextCursorPosition().block
        if (!focusedBlock) return
        const idx = editor.document.indexOf(focusedBlock)
        const b = blocksToBullets(editor.document)[idx]
        if (!b) return
        const [newBullets] = toggleCollapsed(docState.bullets, b.id)
        updateBullets(newBullets)
        return
      }

      // COLLAPSE_ALL: Cmd-Shift-,
      // Bug #8 fix: anyExpanded must check the whole tree, not just top-level.
      if (mod && shift && e.key === ',') {
        e.preventDefault()
        function anyExpandedInTree(bs: Bullet[]): boolean {
          return bs.some((b) => (!b.collapsed && b.children.length > 0) || anyExpandedInTree(b.children))
        }
        const anyExpanded = anyExpandedInTree(docState.bullets)
        const newBullets = toggleAllCollapsed(docState.bullets, anyExpanded)
        updateBullets(newBullets)
        return
      }

      // ZOOM_IN: Cmd-Shift-.
      // Bug #5 fix: resolve the focused bullet via the same adapter path as
      // COLLAPSE_CURRENT (blocksToBullets(editor.document)[idx]) rather than
      // indexing directly into docState.bullets (which is the full tree and
      // would give the wrong/undefined entry when nested or zoomed).
      if (mod && shift && e.key === '.') {
        e.preventDefault()
        const editor = editorRef.current
        if (!editor) return
        const focusedBlock = editor.getTextCursorPosition().block
        if (!focusedBlock) return
        const idx = editor.document.indexOf(focusedBlock)
        // Map editor flat doc → bullet; then find the full bullet in the tree
        // so we can pass allBullets correctly to zoomIn for breadcrumb building.
        const editorBullet = blocksToBullets(editor.document)[idx]
        if (!editorBullet) return
        // Locate the actual bullet in docState.bullets (may be nested) via its
        // blockId (if it has one) or fall back to the editor bullet directly.
        const actualBullet = editorBullet.blockId
          ? (findBullet(docState.bullets, editorBullet.id) ??
            // findBullet uses session id (b.id) which changes every render in
            // blocknote adapter; use blockId lookup as the stable path.
            (() => {
              function findByBlockId(bs: Bullet[], bid: string): Bullet | null {
                for (const b of bs) {
                  if (b.blockId === bid) return b
                  const f = findByBlockId(b.children, bid)
                  if (f) return f
                }
                return null
              }
              return findByBlockId(docState.bullets, editorBullet.blockId!)
            })())
          : editorBullet
        if (!actualBullet) return
        const bId = actualBullet.id
        const { blockId, newlyAssignedBlockId } = zoomIn(actualBullet, docState.bullets)
        if (newlyAssignedBlockId) {
          // Persist the newly assigned block ID.
          const assignedId = newlyAssignedBlockId
          function assignId(bullets: Bullet[]): Bullet[] {
            return bullets.map((bul) =>
              bul.id === bId
                ? { ...bul, blockId: assignedId }
                : { ...bul, children: assignId(bul.children) },
            )
          }
          updateBullets(assignId(docState.bullets))
        }
        if (relPath) {
          navigateTo({ relPath, zoomBlockId: blockId })
        }
        return
      }

      // MULTI-SELECT EXTEND: Shift-ArrowUp / Shift-ArrowDown (US-008)
      if (shift && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod) {
        const editor = editorRef.current
        if (!editor) return
        const focusedBlock = editor.getTextCursorPosition().block
        if (!focusedBlock) return
        const idx = editor.document.indexOf(focusedBlock)
        const editorBullet = blocksToBullets(editor.document)[idx]
        if (!editorBullet) return
        e.preventDefault()
        extendSelect(e.key === 'ArrowUp' ? 'up' : 'down', editorBullet.id, docState.bullets)
        return
      }

      // CLEAR SELECTION: Escape (US-008)
      if (e.key === 'Escape' && selectionCount > 0) {
        e.preventDefault()
        clearSelection()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePromote, goBack, goForward, docState.bullets, updateBullets, zoomIn, relPath, navigateTo, extendSelect, clearSelection, selectionCount])

  // ── Page title for breadcrumb ─────────────────────────────────────────────

  const pageTitle = docState.page?.title ?? relPath ?? 'Untitled'

  // ── Render ────────────────────────────────────────────────────────────────

  if (!relPath) {
    return (
      <div
        style={containerStyle}
        data-testid="outliner"
        aria-label="Outliner"
      >
        <p style={hintStyle}>Open a page to start editing.</p>
      </div>
    )
  }

  if (docState.loading) {
    return (
      <div style={containerStyle} data-testid="outliner" aria-label={`Outliner: ${relPath}`}>
        <p style={hintStyle}>Loading…</p>
      </div>
    )
  }

  return (
    <div
      style={containerStyle}
      data-testid="outliner"
      aria-label={`Outliner: ${relPath}`}
    >
      {/* Zoom breadcrumb (Slice 7) */}
      {zoomState.breadcrumb.length > 0 && (
        <Breadcrumb
          pageTitle={pageTitle}
          breadcrumb={zoomState.breadcrumb}
          onNavigate={(blockId) => {
            if (!blockId) {
              zoomOut()
              if (relPath) navigateTo({ relPath })
            } else {
              zoomToBreadcrumb(blockId, docState.bullets)
              if (relPath) navigateTo({ relPath, zoomBlockId: blockId })
            }
          }}
        />
      )}

      {/* Conflict banner (Slice 4) */}
      {docState.conflict && (
        <ConflictBanner onKeepMine={keepMine} onReload={reloadFromDisk} />
      )}

      {/* Deleted banner (Slice 4) */}
      {docState.deleted && <DeletedBanner />}

      {/* Promote error */}
      {promoteError && (
        <div style={errorBannerStyle} role="alert">
          {promoteError}
          <button
            type="button"
            style={dismissBtnStyle}
            onClick={() => setPromoteError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Promoting indicator */}
      {promoting && <div style={hintStyle}>Promoting…</div>}

      {/* BlockNote editor + wikilink autocomplete overlay (US-004) */}
      <div style={editorWrapStyle}>
        <div style={{ position: 'relative' }}>
          {/*
            Keyed by relPath + loadSeq + zoom: a page LOAD (open / switch /
            hot-reload) or zoom change remounts a fresh editor with the correct
            initialContent, instead of imperatively swapping content (which was
            racy and intermittently blanked the editor). Typing does NOT remount
            (loadSeq only changes on load), so edits are preserved.
          */}
          <PageEditor
            key={`${relPath ?? ''}#${docState.loadSeq}#${zoomState.zoomedBlockId ?? ''}`}
            initialBullets={visibleBullets}
            onReady={handleEditorReady}
            onChange={handleChange}
          />
          {/* Wikilink autocomplete menu (US-004): shown when user types [[ */}
          {wikilinkQuery !== null && (
            <div style={wikilinkMenuWrapStyle}>
              <WikilinkMenu
                query={wikilinkQuery}
                summary={indexSummary}
                onSelect={handleWikilinkSelect}
                onClose={() => setWikilinkQuery(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Status bar (Slice 8) */}
      <StatusBar count={selectionCount} onClear={clearSelection} />

      {/* Bulk promote dialog (Slice 10) */}
      {pendingTargets && (
        <PromoteDialog
          count={pendingTargets.length}
          onConfirm={() => {
            const targets = pendingTargets
            const path = pendingRelPath
            const parentPage = pendingParentPage
            setPendingTargets(null)
            setPendingRelPath(null)
            setPendingParentPage(null)
            if (targets && path) {
              void executePromote(targets, path, parentPage ?? undefined)
            }
          }}
          onCancel={() => {
            setPendingTargets(null)
            setPendingRelPath(null)
            setPendingParentPage(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
}

const editorWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0.5rem 0',
}

const hintStyle: React.CSSProperties = {
  color: '#999',
  fontSize: '0.9rem',
  padding: '1rem',
  margin: 0,
}

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.5rem 0.75rem',
  background: '#fff0f0',
  borderBottom: '1px solid #f5c6c6',
  color: '#c00',
  fontSize: '0.85rem',
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#c00',
  fontSize: '0.85rem',
}

const wikilinkMenuWrapStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: '2rem',
  zIndex: 1000,
}
