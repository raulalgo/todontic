/**
 * Block-ID extraction utilities.
 *
 * Block IDs are the `^xxxxxx` suffix on list-item lines, where `xxxxxx` is
 * exactly 6 alphanumeric characters (Data-model). This module provides
 * read-only extraction; assignment/mutation is the editor layer (PRD-01).
 *
 * Load-bearing: block IDs are never reused (AGENTS.md invariant). Extraction
 * is pure and stateless — it never assigns or mutates IDs.
 */

import type { BlockRef } from '@todontic/shared'

// ─── Regex ────────────────────────────────────────────────────────────────────

/**
 * Matches a block ID suffix at the end of a line.
 * Captures the full `^xxxxxx` token (exactly 6 alphanumeric chars).
 *
 * The ID must appear at the very end of the line (after optional trailing
 * whitespace) and must be exactly 6 characters after the caret.
 */
export const BLOCK_ID_RE = /\^([a-zA-Z0-9]{6})$/

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract all block IDs from `body` text.
 *
 * Each body line is scanned for a trailing `^xxxxxx` pattern.  Only lines with
 * exactly 6 alphanumeric characters after the caret qualify — near-misses
 * (5 or 7 chars, or non-alnum chars) are silently ignored.
 *
 * @param body - The raw body text (byte-preserved from `splitFrontmatter`).
 * @returns Array of `BlockRef` objects, one per matched line.
 */
export function extractBlockIds(body: string): BlockRef[] {
  const refs: BlockRef[] = []
  const lines = body.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Trim trailing whitespace before testing — block IDs must be at end of
    // meaningful content, not separated from it by trailing spaces.
    const trimmed = line.trimEnd()
    const match = BLOCK_ID_RE.exec(trimmed)
    if (match) {
      refs.push({
        id: `^${match[1]}`,
        line: i + 1, // 1-based
      })
    }
  }
  return refs
}
