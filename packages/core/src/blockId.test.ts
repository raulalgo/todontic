import { describe, expect, it } from 'vitest'
import { BLOCK_ID_RE, extractBlockIds } from './blockId.js'

describe('BLOCK_ID_RE', () => {
  it('matches a valid 6-char block id', () => {
    expect(BLOCK_ID_RE.test('- item ^abc123')).toBe(true)
  })

  it('rejects a 5-char block id', () => {
    expect(BLOCK_ID_RE.test('- item ^abc12')).toBe(false)
  })

  it('rejects a 7-char block id', () => {
    expect(BLOCK_ID_RE.test('- item ^abc1234')).toBe(false)
  })

  it('rejects ^ mid-line (not at end)', () => {
    // The regex is anchored to end-of-string so mid-line ^ won't match.
    expect(BLOCK_ID_RE.test('- ^abc123 more text')).toBe(false)
  })
})

describe('extractBlockIds', () => {
  it('extracts a single block id', () => {
    const body = '- item one ^abc123\n- item two\n'
    const refs = extractBlockIds(body)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ id: '^abc123', line: 1 })
  })

  it('extracts multiple block ids from different lines', () => {
    const body = '- first ^aaa111\n- second\n- third ^bbb222\n'
    const refs = extractBlockIds(body)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ id: '^aaa111', line: 1 })
    expect(refs[1]).toMatchObject({ id: '^bbb222', line: 3 })
  })

  it('returns empty array for body with no block ids', () => {
    const body = '# Title\n\nParagraph.\n'
    expect(extractBlockIds(body)).toHaveLength(0)
  })

  it('rejects near-miss with 5 chars', () => {
    const body = '- item ^abc12\n'
    expect(extractBlockIds(body)).toHaveLength(0)
  })

  it('rejects near-miss with 7 chars', () => {
    const body = '- item ^abc1234\n'
    expect(extractBlockIds(body)).toHaveLength(0)
  })

  it('ignores ^ that is not at end of line', () => {
    const body = '- ^abc123 continues here\n'
    expect(extractBlockIds(body)).toHaveLength(0)
  })

  it('handles trailing whitespace on line (trims before matching)', () => {
    // Trailing spaces should not prevent detection.
    const body = '- item ^abc123   \n'
    const refs = extractBlockIds(body)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ id: '^abc123', line: 1 })
  })

  it('returns correct 1-based line numbers', () => {
    const body = 'line1\nline2 ^aabbcc\nline3\n'
    const refs = extractBlockIds(body)
    expect(refs[0]?.line).toBe(2)
  })
})
