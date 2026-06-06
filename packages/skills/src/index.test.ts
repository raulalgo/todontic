import { describe, expect, it } from 'vitest'
import * as skills from './index'

describe('@todontic/skills', () => {
  it('module loads', () => {
    expect(skills).toBeDefined()
  })
})
