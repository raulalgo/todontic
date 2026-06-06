import { describe, expect, it } from 'vitest'
import * as installer from './index'

describe('@todontic/mcp-installer', () => {
  it('module loads', () => {
    expect(installer).toBeDefined()
  })
})
