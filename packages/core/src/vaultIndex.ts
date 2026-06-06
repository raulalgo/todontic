/**
 * Pure vault index builder.
 *
 * Given an array of `ParsedPage` objects, constructs the in-memory `VaultIndex`
 * used for navigation, backlink resolution, and tag/status filtering.
 *
 * The index is derived and always rebuildable from disk — it is never the
 * authoritative source of truth (AGENTS.md load-bearing invariant).
 */

import type { Backlink, ParsedPage, Status, VaultIndex } from '@todontic/shared'

// ─── Regex ────────────────────────────────────────────────────────────────────

/**
 * Matches Todontic wikilinks: `[[CODE]]` or `[[CODE#^id]]`.
 *
 * Groups:
 *  1. `code`  — the target page code (e.g. `TDC-42`)
 *  2. `block` — the optional block ID after `#` (e.g. `^abc123`), or undefined
 *
 * Designed for repeated `exec` iteration over body text.
 */
export const WIKILINK_RE = /\[\[([A-Z][A-Z0-9]+-\d+)(?:#(\^[a-zA-Z0-9]{6}))?\]\]/g

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a `VaultIndex` from an array of parsed pages.
 *
 * Pages without a `todontic.code` are excluded from `byCode` but their body
 * is still scanned for wikilinks (to detect backlinks targeting coded pages).
 *
 * @param pages - All parsed pages in the vault.
 */
export function buildIndex(pages: ParsedPage[]): VaultIndex {
  const byCode = new Map<string, ParsedPage>()
  const byTitle = new Map<string, ParsedPage[]>()
  const byTag = new Map<string, ParsedPage[]>()
  const byStatus = new Map<Status, ParsedPage[]>()
  const backlinks = new Map<string, Backlink[]>()
  const blockIds = new Map<string, ParsedPage>()

  // First pass: index each page by its attributes.
  for (const page of pages) {
    const { code, status, tags } = page.frontmatter

    if (code) {
      byCode.set(code, page)
    }

    if (page.title) {
      const list = byTitle.get(page.title) ?? []
      list.push(page)
      byTitle.set(page.title, list)
    }

    if (tags && Array.isArray(tags)) {
      for (const tag of tags) {
        if (typeof tag === 'string') {
          const list = byTag.get(tag) ?? []
          list.push(page)
          byTag.set(tag, list)
        }
      }
    }

    if (status && typeof status === 'string') {
      const list = byStatus.get(status) ?? []
      list.push(page)
      byStatus.set(status, list)
    }

    // Index block IDs as `CODE#^id` → page.
    if (code) {
      for (const ref of page.blockIds) {
        blockIds.set(`${code}${ref.id}`, page)
      }
    }
  }

  // Second pass: scan all body text for wikilinks to build backlinks.
  for (const page of pages) {
    const fromCode = page.frontmatter.code
    if (!fromCode) continue // pages without codes can't be the source of named backlinks

    // Reset lastIndex for the global regex before each body scan.
    WIKILINK_RE.lastIndex = 0
    let match = WIKILINK_RE.exec(page.body)
    while (match !== null) {
      const toCode = match[1]
      const toBlockId = match[2]
      if (toCode) {
        const bl: Backlink = {
          fromCode,
          toCode,
          ...(toBlockId ? { toBlockId } : {}),
        }

        const list = backlinks.get(toCode) ?? []
        list.push(bl)
        backlinks.set(toCode, list)
      }
      match = WIKILINK_RE.exec(page.body)
    }
  }

  return { byCode, byTitle, byTag, byStatus, backlinks, blockIds }
}
