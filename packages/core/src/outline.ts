/**
 * Markdown outline serializer — the load-bearing ser/de for the Todontic
 * outliner (PRD-01, Architecture Decision).
 *
 * Invariants (D2 — scoped relaxation of D-011):
 *  - UNEDITED files are NEVER rewritten. `writePage` is only called after the
 *    user edits a page in the editor.
 *  - When a page IS written, the "outline region" (the contiguous bullet list)
 *    is serialised normalised: `-` marker, two-space indent per depth level.
 *    Everything before and after the outline region (`prefixText` / `suffixText`)
 *    is preserved byte-exact.
 *  - Idempotence: `serializeOutline(parseOutline(x)) === x` when `x` is already
 *    in the Todontic-normalised form. For foreign-formatted bodies, the first
 *    serialize normalises; subsequent round-trips are stable.
 *
 * `packages/core` is FS-free — no `fs` or `path` imports are allowed here.
 * The `collapsed` field on bullets is an in-memory concept only; it is NOT
 * encoded in the markdown body (FR-6 — lives in `todontic.collapsed` frontmatter).
 */

import { BLOCK_ID_RE } from './blockId.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single bullet in the outline tree.
 *
 * `text` is the inline markdown content after the list marker, with any
 * trailing `^blockId` stripped into the `blockId` field.
 * `collapsed` is a runtime flag — never serialised to the body.
 */
export interface Bullet {
  /** Stable opaque ID used internally during an editing session (not the block ID). */
  id: string
  /** Trailing `^xxxxxx` block ID extracted from the source line, if present. */
  blockId?: string
  /** Inline markdown text of the bullet (without the list marker and block ID). */
  text: string
  /** Runtime collapse state — overlaid from `frontmatter.todontic.collapsed`. */
  collapsed: boolean
  /** Child bullets (sub-list). */
  children: Bullet[]
  /** The list marker found on disk (`-`, `*`, or `+`). Used for display only;
   *  serialization always normalises to `-`. */
  sourceMarker?: string
}

/**
 * The three regions of a page body after locating the outline region.
 *
 * On serialize, the new outline is spliced back:
 *   `prefix + serializedBullets + suffix`.
 */
export interface OutlineRegion {
  /**
   * Text before the first list item (byte-exact from the source body).
   * Often empty or just a heading + blank line.
   */
  prefix: string
  /** The parsed bullet tree. Empty array when no list was found. */
  bullets: Bullet[]
  /**
   * Text after the last list item (byte-exact from the source body).
   * Often empty, or prose that follows the list.
   *
   * When non-empty this string always starts with the `\n` that terminates
   * the last list line — i.e. the boundary `\n` is captured in `suffix`, not
   * emitted by the serializer.
   *
   * When empty AND `trailingNewline` is true, the source body ended with a
   * `\n` after the last list item that `suffix` cannot represent as a non-empty
   * string.  `serializeOutline` re-emits this `\n` so round-trips are
   * byte-stable (Bug #6 fix).
   */
  suffix: string
  /**
   * Whether the source body had a trailing newline character after the last
   * list item when `suffix` is empty.  Ignored when `suffix` is non-empty
   * (the boundary `\n` is already encoded in the suffix start).
   *
   * Set by `parseOutline`; honoured by `serializeOutline`.
   */
  trailingNewline?: boolean
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Regex that matches a list-item line (any standard marker + space). */
const LIST_ITEM_RE = /^(\s*)([-*+])\s+(.*)/

/**
 * Given a raw body string, find the index of the first list-item line and
 * the index of the line AFTER the last list-item line (or blank line that
 * is "inside" the list region).
 *
 * A "blank line inside the list region" is one sandwiched between list lines
 * (used for spacing in some editors). We include them in the region by
 * continuing past blank lines only when a non-blank list line follows.
 *
 * Returns `null` when no list-item lines exist.
 */
function findOutlineRegion(
  lines: string[],
): { firstIdx: number; lastIdx: number } | null {
  let firstIdx = -1
  let lastIdx = -1

  // Two-pass: first pass marks list-item lines; second pass extends the region
  // to include interleaved blank lines.
  const isListLine = lines.map((l) => LIST_ITEM_RE.test(l))

  for (let i = 0; i < lines.length; i++) {
    if (isListLine[i]) {
      if (firstIdx === -1) firstIdx = i
      lastIdx = i
    }
  }

  if (firstIdx === -1) return null

  // Extend lastIdx to include trailing blank lines that are INSIDE the region
  // (i.e. blank lines between the first and last list line are included).
  // We already know lastIdx is the index of the last list line.
  // Now check: any blank lines immediately after lastIdx that are followed by
  // another list line? If yes, extend.
  let extendedLast = lastIdx
  for (let i = lastIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      // Blank — look ahead for more list lines.
      let nextListFound = false
      for (let j = i + 1; j < lines.length; j++) {
        if ((lines[j] ?? '').trim() !== '') {
          nextListFound = isListLine[j] === true
          break
        }
      }
      if (nextListFound) {
        extendedLast = i
      } else {
        break
      }
    } else if (isListLine[i]) {
      extendedLast = i
    } else {
      break
    }
  }

