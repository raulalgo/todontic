/**
 * Block-ID extraction and generation utilities.
 *
 * Block IDs are the `^xxxxxx` suffix on list-item lines, where `xxxxxx` is
 * exactly 6 lowercase alphanumeric characters (Data-model). This module provides:
 *  - Read-only extraction (`extractBlockIds`, `BLOCK_ID_RE`).
 *  - Pure generation (`generateBlockId`) and assignment (`appendBlockId`) for
 *    the PRD-01 outliner layer (FR-7, FR-8).
 *
 * Load-bearing: block IDs are NEVER reused (AGENTS.md invariant). Generation
 * produces a new random ID each call; callers must persist the assignment and
 * must never call `generateBlockId` again for the same bullet if it already has
 * an ID.
 */

import type { BlockRef } from '@todontic/shared'

// ─── Regex ────────────────────────────────────────────────────────────────────

/**
 * Matches a block ID suffix at the end of a line.
 * Captures the bare 6-character token (without the caret).
 *
 * The ID must appear at the very end of the line (after optional trailing
 * whitespace) and must be exactly 6 characters after the caret.
 */
export const BLOCK_ID_RE = /\^([a-zA-Z0-9]{6})$/

// ─── Constants ────────────────────────────────────────────────────────────────

/** Charset for block IDs — lowercase letters + digits (FR-8). */
const BLOCK_ID_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a new 6-character lowercase alphanumeric block ID (FR-8).
 *
 * IDs are randomly generated. The optional `rng` parameter accepts a
 * deterministic function `() => number` (uniform [0, 1)) so tests can produce
 * predictable IDs without touching global Math.random.
 *
 * @param rng - Optional random number generator; defaults to `Math.random`.
 * @returns A 6-character string of `[a-z0-9]`.
 */
export function generateBlockId(rng: () => number = Math.random): string {
  let id = ''
  for (let i = 0; i < 6; i++) {
    id += BLOCK_ID_CHARSET[Math.floor(rng() * BLOCK_ID_CHARSET.length)]
  }
  return id
}

/**
 * Append a block ID suffix to a bullet text line.
 *
 * Produces `<text> ^<id>` — a single space before the caret, consistent with
 * the serialiser's normalised output. Idempotent: if `text` already ends with
 * a valid 6-char block ID it is returned unchanged.
 *
 * @param text - The bullet text (without leading marker or indent).
 * @param id   - The 6-character bare ID (without the caret).
 * @returns The text with the block ID appended.
 */
export function appendBlockId(text: string, id: string): string {
  // Guard: do not double-append if the text already has a block ID.
  if (BLOCK_ID_RE.test(text.trimEnd())) return text
  return `${text.trimEnd()} ^${id}`
}

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
