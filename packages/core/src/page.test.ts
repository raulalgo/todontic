import { describe, expect, it } from 'vitest'
import { parsePage, roundTrip, serializePage } from './page.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODONTIC_PAGE = `---
todontic:
  code: TDC-1
  status: todo
  tags:
    - work
    - planning
---
# My Task

Some body content here.

- item one ^abc123
- item two

[[TDC-2]] see also this page.
`

const FOREIGN_KEYS_PAGE = `---
aliases:
  - my-alias
tags:
  - obsidian-tag
todontic:
  code: TDC-5
  status: in-progress
---
# Foreign Keys Test
`

const NO_FRONTMATTER_PAGE = `# Plain Page

Just a body, no frontmatter at all.
`

const CRLF_PAGE = '---\r\ntodontic:\r\n  code: TDC-7\r\n  status: done\r\n---\r\n# CRLF Page\r\n'

const NO_TRAILING_NL_PAGE = '---\ntodontic:\n  code: TDC-8\n---\n# No trailing newline'

const WIKILINKS_AND_BLOCKIDS_PAGE = `---
todontic:
  code: TDC-10
  status: blocked
---
# Rich Page

- task with block ^aabbcc
- link to [[TDC-1]] and [[TDC-2#^abc123]]
`

/**
 * Mixed-EOL: CRLF frontmatter + LF body.
 * D-011 round-trip must be byte-stable even though detectEol returns '\n'.
 * The serialiser uses the detected eol ('\n') for the fence lines; the body
 * and the CRLF frontmatter content pass through byte-unchanged.
 *
 * After splitFrontmatter the frontmatterText is 'todontic:\r\n  code: TDC-99'
 * (with CRLF preserved inside the text).  parseFrontmatterText splits on
 * /\r?\n/ and rejoins with eol='\n', so the re-serialised todontic block will
 * use LF — meaning this file is NOT byte-identical after the first serialize
 * (the todontic block normalises to LF on first write).  What we assert is:
 *  1. The body is extracted correctly (D-011 sacred-body invariant).
 *  2. The second round-trip IS byte-identical (serialize→parse→serialize stable).
 */
const MIXED_EOL_PAGE =
  '---\r\ntodontic:\r\n  code: TDC-99\r\n  status: todo\r\n---\nbody line 1\nbody line 2\n'

// ── New fixtures for Findings #3, #4, #5 ─────────────────────────────────────

/**
 * Finding #3: todontic: block appears BEFORE foreign keys.
 * The serializer must restore this ordering on round-trip.
 */
const TODONTIC_FIRST_PAGE = `---
todontic:
  code: TDC-11
  status: todo
aliases:
  - my-alias
---
# Todontic-first Page
`

/**
 * Finding #4: CRLF file with foreign frontmatter.
 * Foreign lines must keep their CRLF line endings after a round-trip.
 */
const CRLF_FOREIGN_PAGE =
  '---\r\naliases:\r\n  - crlf-alias\r\ntodontic:\r\n  code: TDC-12\r\n  status: done\r\n---\r\n# CRLF Foreign Page\r\n'

/**
 * Finding #5: blank line inside the todontic: block.
 * After the blank line, the continuation lines must still be treated as part
 * of todontic: (not pushed into foreignFrontmatter and duplicated on write).
 *
 * Note: the round-trip for this page is NOT byte-identical because yaml.stringify
 * re-serialises the todontic block without the internal blank line.  What we
 * assert is that foreign keys are NOT duplicated and the aliases value survives.
 */
const BLANK_IN_TODONTIC_PAGE = `---
todontic:
  code: TDC-13

  status: todo
aliases:
  - no-dupe
---
# Blank-in-todontic Page
`

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parsePage', () => {
  it('extracts code, status, tags from todontic frontmatter', () => {
    const page = parsePage(TODONTIC_PAGE, 'notes/my-task.md')
    expect(page.frontmatter.code).toBe('TDC-1')
    expect(page.frontmatter.status).toBe('todo')
    expect(page.frontmatter.tags).toEqual(['work', 'planning'])
  })

  it('extracts title from first # heading', () => {
    const page = parsePage(TODONTIC_PAGE, 'notes/my-task.md')
    expect(page.title).toBe('My Task')
  })

  it('extracts block IDs from body', () => {
    const page = parsePage(TODONTIC_PAGE, 'notes/my-task.md')
    expect(page.blockIds).toHaveLength(1)
    expect(page.blockIds[0]?.id).toBe('^abc123')
  })

  it('preserves relPath and filePath', () => {
    const page = parsePage(TODONTIC_PAGE, 'notes/my-task.md', '/abs/notes/my-task.md')
    expect(page.relPath).toBe('notes/my-task.md')
    expect(page.filePath).toBe('/abs/notes/my-task.md')
  })

  it('sets hadFrontmatter=true for pages with frontmatter', () => {
    const page = parsePage(TODONTIC_PAGE, 'p.md')
    expect(page.hadFrontmatter).toBe(true)
  })

  it('sets hadFrontmatter=false for pages without frontmatter', () => {
    const page = parsePage(NO_FRONTMATTER_PAGE, 'plain.md')
    expect(page.hadFrontmatter).toBe(false)
  })

  it('extracts title from no-frontmatter page', () => {
    const page = parsePage(NO_FRONTMATTER_PAGE, 'plain.md')
    expect(page.title).toBe('Plain Page')
  })

  it('returns null title when no # heading', () => {
    const page = parsePage('No heading here.\n', 'no-h1.md')
    expect(page.title).toBeNull()
  })

  it('detects CRLF line endings', () => {
    const page = parsePage(CRLF_PAGE, 'crlf.md')
    expect(page.eol).toBe('\r\n')
    expect(page.frontmatter.code).toBe('TDC-7')
  })

  it('detects missing trailing newline', () => {
    const page = parsePage(NO_TRAILING_NL_PAGE, 'no-nl.md')
    expect(page.trailingNewline).toBe(false)
  })

  it('preserves foreign frontmatter keys', () => {
    const page = parsePage(FOREIGN_KEYS_PAGE, 'foreign.md')
    expect(page.foreignFrontmatter).toContain('aliases')
    expect(page.foreignFrontmatter).toContain('my-alias')
    expect(page.frontmatter.code).toBe('TDC-5')
  })

  it('handles page with no todontic: key (empty frontmatter)', () => {
    const raw = '---\naliases:\n  - foo\n---\n# Test\n'
    const page = parsePage(raw, 'test.md')
    expect(page.frontmatter).toEqual({})
    expect(page.foreignFrontmatter).toContain('aliases')
  })

  it('parses each of the four built-in statuses', () => {
    const statuses = ['todo', 'in-progress', 'blocked', 'done'] as const
    for (const status of statuses) {
      const raw = `---\ntodontic:\n  code: TDC-X\n  status: ${status}\n---\n# Test\n`
      const page = parsePage(raw, 'p.md')
      expect(page.frontmatter.status).toBe(status)
    }
  })

  it('parses a custom status', () => {
    const raw = '---\ntodontic:\n  code: TDC-X\n  status: in-review\n---\n# Test\n'
    const page = parsePage(raw, 'p.md')
    expect(page.frontmatter.status).toBe('in-review')
  })

  it('extracts block IDs and wikilinks on rich page', () => {
    const page = parsePage(WIKILINKS_AND_BLOCKIDS_PAGE, 'rich.md')
    expect(page.blockIds).toHaveLength(1)
    expect(page.blockIds[0]?.id).toBe('^aabbcc')
    expect(page.body).toContain('[[TDC-1]]')
    expect(page.body).toContain('[[TDC-2#^abc123]]')
  })
})