  return { firstIdx, lastIdx: extendedLast }
}

/**
 * Detect the indent unit used in a set of list lines.
 * Falls back to two spaces (the Todontic canonical form) when detection fails.
 */
function detectIndentUnit(lines: string[]): string {
  for (const line of lines) {
    const m = LIST_ITEM_RE.exec(line)
    if (m && (m[1]?.length ?? 0) > 0) {
      const spaces = m[1]!.length
      // Common cases: 2, 4, or tab.
      if (spaces % 4 === 0) return '    '
      if (spaces % 2 === 0) return '  '
      return ' '.repeat(spaces)
    }
  }
  return '  ' // canonical Todontic default
}

/**
 * Parse a flat list of raw list-item lines (possibly with indentation) into a
 * `Bullet[]` tree.  Non-list lines inside the region are treated as
 * continuation text of the previous bullet (appended with a space).
 */
function parseLines(listLines: string[], indentUnit: string): Bullet[] {
  // Stack: each entry is [depth, Bullet[], parentBullets].
  // We maintain a stack of "current siblings at each depth level".
  const root: Bullet[] = []
  const stack: Array<{ depth: number; siblings: Bullet[] }> = [{ depth: -1, siblings: root }]
  let bulletCounter = 0

  for (const rawLine of listLines) {
    const m = LIST_ITEM_RE.exec(rawLine)
    if (!m) {
      // Continuation / blank line — append to the last bullet text.
      const lastEntry = stack[stack.length - 1]
      const lastSiblings = lastEntry?.siblings ?? root
      const lastBullet = lastSiblings[lastSiblings.length - 1]
      if (lastBullet && rawLine.trim() !== '') {
        lastBullet.text += ` ${rawLine.trim()}`
      }
      continue
    }

    const indent = m[1] ?? ''
    const marker = m[2] ?? '-'
    const content = m[3] ?? ''

    // Calculate depth from indent length.
    const unitLen = indentUnit.length || 2
    const depth = Math.round(indent.length / unitLen)

    // Extract block ID from content.
    const trimmedContent = content.trimEnd()
    const blockIdMatch = BLOCK_ID_RE.exec(trimmedContent)
    let text: string
    let blockId: string | undefined
    if (blockIdMatch) {
      // Remove the block ID suffix (and any whitespace before it).
      text = trimmedContent.slice(0, trimmedContent.length - blockIdMatch[0].length).trimEnd()
      blockId = blockIdMatch[1]
    } else {
      text = trimmedContent
    }

    const bullet: Bullet = {
      id: `b${(++bulletCounter).toString()}`,
      text,
      blockId,
      collapsed: false,
      children: [],
      sourceMarker: marker,
    }

    // Pop the stack until we find the parent for this depth.
    while (stack.length > 1 && (stack[stack.length - 1]?.depth ?? -1) >= depth) {
      stack.pop()
    }

    const parent = stack[stack.length - 1] ?? { depth: -1, siblings: root }
    parent.siblings.push(bullet)

    // Push this bullet's children array so deeper items can attach.
    stack.push({ depth, siblings: bullet.children })
  }

  return root
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse the outline region from a page body.
 *
 * Locates the maximal contiguous run of markdown list-item lines (including
 * interleaved blank lines between items). Extracts prefix / bullets / suffix.
 *
 * `collapsed` on all returned bullets is `false` — the caller overlays
 * `frontmatter.todontic.collapsed` after parsing.
 *
 * @param body - Raw body string from `ParsedPage.body` (byte-preserved).
 * @returns `OutlineRegion` with prefix/bullets/suffix.
 */
export function parseOutline(body: string): OutlineRegion {
  if (!body) return { prefix: '', bullets: [], suffix: '' }

  // Split while tracking the byte offsets of each line so prefix/suffix can be
  // extracted as exact substrings of the original body.
  const lineOffsets: number[] = [] // byte offset of the start of each line
  const lines: string[] = []
  let offset = 0
  for (const line of body.split('\n')) {
    lines.push(line)
    lineOffsets.push(offset)
    offset += line.length + 1 // +1 for the '\n' that was consumed
  }

  // If the body ends with a newline, split('\n') produces a trailing '' entry.
  // We remove it from consideration (it's not a real line).
  const hasTrailingNewline = body.endsWith('\n')
  const effectiveLineCount = hasTrailingNewline ? lines.length - 1 : lines.length
  const effectiveLines = lines.slice(0, effectiveLineCount)

  const range = findOutlineRegion(effectiveLines)

  if (!range) {
    return { prefix: body, bullets: [], suffix: '' }
  }

  // prefix: everything from byte 0 up to (not including) the first list line.
  const prefixEnd = lineOffsets[range.firstIdx] ?? 0
  const prefix = body.slice(0, prefixEnd)

  // suffix: everything from after the last list line's newline to end of body.
  const lastLineStart = lineOffsets[range.lastIdx] ?? 0
  const lastLineLen = (effectiveLines[range.lastIdx] ?? '').length
  // After the last list line there is a '\n' (if hasTrailingNewline or more content follows).
  const afterLastLine = lastLineStart + lastLineLen
  // Check if there is a '\n' at afterLastLine.
  const suffixStart = afterLastLine < body.length ? afterLastLine + 1 : body.length
  const suffix = suffixStart < body.length ? body.slice(suffixStart - 1) : ''

  // Track whether the source had a trailing '\n' after the last list item when
  // the suffix is empty.  This newline cannot be represented in an empty suffix
  // but must be re-emitted by serializeOutline to keep saves byte-stable (#6).
  const trailingNewline = suffix === '' && hasTrailingNewline

  const listLines = effectiveLines.slice(range.firstIdx, range.lastIdx + 1)
  const indentUnit = detectIndentUnit(listLines)
  const bullets = parseLines(listLines, indentUnit)

  return { prefix, bullets, suffix, trailingNewline }
}

/**
 * Serialize a bullet tree back into a markdown string, splicing the result into
 * the surrounding prefix/suffix regions.
 *
 * Normalises the list: always uses `-` marker, two-space indent per depth level.
 * Bullets with a `blockId` emit `<text> ^<id>` at line end.
 * `collapsed` is NOT emitted — it lives in frontmatter (FR-6).
 *
 * @param region - Parsed outline region (prefix, bullets, suffix).
 * @returns Full body string with the serialised bullet region spliced in.
 */
export function serializeOutline(region: OutlineRegion): string {
  if (region.bullets.length === 0) {
    // No list — return prefix + suffix byte-exact.
    return region.prefix + region.suffix
  }

  const lines: string[] = []
  serializeBullets(region.bullets, 0, lines)

  const listText = lines.join('\n')

  // Bug #6 fix: when the source body ended with '\n' after the last list item
  // and the suffix is empty, re-emit the trailing newline.  Without this, the
  // first save of a normalised page drops the final '\n' and git shows
  // "\ No newline at end of file".
  const trailingNl = region.suffix === '' && region.trailingNewline ? '\n' : ''

  return region.prefix + listText + trailingNl + region.suffix
}

/**
 * Recursively serialise a bullet array into lines.
 * Uses two-space indent and `-` marker (D2 normalised form).
 */
function serializeBullets(bullets: Bullet[], depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth)
  for (const bullet of bullets) {
    const suffix = bullet.blockId ? ` ^${bullet.blockId}` : ''
    lines.push(`${indent}- ${bullet.text}${suffix}`)
    if (bullet.children.length > 0) {
      serializeBullets(bullet.children, depth + 1, lines)
    }
  }
}
