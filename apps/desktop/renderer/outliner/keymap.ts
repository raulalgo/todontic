/**
 * Central keybinding table for the Todontic outliner (D1).
 *
 * Resolved conflicts:
 *  - D1: Zoom = `Cmd-Shift-.`; Collapse-all = `Cmd-Shift-,` (NOT Cmd-Shift-.).
 *  - `Cmd-.` = collapse/expand current bullet.
 *  - `Cmd-[` / `Cmd-]` = back/forward history (Slice 6).
 *
 * BlockNote handles Tab/Shift-Tab (indent/outdent) and Enter (sibling) natively.
 * Custom keys defined here are wired through BlockNote's keyboard handler API in
 * Outliner.tsx.
 */

// ─── Key constants ─────────────────────────────────────────────────────────────

/** Platform-appropriate modifier key string. */
const MOD = 'Mod' // ProseMirror convention: Cmd on macOS, Ctrl on Windows/Linux

export const KEYS = {
  /** Toggle collapse of the currently focused bullet. */
  COLLAPSE_CURRENT: `${MOD}-.`,

  /** Toggle collapse of ALL bullets in the current page. */
  COLLAPSE_ALL: `${MOD}-Shift-,`,

  /** Zoom into the currently focused bullet (US-009, D1). */
  ZOOM_IN: `${MOD}-Shift-.`,

  /** Navigate back in history (Slice 6). */
  HISTORY_BACK: `${MOD}-[`,

  /** Navigate forward in history (Slice 6). */
  HISTORY_FORWARD: `${MOD}-]`,

  /** Move bullet + subtree up among siblings. */
  MOVE_UP: `${MOD}-ArrowUp`,

  /** Move bullet + subtree down among siblings. */
  MOVE_DOWN: `${MOD}-ArrowDown`,

  /** Move bullet across parents (up). */
  MOVE_UP_ACROSS: `${MOD}-Shift-ArrowUp`,

  /** Move bullet across parents (down). */
  MOVE_DOWN_ACROSS: `${MOD}-Shift-ArrowDown`,

  /** Single promote or bulk promote (Slices 9-10). */
  PROMOTE: `${MOD}-Enter`,
} as const

export type Key = (typeof KEYS)[keyof typeof KEYS]