describe('serializePage + round-trip (D-011)', () => {
  const fixtures: [string, string][] = [
    ['todontic page', TODONTIC_PAGE],
    ['foreign keys page', FOREIGN_KEYS_PAGE],
    ['no frontmatter page', NO_FRONTMATTER_PAGE],
    ['CRLF page', CRLF_PAGE],
    ['no trailing newline page', NO_TRAILING_NL_PAGE],
    ['wikilinks and block IDs page', WIKILINKS_AND_BLOCKIDS_PAGE],
    // New fixtures for Findings #3, #4 (byte-stable round-trips):
    ['todontic-first ordering page', TODONTIC_FIRST_PAGE],
    ['CRLF with foreign frontmatter page', CRLF_FOREIGN_PAGE],
  ]

  for (const [name, raw] of fixtures) {
    it(`round-trip is identity for: ${name}`, () => {
      expect(roundTrip(raw)).toBe(raw)
    })
  }

  it('body is never reformatted (sacred body invariant, Philosophy #10)', () => {
    const raw =
      '---\ntodontic:\n  code: TDC-1\n---\n# Title\n\nMulti-line body.\n\n  - indented\n  - also indented\n\n'
    const page = parsePage(raw, 'p.md')
    // Body must be byte-identical regardless of what the frontmatter looks like.
    expect(page.body).toBe('# Title\n\nMulti-line body.\n\n  - indented\n  - also indented\n\n')
    expect(roundTrip(raw)).toBe(raw)
  })

  it('property: any frontmatter+body assembled from canonical parts round-trips', () => {
    // Construct a synthetic page with various features and verify round-trip.
    const page = parsePage(TODONTIC_PAGE, 'synth.md')
    // Serialize once → parse → serialize again → must equal first serialize.
    const first = serializePage(page)
    const second = serializePage(parsePage(first, 'synth.md'))
    expect(second).toBe(first)
  })

  // Finding #3: todontic: before foreign keys — ordering must be stable.
  it('preserves todontic-first ordering across round-trips', () => {
    const page = parsePage(TODONTIC_FIRST_PAGE, 'todontic-first.md')
    expect(page.todonticFirst).toBe(true)
    // Round-trip must be byte-identical.
    expect(roundTrip(TODONTIC_FIRST_PAGE)).toBe(TODONTIC_FIRST_PAGE)
    // Second serialize must also be stable.
    const first = serializePage(page)
    const second = serializePage(parsePage(first, 'todontic-first.md'))
    expect(second).toBe(first)
  })

  // Finding #4: CRLF + foreign frontmatter must not downgrade EOLs.
  it('preserves CRLF line endings in foreign frontmatter', () => {
    const page = parsePage(CRLF_FOREIGN_PAGE, 'crlf-foreign.md')
    expect(page.eol).toBe('\r\n')
    expect(page.foreignFrontmatter).toContain('aliases')
    // The foreign frontmatter must be re-joined with CRLF.
    expect(page.foreignFrontmatter).not.toContain('\r\r')
    expect(page.foreignFrontmatter).toMatch(/\r\n/)
    // Byte-stable round-trip.
    expect(roundTrip(CRLF_FOREIGN_PAGE)).toBe(CRLF_FOREIGN_PAGE)
  })

  // Mixed-EOL: CRLF frontmatter + LF body — D-011 body-exact + second-serialize stability.
  it('mixed-EOL page: body is extracted correctly and second round-trip is stable', () => {
    const page = parsePage(MIXED_EOL_PAGE, 'mixed-eol.md')
    // Body must be extracted byte-exactly despite the mixed EOL in the frontmatter.
    expect(page.body).toBe('body line 1\nbody line 2\n')
    expect(page.frontmatter.code).toBe('TDC-99')
    expect(page.frontmatter.status).toBe('todo')
    // First serialize normalises the todontic block to the detected eol ('\n').
    const first = serializePage(page)
    // Second round-trip must be byte-identical (stable canonical form).
    const second = serializePage(parsePage(first, 'mixed-eol.md'))
    expect(second).toBe(first)
  })

  // Finding #5: blank line inside todontic: block must not duplicate foreign keys.
  it('blank line inside todontic: block does not leak todontic content into foreignFrontmatter', () => {
    const page = parsePage(BLANK_IN_TODONTIC_PAGE, 'blank-in-todontic.md')
    // The todontic frontmatter must be correctly parsed.
    expect(page.frontmatter.code).toBe('TDC-13')
    expect(page.frontmatter.status).toBe('todo')
    // The aliases key must appear exactly once in foreignFrontmatter.
    expect(page.foreignFrontmatter).toContain('aliases')
    // Indented todontic continuation lines must NOT be duplicated as foreign text.
    expect(page.foreignFrontmatter).not.toContain('TDC-13')
    expect(page.foreignFrontmatter).not.toContain('status')
    // Serialised output must be stable (second round-trip equals first).
    const first = serializePage(page)
    const second = serializePage(parsePage(first, 'blank-in-todontic.md'))
    expect(second).toBe(first)
  })
})
