/**
 * Page parse / serialize.
 *
 * Central ser/de module for Todontic markdown pages.  This is the riskiest
 * code in the project — see load-bearing invariants:
 *
 *  - D-011 (round-trip): `serializePage(parsePage(raw)) === raw` for any file
 *    Todontic has previously written.  For foreign files (Obsidian etc.) the
 *    guarantee applies to the frontmatter *except the `todontic:` block*, which
 *    is re-serialised via `yaml`.  Foreign frontmatter key text and the entire
 *    body are preserved byte-for-byte in all cases.
 *
 *  - D-009 (frontmatter namespace): only the `todontic:` top-level key is ever
 *    written; other top-level keys are left untouched.
 *
 *  - Philosophy #10 (sacred body): the body string is never re-parsed or
 *    reformatted — it passes through from disk to memory to disk unchanged.
 *
 * **`yaml` usage is surgical:** only the `todontic:` value is parsed/serialised
 * via the `yaml` library.  All other text is treated as opaque bytes.
 */

import type { ParsedPage, TodonticFrontmatter } from '@todontic/shared'
import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { extractBlockIds } from './blockId.js'
import { joinFrontmatter, splitFrontmatter } from './frontmatter.js'

// ─── Regex ────────────────────────────────────────────────────────────────────

/** Matches the first `# ` heading in body text to extract the page title. */
const H1_RE = /^#[ \t]+(.+)/m

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the `todontic:` subtree out of the raw frontmatter text.
 *
 * The frontmatter text may contain other top-level keys (e.g. Obsidian-style
 * `aliases`, `tags`).  We parse the WHOLE YAML block but extract only the
 * `todontic:` map; everything else is preserved verbatim as `foreignLines`.
 *
 * Strategy: parse the entire YAML doc once to get the `todontic` key value,
 * then reconstruct the foreign lines by extracting all text that belongs to
 * top-level keys OTHER than `todontic:`.  This avoids re-serialising foreign
 * keys through `yaml` (which would reformat them, violating D-011).
 *
 * Returns:
 *   - `frontmatter`   — the parsed `todontic:` subtree.
 *   - `foreignText`   — the raw YAML text of all non-`todontic` top-level
 *                       keys, byte-preserved (including original EOL style).
 *   - `todonticFirst` — true if the `todontic:` key appeared before any
 *                       foreign key in the original file (D-011 / Finding #3).
 *
 * Fixes:
 *   #3 — tracks `todonticFirst` so the serializer can restore original ordering.
 *   #4 — passes `eol` through and rejoins foreign lines with the original EOL.
 *   #5 — blank lines inside the `todontic:` block no longer end the block;
 *         only a new top-level key (no leading whitespace + colon) ends it.
 */
function parseFrontmatterText(
  frontmatterText: string,
  eol: '\n' | '\r\n',
): {
  frontmatter: TodonticFrontmatter
  foreignText: string
  todonticFirst: boolean
} {
  if (!frontmatterText.trim()) {
    return { frontmatter: {}, foreignText: '', todonticFirst: false }
  }

  // Parse the full YAML to extract the `todontic:` value.
  let parsed: unknown
  try {
    parsed = yamlParse(frontmatterText)
  } catch {
    // Malformed YAML — treat as fully foreign (no todontic: key).
    return { frontmatter: {}, foreignText: frontmatterText, todonticFirst: false }
  }

  const doc =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const todonticValue = doc.todontic
  const frontmatter: TodonticFrontmatter =
    typeof todonticValue === 'object' && todonticValue !== null
      ? (todonticValue as TodonticFrontmatter)
      : {}

  // Extract foreign text: all lines that are NOT part of the `todontic:` block.
  // We scan the raw text line-by-line, tracking which lines belong to the
  // `todontic:` key block (the key line + all following indented lines or blank
  // lines until the next top-level key or end).
  //
  // Fix #5: blank lines inside the todontic block do NOT end the block. Only
  // a non-blank non-indented line (a new top-level key) ends it.
  //
  // Fix #4: split on /\r?\n/ (strips \r) and rejoin with the detected `eol`
  // so CRLF foreign lines are reconstructed with the correct line endings.
  const lines = frontmatterText.split(/\r?\n/)
  const foreignLines: string[] = []
  let inTodonticBlock = false
  let todonticFirst: boolean | null = null // null = not yet seen todontic or any foreign key

  for (const line of lines) {
    // A top-level key starts at column 0 (no leading whitespace) and matches
    // `key: ...` or `key:` patterns.  Blank lines and comment lines are not
    // top-level keys.
    const isTopLevelKey = line.length > 0 && /^[^\s#]/.test(line) && line.includes(':')

    if (isTopLevelKey) {
      const keyMatch = /^([^:]+):/.exec(line)
      const key = keyMatch?.[1]?.trim()
      if (key === 'todontic') {
        // Record whether todontic came first (before any foreign keys).
        if (todonticFirst === null) {
          todonticFirst = foreignLines.length === 0
        }
        inTodonticBlock = true
        continue // skip this line
      }
      // Non-todontic top-level key: ends any todontic block.
      inTodonticBlock = false
    } else if (inTodonticBlock) {
      // Inside the todontic block: skip indented continuation lines AND blank
      // lines (Fix #5 — blank lines don't end the block).
      continue
    }

    foreignLines.push(line)
  }

  // Remove trailing empty/blank lines from foreignLines.
  while (foreignLines.length > 0 && (foreignLines[foreignLines.length - 1] ?? '').trim() === '') {
    foreignLines.pop()
  }

  // Rejoin with the detected `eol` to preserve CRLF in foreign text (Fix #4).
  // Lines were split with /\r?\n/ (stripping \r), so rejoining with eol='\r\n'
  // faithfully reconstructs the original CRLF line endings.
  const foreignText = foreignLines.length > 0 ? foreignLines.join(eol) : ''

  return { frontmatter, foreignText, todonticFirst: todonticFirst ?? false }
}

/**
 * Serialise the `todontic:` frontmatter subtree + foreign keys back into raw
 * YAML text (without opening/closing `---` fences).
 *
 * D-009: we ONLY write the `todontic:` key; foreign keys are emitted verbatim.
 * D-011: foreign key text passes through byte-unchanged; only the `todontic:`
 *         block is produced by `yaml.stringify`.
 *
 * Fix #3: when `todonticFirst` is true the todontic block is emitted before the
 * foreign text, restoring the original ordering and keeping round-trip stable.
 */
function serializeFrontmatterText(
  frontmatter: TodonticFrontmatter,
  foreignText: string,
  eol: '\n' | '\r\n',
  todonticFirst: boolean,
): string {
  // Serialise only the todontic: subtree.
  const todonticYaml = yamlStringify({ todontic: frontmatter }, { lineWidth: 0 })
  // yamlStringify always ends with \n — we want to control EOL explicitly.
  const todonticNormalized = todonticYaml.replace(/\n/g, eol)

  // Remove the trailing EOL from the todontic block before combining — the
  // joinFrontmatter helper will add the final EOL before the closing fence.
  const todonticTrimmed = todonticNormalized.endsWith('\r\n')
    ? todonticNormalized.slice(0, -2)
    : todonticNormalized.endsWith('\n')
      ? todonticNormalized.slice(0, -1)
      : todonticNormalized

  if (foreignText.trim() === '') {
    return todonticTrimmed
  }

  // Preserve original block ordering (Fix #3):
  //   todonticFirst=true  → todontic block then foreign keys
  //   todonticFirst=false → foreign keys first then todontic block (default)
  if (todonticFirst) {
    return `${todonticTrimmed}${eol}${foreignText}`
  }
  return `${foreignText}${eol}${todonticTrimmed}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a raw markdown file into a `ParsedPage`.
 *
 * @param raw - Complete file content as a UTF-8 string.
 * @param relPath - Vault-relative path (used as the index key).
 * @param filePath - Absolute path on disk (pass `''` in pure-core contexts).
 */
export function parsePage(raw: string, relPath: string, filePath = ''): ParsedPage {
  const split = splitFrontmatter(raw)
  const { frontmatter, foreignText, todonticFirst } =
    split.frontmatterText !== null
      ? parseFrontmatterText(split.frontmatterText, split.eol)
      : { frontmatter: {} as TodonticFrontmatter, foreignText: '', todonticFirst: false }

  // Extract title from first `# ` heading in body.
  const h1Match = H1_RE.exec(split.body)
  const title = h1Match ? (h1Match[1]?.trim() ?? null) : null

  // Extract block IDs from body.
  const blockIds = extractBlockIds(split.body)

  return {
    relPath,
    filePath,
    frontmatter,
    foreignFrontmatter: foreignText,
    todonticFirst,
    body: split.body,
    title,
    blockIds,
    hadFrontmatter: split.hadFrontmatter,
    eol: split.eol,
    trailingNewline: split.trailingNewline,
  }
}

/**
 * Serialise a `ParsedPage` back to a complete markdown file string.
 *
 * Round-trip guarantee (D-011):
 *   `serializePage(parsePage(raw)) === raw`
 * for any file previously written by Todontic (canonical form).
 *
 * For files with a `todontic:` block, the block is re-serialised via `yaml`
 * which produces canonical YAML formatting.  The first serialize of a foreign
 * file may alter the `todontic:` block's YAML formatting, but subsequent
 * round-trips will be stable.
 */
export function serializePage(page: ParsedPage): string {
  if (!page.hadFrontmatter && Object.keys(page.frontmatter).length === 0) {
    // No frontmatter was present and none to write — emit body only.
    return page.body
  }

  const frontmatterText = serializeFrontmatterText(
    page.frontmatter,
    page.foreignFrontmatter,
    page.eol,
    page.todonticFirst,
  )

  return joinFrontmatter(frontmatterText, page.body, page.eol)
}

/**
 * Convenience: parse then immediately serialize.
 * Used to verify D-011: `roundTrip(raw) === raw` for canonical files.
 */
export function roundTrip(raw: string, relPath = 'test.md'): string {
  return serializePage(parsePage(raw, relPath))
}
