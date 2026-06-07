/**
 * useNavigation — per-window in-memory navigation history (US-006 / FR-9).
 *
 * Maintains a back/forward stack of `NavEntry` objects. Each entry records
 * either a page navigation or a zoom-into-block navigation. History entries
 * are in-memory only — NOT persisted to disk (FR-9: reload returns to root).
 *
 * Design:
 *  - `entries[cursor]` is the current location.
 *  - Navigating forward while behind the end of the stack truncates the
 *    forward history (standard browser behaviour).
 *  - Zoom history is interleaved with page history (same stack).
 *  - Selection is ephemeral and should be cleared on navigation (§9) —
 *    the caller is responsible for resetting `useSelection`.
 *
 * Keyboard shortcuts (D1):
 *  - `Cmd-[` → back.
 *  - `Cmd-]` → forward.
 *  Mouse back/forward buttons are wired in `Outliner.tsx`.
 */

import { useCallback, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single navigation history entry.
 *
 * `zoomBlockId` is set when the entry is a zoom-into-block; absent for
 * page-level navigation (shows the full page at root).
 */
export interface NavEntry {
  /** Vault-relative path of the page. */
  relPath: string
  /**
   * The bare 6-char block ID the view is zoomed into, or undefined for page root.
   * Corresponds to `vault://CODE#^id` within-app URLs.
   */
  zoomBlockId?: string
}

/** State returned by `useNavigation`. */
export interface NavState {
  /** The current navigation entry (or null if nothing has been navigated yet). */
  current: NavEntry | null
  /** True if there is a back entry available. */
  canGoBack: boolean
  /** True if there is a forward entry available. */
  canGoForward: boolean
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Per-window in-memory navigation history hook.
 *
 * @param initialEntry - Optional starting location (e.g. last open page from
 *   app state). If omitted, the history starts empty and `current` is null.
 */
export function useNavigation(initialEntry?: NavEntry) {
  const [entries, setEntries] = useState<NavEntry[]>(
    initialEntry ? [initialEntry] : [],
  )
  const [cursor, setCursor] = useState<number>(initialEntry ? 0 : -1)

  // ── Derived state ────────────────────────────────────────────────────────────

  const current: NavEntry | null = cursor >= 0 && cursor < entries.length
    ? (entries[cursor] ?? null)
    : null
  const canGoBack = cursor > 0
  const canGoForward = cursor < entries.length - 1

  // ── Navigate to a new page (or zoom) ─────────────────────────────────────────

  /**
   * Navigate to a new entry.
   *
   * Truncates any forward history past the current cursor (browser-style).
   * Skips the push if the new entry is identical to the current entry
   * (prevents duplicate stack entries on re-renders).
   *
   * @param entry - The new navigation target.
   */
  const navigateTo = useCallback((entry: NavEntry) => {
    // Avoid duplicate consecutive entries — check before mutating.
    const cur = entries[cursor]
    if (
      cur &&
      cur.relPath === entry.relPath &&
      cur.zoomBlockId === entry.zoomBlockId
    ) {
      return // no-op
    }
    // Truncate forward history and append new entry.
    const newEntries = [...entries.slice(0, cursor + 1), entry]
    setEntries(newEntries)
    setCursor(newEntries.length - 1)
  }, [cursor, entries])

  // ── Back ─────────────────────────────────────────────────────────────────────

  /** Go back one step in history. No-op if already at the beginning. */
  const goBack = useCallback(() => {
    if (cursor > 0) setCursor((c) => c - 1)
  }, [cursor])

  // ── Forward ──────────────────────────────────────────────────────────────────

  /** Go forward one step in history. No-op if at the end of the stack. */
  const goForward = useCallback(() => {
    if (cursor < entries.length - 1) setCursor((c) => c + 1)
  }, [cursor, entries.length])

  // ── Replace current (for zoom within same page, no new history entry) ────────

  /**
   * Replace the current history entry in-place.
   * Used when zooming in or out within the same page without adding a new entry.
   */
  const replaceCurrent = useCallback((entry: NavEntry) => {
    setEntries((prev) => {
      const next = [...prev]
      next[cursor] = entry
      return next
    })
  }, [cursor])

  return {
    state: { current, canGoBack, canGoForward } satisfies NavState,
    navigateTo,
    goBack,
    goForward,
    replaceCurrent,
  }
}
