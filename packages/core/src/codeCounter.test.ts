import { describe, expect, it } from 'vitest'
import { peekNext, reserveCodes } from './codeCounter.js'
import { defaultConfig } from './config.js'

describe('reserveCodes', () => {
  it('reserves 1 code from the default config → TDC-1, next becomes 2', () => {
    const { codes, config } = reserveCodes(defaultConfig(), 'TDC', 1)
    expect(codes).toEqual(['TDC-1'])
    expect(config.codePrefixes.TDC?.next).toBe(2)
  })

  it('reserves N codes in sequence', () => {
    const { codes, config } = reserveCodes(defaultConfig(), 'TDC', 3)
    expect(codes).toEqual(['TDC-1', 'TDC-2', 'TDC-3'])
    expect(config.codePrefixes.TDC?.next).toBe(4)
  })

  it('successive reservations are monotonic (no overlap)', () => {
    let cfg = defaultConfig()
    const first = reserveCodes(cfg, 'TDC', 2)
    cfg = first.config
    const second = reserveCodes(cfg, 'TDC', 2)
    const all = [...first.codes, ...second.codes]
    expect(all).toEqual(['TDC-1', 'TDC-2', 'TDC-3', 'TDC-4'])
    // No duplicates.
    expect(new Set(all).size).toBe(all.length)
  })

  it('does not mutate the input config', () => {
    const cfg = defaultConfig()
    const original = cfg.codePrefixes.TDC?.next
    reserveCodes(cfg, 'TDC', 5)
    expect(cfg.codePrefixes.TDC?.next).toBe(original)
  })

  it('throws for unknown prefix', () => {
    expect(() => reserveCodes(defaultConfig(), 'MISSING', 1)).toThrow()
  })

  it('throws for n < 1', () => {
    expect(() => reserveCodes(defaultConfig(), 'TDC', 0)).toThrow()
  })

  it('two prefixes are independent', () => {
    const cfg = {
      ...defaultConfig(),
      codePrefixes: {
        TDC: { next: 1 },
        PRJ: { next: 10 },
      },
    }
    const { codes: tdcCodes } = reserveCodes(cfg, 'TDC', 1)
    const { codes: prjCodes } = reserveCodes(cfg, 'PRJ', 1)
    expect(tdcCodes).toEqual(['TDC-1'])
    expect(prjCodes).toEqual(['PRJ-10'])
  })
})

describe('peekNext', () => {
  it('returns the next code without bumping counter', () => {
    const cfg = defaultConfig()
    expect(peekNext(cfg, 'TDC')).toBe('TDC-1')
    // Counter unchanged.
    expect(cfg.codePrefixes.TDC?.next).toBe(1)
  })

  it('throws for unknown prefix', () => {
    expect(() => peekNext(defaultConfig(), 'UNKNOWN')).toThrow()
  })

  it('reflects bumped counter after reserve', () => {
    const { config } = reserveCodes(defaultConfig(), 'TDC', 3)
    expect(peekNext(config, 'TDC')).toBe('TDC-4')
  })
})
