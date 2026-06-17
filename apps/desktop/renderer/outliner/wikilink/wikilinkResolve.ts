/**
 * Wikilink resolution utilities (US-004 / FR-4).
 *
 * Resolves `[[CODE]]` and `[[CODE#^id]]` wikilinks against the vault index
 * summary. Resolution order:
 *  1. Exact code match (case-sensitive, most common path).
 *  2. Case-insensitive title match (fallback for natural-language links).
 *  3. Block-suffix: resolve `CODE` first, then verify the block ID exists.
 *
 * "Broken" = the code/title doesn't match any page, OR the block ID doesn't
 *  exist on the matched page.
 *
 * This module is FS-free and can be tested without a DOM.
 */

import type { IndexSummary } from '@todontic/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Result of resolving a single wikilink. */
export type WikilinkResolution =
  | { kind: 'found'; code: string; title: string | null; blockId?: string }
  | { kind: 'broken'; rawCode: string; rawBlockId?: string }

/** A parsed wikilink `[[CODE]]` or `[[CODE#^blockId]]`. */
export interface ParsedWikilink {
  /** The raw code/title portion (before `#^`). */
  rawCode: string
  /** The bare block ID (without `^`), if present. */
  rawBlockId?: string
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse a wikilink string into its code and optional block-ID components.
 *
 * Input: the text INSIDE the double-brackets (e.g. `TDC-42` or `TDC-42#^abc123`).
 *
 * @param inner - Content inside `[[ ]]`.
 * @returns `ParsedWikilink` with `rawCode` and optional `rawBlockId`.
 */
export function parseWikilink(inner: string): ParsedWikilink {
  const hashIdx = inner.indexOf('#^')
  if (hashIdx !== -1) {
    return {
      rawCode: inner.slice(0, hashIdx).trim(),
      rawBlockId: inner.slice(hashIdx + 2).trim(),
    }
  }
  return { rawCode: inner.trim() }
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve a wikilink against an `IndexSummary`.
 *
 * @param wikilink - The parsed wikilink (from `parseWikilink`).
 * @param summary  - Live index summary from `vault.getIndexSummary()`.
 * @returns Resolution result: `found` with code+title, or `broken`.
 */
export function resolveWikilink(
  wikilink: ParsedWikilink,
  summary: IndexSummary,
): WikilinkResolution {
  const { rawCode, rawBlockId } = wikilink

  // 1. Exact code match.
  const byCode = summary.pages.find((p) => p.code === rawCode)
  if (byCode) {
    if (rawBlockId) {
      // Verify the block ID exists for this code.
      const key = `${rawCode}#^${rawBlockId}`
      const blockExists = summary.blockIdKeys.includes(key)
      if (!blockExists) {
        return { kind: 'broken', rawCode, rawBlockId }
      }
      return { kind: 'found', code: byCode.code, title: byCode.title, blockId: rawBlockId }
    }
    return { kind: 'found', code: byCode.code, title: byCode.title }
  }

  // 2. Case-insensitive title match.
  const lower = rawCode.toLowerCase()
  const byTitle = summary.pages.find((p) => p.title?.toLowerCase() === lower)
  if (byTitle) {
    if (rawBlockId) {
      const key = `${byTitle.code}#^${rawBlockId}`
      const blockExists = summary.blockIdKeys.includes(key)
      if (!blockExists) {
        return { kind: 'broken', rawCode, rawBlockId }
      }
      return { kind: 'found', code: byTitle.code, title: byTitle.title, blockId: rawBlockId }
    }
    return { kind: 'found', code: byTitle.code, title: byTitle.title }
  }

  // 3. No match — broken link.
  return { kind: 'broken', rawCode, rawBlockId }
}

// ─── Autocomplete filter ──────────────────────────────────────────────────────

/**
 * Filter the index summary for autocomplete results matching a query.
 *
 * Matches against code and title (case-insensitive prefix/substring).
 * Returns up to `limit` results.
 *
 * @param query   - The text the user has typed after `[[`.
 * @param summary - Live index summary.
 * @param limit   - Maximum results to return (default 20).
 * @returns Filtered and ranked list of `{ code, title }` entries.
 */
export function filterAutocomplete(
  query: string,
  summary: IndexSummary,
  limit = 20,
): Array<{ code: string; title: string | null }> {
  if (!query) return summary.pages.slice(0, limit)
  const lower = query.toLowerCase()
  return summary.pages
    .filter(
      (p) =>
        p.code.toLowerCase().includes(lower) ||
        (p.title?.toLowerCase().includes(lower) ?? false),
    )
    .slice(0, limit)
}
