import { describe, expect, it } from 'vitest'
import { BUILTIN_STATUSES } from './index'

describe('@todontic/shared', () => {
  it('exposes the four built-in statuses in order', () => {
    expect(BUILTIN_STATUSES).toEqual(['todo', 'in-progress', 'blocked', 'done'])
  })
})
