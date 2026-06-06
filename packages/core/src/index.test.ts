import { TODONTIC_VERSION } from '@todontic/shared'
import { describe, expect, it } from 'vitest'

describe('@todontic/core', () => {
  it('can import from @todontic/shared across the workspace', () => {
    expect(TODONTIC_VERSION).toBe('0.1.0')
  })
})
