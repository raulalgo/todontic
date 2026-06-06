/**
 * Hand-rolled frontmatter splitter / joiner.
 *
 * Design invariant (D-011): body must be returned byte-for-exact — this module
 * never passes the body through any parser or reformatter. Only the frontmatter
 * text (between the `---` fences) is touched; the body is kept as the exact
 * substring of the original input.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of splitting a markdown file into its frontmatter and body regions.
 */
export interface SplitResult {
  /**
   * The raw text between the opening and closing `---` fences (not including
   * the fences themselves). `null` if the file had no frontmatter.
   */
  frontmatterText: string | null
  /**
   * The body of the document — everything after the closing `---` fence (and
   * the newline that follows it), or the entire file content if there was no
   * frontmatter. Byte-exact — never reformatted.
   */
  body: string
  /** Whether a frontmatter block was detected. */
  hadFrontmatter: boolean
  /** Predominant line-ending style detected across the file. */
  eol: '\n' | '\r\n'
  /** Whether the original file ended with a newline character. */
  trailingNewline: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect the predominant line-ending style in `text`.
 * Falls back to `'\n'` when there are no newlines.
 */
function detectEol(text: string): '\n' | '\r\n' {
  const crlfCount = (text.match(/\r\n/g) ?? []).length
  const lfCount = (text.match(/(?<!\r)\n/g) ?? []).length
  return crlfCount > lfCount ? '\r\n' : '\n'
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Split `raw` into its frontmatter text and body.
 *
 * Rules:
 * - A frontmatter block starts with `---` on the very first line (no leading
 *   whitespace) and ends at the next line that is exactly `---` (or `---\r` for
 *   CRLF files).
 * - A line that merely *contains* `---` (e.g. inside a code block in the body)
 *   does not trigger the fence.
 * - If the opening fence is not on line 1, or there is no closing fence, the
 *   entire file is treated as having no frontmatter.
 *
 * @param raw - Raw file content as a UTF-8 string.
 */
export function splitFrontmatter(raw: string): SplitResult {
  const eol = detectEol(raw)
  const trailingNewline = raw.endsWith('\n')

  // Quick check: must start with the opening fence.
  if (!raw.startsWith('---')) {
    return { frontmatterText: null, body: raw, hadFrontmatter: false, eol, trailingNewline }
  }

  // The opening `---` must be followed immediately by EOL (not e.g. `---more`).
  const afterOpenFence = raw.slice(3)
  if (!afterOpenFence.startsWith('\n') && !afterOpenFence.startsWith('\r\n')) {
    return { frontmatterText: null, body: raw, hadFrontmatter: false, eol, trailingNewline }
  }

  const openFenceLen = 3 + (afterOpenFence.startsWith('\r\n') ? 2 : 1) // `---\n` or `---\r\n`
  const rest = raw.slice(openFenceLen)

  // Search line-by-line for the closing `---` fence.
  const lines = rest.split(/\r?\n/)
  let closingLineIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '---') {
      closingLineIndex = i
      break
    }
  }

  if (closingLineIndex === -1) {
    // No closing fence — treat as body-only.
    return { frontmatterText: null, body: raw, hadFrontmatter: false, eol, trailingNewline }
  }

  // Reconstruct the exact byte offset of the closing fence in `rest`.
  // We need byte-exact offsets to ensure the body extraction is lossless.
  //
  // IMPORTANT: do NOT assume uniform EOL width across the file. A file may mix
  // CRLF frontmatter lines with LF body lines (or vice versa). We detect the
  // actual terminator for each line by looking at the character in `rest`
  // immediately following the line's text content.
  let offset = 0
  for (let i = 0; i < closingLineIndex; i++) {
    // biome-ignore lint/style/noNonNullAssertion: closingLineIndex bounds guarantee lines[i] exists
    const lineLen = lines[i]!.length
    // Check the actual byte in `rest` after this line's text to determine
    // whether it was terminated by \r\n or \n.
    const eolWidth = rest[offset + lineLen] === '\r' ? 2 : 1
    offset += lineLen + eolWidth
  }

  const frontmatterText = rest.slice(0, offset)
  // Remove the trailing EOL from frontmatterText (it belongs to the fence separator).
  const frontmatterTextTrimmed = frontmatterText.endsWith('\r\n')
    ? frontmatterText.slice(0, -2)
    : frontmatterText.endsWith('\n')
      ? frontmatterText.slice(0, -1)
      : frontmatterText

  // The closing `---` occupies 3 chars; then there may be an EOL before the body.
  const closingFenceEnd = offset + 3
  let bodyStart = closingFenceEnd
  if (rest[bodyStart] === '\r' && rest[bodyStart + 1] === '\n') {
    bodyStart += 2
  } else if (rest[bodyStart] === '\n') {
    bodyStart += 1
  }

  const body = rest.slice(bodyStart)

  return {
    frontmatterText: frontmatterTextTrimmed,
    body,
    hadFrontmatter: true,
    eol,
    trailingNewline,
  }
}

/**
 * Join a frontmatter text and body back into a complete markdown file string.
 *
 * The result is `---<eol><frontmatterText><eol>---<eol><body>`.  When
 * `frontmatterText` is null/empty, just `body` is returned.
 *
 * @param frontmatterText - The raw text between the fences (no leading/trailing
 *   fence lines). Pass `null` to emit no frontmatter.
 * @param body - The body text (byte-exact from `splitFrontmatter`).
 * @param eol - Line-ending style to use for the fence lines.
 */
export function joinFrontmatter(
  frontmatterText: string | null,
  body: string,
  eol: '\n' | '\r\n',
): string {
  if (frontmatterText === null) {
    return body
  }
  // Ensure frontmatterText ends with the given EOL before the closing fence.
  const text = frontmatterText.endsWith('\n') ? frontmatterText : frontmatterText + eol
  return `---${eol}${text}---${eol}${body}`
}
