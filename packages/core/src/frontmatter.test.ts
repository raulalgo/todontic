import { describe, expect, it } from 'vitest'
import { joinFrontmatter, splitFrontmatter } from './frontmatter.js'

describe('splitFrontmatter', () => {
  it('returns body whole when there is no frontmatter', () => {
    const raw = '# Hello\n\nSome content.\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(false)
    expect(result.frontmatterText).toBeNull()
    expect(result.body).toBe(raw)
  })

  it('parses a valid todontic: frontmatter block', () => {
    const raw = '---\ntodontic:\n  code: TDC-1\n  status: todo\n---\n# Page\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(true)
    expect(result.frontmatterText).toBe('todontic:\n  code: TDC-1\n  status: todo')
    expect(result.body).toBe('# Page\n')
  })

  it('detects LF line endings', () => {
    const raw = '---\nkey: val\n---\nbody\n'
    const result = splitFrontmatter(raw)
    expect(result.eol).toBe('\n')
  })

  it('detects CRLF line endings and preserves them', () => {
    const raw = '---\r\nkey: val\r\n---\r\nbody\r\n'
    const result = splitFrontmatter(raw)
    expect(result.eol).toBe('\r\n')
    expect(result.hadFrontmatter).toBe(true)
    expect(result.body).toBe('body\r\n')
  })

  it('preserves trailing newline presence', () => {
    const withNewline = '---\nk: v\n---\nbody\n'
    const withoutNewline = '---\nk: v\n---\nbody'
    expect(splitFrontmatter(withNewline).trailingNewline).toBe(true)
    expect(splitFrontmatter(withoutNewline).trailingNewline).toBe(false)
  })

  it('does not mistake --- in the body for a closing fence', () => {
    const raw = '---\ntodontic:\n  code: TDC-2\n---\n# Title\n\n---\n\nHr above.\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(true)
    // The body should contain the `---` horizontal rule.
    expect(result.body).toContain('---')
    expect(result.body).toBe('# Title\n\n---\n\nHr above.\n')
  })

  it('handles an empty file', () => {
    const result = splitFrontmatter('')
    expect(result.hadFrontmatter).toBe(false)
    expect(result.body).toBe('')
  })

  it('treats file as body-only when opening fence is not on line 1', () => {
    const raw = '\n---\nk: v\n---\nbody\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(false)
    expect(result.body).toBe(raw)
  })

  it('treats file as body-only when there is no closing fence', () => {
    const raw = '---\nk: v\nbody with no closing fence\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(false)
    expect(result.body).toBe(raw)
  })

  it('does not treat ---more as opening fence', () => {
    const raw = '---more\nstuff\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(false)
    expect(result.body).toBe(raw)
  })

  it('handles frontmatter with empty body', () => {
    const raw = '---\ntodontic:\n  code: TDC-3\n---\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(true)
    expect(result.body).toBe('')
  })

  // Mixed-EOL: CRLF frontmatter lines + LF body lines.
  // detectEol returns '\n' (LF dominates), but offset math must use the actual
  // per-line terminator — otherwise each CRLF frontmatter line undershoots by 1,
  // corrupting the body slice and breaking D-011 round-trip stability.
  it('correctly extracts body when frontmatter uses CRLF but body uses LF (mixed EOL)', () => {
    // 3 frontmatter lines with CRLF, body lines with LF — LF dominates so
    // detectEol returns '\n', but the offset loop must still add 2 for each
    // CRLF-terminated frontmatter line.
    const raw = '---\r\ntodontic:\r\n  code: TDC-1\r\n---\nbody line 1\nbody line 2\n'
    const result = splitFrontmatter(raw)
    expect(result.hadFrontmatter).toBe(true)
    // eol is '\n' because the body lines dominate
    expect(result.eol).toBe('\n')
    // frontmatterText must be the exact content between the fences
    expect(result.frontmatterText).toBe('todontic:\r\n  code: TDC-1')
    // body must start immediately after the closing `---\n`
    expect(result.body).toBe('body line 1\nbody line 2\n')
  })
})

describe('joinFrontmatter', () => {
  it('reconstructs the original from split parts (LF)', () => {
    const raw = '---\ntodontic:\n  code: TDC-1\n---\n# Page\n'
    const { frontmatterText, body, eol } = splitFrontmatter(raw)
    const rejoined = joinFrontmatter(frontmatterText, body, eol)
    expect(rejoined).toBe(raw)
  })

  it('reconstructs the original from split parts (CRLF)', () => {
    const raw = '---\r\ntodontic:\r\n  code: TDC-1\r\n---\r\nbody\r\n'
    const { frontmatterText, body, eol } = splitFrontmatter(raw)
    const rejoined = joinFrontmatter(frontmatterText, body, eol)
    expect(rejoined).toBe(raw)
  })

  it('returns body unchanged when frontmatterText is null', () => {
    const body = '# Hello\n\nBody.\n'
    expect(joinFrontmatter(null, body, '\n')).toBe(body)
  })
})
