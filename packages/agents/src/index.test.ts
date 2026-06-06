import { describe, expect, it } from 'vitest'
import * as agents from './index'

describe('@todontic/agents', () => {
  it('module loads', () => {
    expect(agents).toBeDefined()
  })
})
