import { describe, expect, it } from 'vitest'
import { defaultConfig, parseConfig, serializeConfig } from './config.js'

describe('defaultConfig', () => {
  it('returns prefix TDC', () => {
    expect(defaultConfig().codePrefix).toBe('TDC')
  })

  it('returns the four built-in statuses', () => {
    expect(defaultConfig().statuses).toEqual(['todo', 'in-progress', 'blocked', 'done'])
  })

  it('returns attachmentsPath = attachments', () => {
    expect(defaultConfig().attachmentsPath).toBe('attachments')
  })

  it('returns counter seed { TDC: { next: 1 } }', () => {
    expect(defaultConfig().codePrefixes).toEqual({ TDC: { next: 1 } })
  })
})

describe('parseConfig', () => {
  it('parses a valid config', () => {
    const yaml =
      'codePrefix: PRJ\nstatuses:\n  - todo\n  - done\nattachmentsPath: files\ncodePrefixes:\n  PRJ:\n    next: 5\n'
    const { config, error } = parseConfig(yaml)
    expect(error).toBeUndefined()
    expect(config.codePrefix).toBe('PRJ')
    expect(config.statuses).toEqual(['todo', 'done'])
    expect(config.attachmentsPath).toBe('files')
    expect(config.codePrefixes.PRJ?.next).toBe(5)
  })

  it('returns error (no throw) for invalid YAML', () => {
    const { config, error } = parseConfig(': invalid: yaml: :::')
    expect(error).toBeDefined()
    expect(typeof error).toBe('string')
    // Falls back to defaults.
    expect(config.codePrefix).toBe('TDC')
  })

  it('returns error for empty content', () => {
    const { config, error } = parseConfig('')
    expect(error).toBeDefined()
    // Falls back to defaults.
    expect(config.codePrefix).toBe('TDC')
  })

  it('uses defaults for missing fields', () => {
    const yaml = 'codePrefix: ABC\n'
    const { config } = parseConfig(yaml)
    expect(config.statuses).toEqual(['todo', 'in-progress', 'blocked', 'done'])
    expect(config.attachmentsPath).toBe('attachments')
    // Active prefix added to codePrefixes if absent.
    expect(config.codePrefixes.ABC?.next).toBe(1)
  })

  it('preserves custom statuses', () => {
    const yaml =
      'codePrefix: TDC\nstatuses:\n  - todo\n  - in-review\n  - done\nattachmentsPath: attachments\ncodePrefixes:\n  TDC:\n    next: 1\n'
    const { config } = parseConfig(yaml)
    expect(config.statuses).toContain('in-review')
  })

  it('returns error (no throw) when a prefix next value is non-numeric string', () => {
    // A hand-edited config with `next: foo` must NOT silently reset to 1,
    // because that would violate the forever-unique/never-reused code invariant.
    const yaml =
      'codePrefix: TDC\nstatuses:\n  - todo\n  - done\nattachmentsPath: attachments\ncodePrefixes:\n  TDC:\n    next: 6\n  PRJ:\n    next: foo\n'
    const { config, error } = parseConfig(yaml)
    expect(error).toBeDefined()
    expect(typeof error).toBe('string')
    // Falls back to defaults — caller retains last-valid config.
    expect(config.codePrefix).toBe('TDC')
  })

  it('returns error when a prefix next is empty (null YAML value)', () => {
    // `next:` with no value parses as null in YAML — must also be a surfaced error.
    const yaml =
      'codePrefix: TDC\nstatuses:\n  - todo\nattachmentsPath: attachments\ncodePrefixes:\n  TDC:\n    next:\n'
    const { config, error } = parseConfig(yaml)
    expect(error).toBeDefined()
    // Falls back to defaults.
    expect(config.codePrefixes.TDC?.next).toBe(1)
  })

  it('accepts a valid multi-prefix config without error', () => {
    const yaml =
      'codePrefix: TDC\nstatuses:\n  - todo\n  - done\nattachmentsPath: attachments\ncodePrefixes:\n  TDC:\n    next: 6\n  PRJ:\n    next: 3\n'
    const { config, error } = parseConfig(yaml)
    expect(error).toBeUndefined()
    expect(config.codePrefixes.TDC?.next).toBe(6)
    expect(config.codePrefixes.PRJ?.next).toBe(3)
  })
})

describe('serializeConfig', () => {
  it('produces YAML that round-trips through parseConfig', () => {
    const original = defaultConfig()
    const yaml = serializeConfig(original)
    const { config: reparsed, error } = parseConfig(yaml)
    expect(error).toBeUndefined()
    expect(reparsed.codePrefix).toBe(original.codePrefix)
    expect(reparsed.statuses).toEqual(original.statuses)
    expect(reparsed.attachmentsPath).toBe(original.attachmentsPath)
    expect(reparsed.codePrefixes).toEqual(original.codePrefixes)
  })

  it('produces valid YAML string', () => {
    const yaml = serializeConfig(defaultConfig())
    expect(typeof yaml).toBe('string')
    expect(yaml).toContain('codePrefix: TDC')
  })

  it('custom status list (with built-in removed) survives serialize→parseConfig round-trip', () => {
    // Status enum hotspot: a user-extended list that removes 'blocked' and adds
    // 'in-review' must persist intact (order + custom + removal).
    const customStatuses = ['todo', 'in-progress', 'in-review', 'done'] as const
    const cfg = { ...defaultConfig(), statuses: [...customStatuses] }
    const yaml = serializeConfig(cfg)
    const { config: reparsed, error } = parseConfig(yaml)
    expect(error).toBeUndefined()
    expect(reparsed.statuses).toEqual([...customStatuses])
    // 'blocked' was removed.
    expect(reparsed.statuses).not.toContain('blocked')
    // 'in-review' was added.
    expect(reparsed.statuses).toContain('in-review')
    // Ordering must be preserved.
    expect(reparsed.statuses[2]).toBe('in-review')
  })
})
