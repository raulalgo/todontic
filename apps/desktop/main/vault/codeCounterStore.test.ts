import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reserveCodesLocked } from './codeCounterStore.js'
import { initVault } from './configStore.js'

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'todontic-counter-'))
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

describe('reserveCodesLocked', () => {
  it('allocates a single code and persists the counter', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const codes = await reserveCodesLocked(tmpDir, 'TDC', 1)
    expect(codes).toEqual(['TDC-1'])

    // A subsequent call should get TDC-2.
    const codes2 = await reserveCodesLocked(tmpDir, 'TDC', 1)
    expect(codes2).toEqual(['TDC-2'])
  })

  it('allocates N codes in a single call', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const codes = await reserveCodesLocked(tmpDir, 'TDC', 3)
    expect(codes).toEqual(['TDC-1', 'TDC-2', 'TDC-3'])
  })

  it('concurrent reservations yield non-overlapping codes', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    // Fire 5 concurrent reserve-1 calls.
    const promises = Array.from({ length: 5 }, () => reserveCodesLocked(tmpDir, 'TDC', 1))
    const results = await Promise.all(promises)
    const allCodes = results.flat()

    // All codes should be unique.
    expect(new Set(allCodes).size).toBe(allCodes.length)

    // The set should be exactly TDC-1 through TDC-5 (no gaps, no dupes).
    const nums = allCodes.map((c) => Number(c.split('-')[1])).sort((a, b) => a - b)
    expect(nums).toEqual([1, 2, 3, 4, 5])
  })

  it('throws for an unknown prefix', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)
    await expect(reserveCodesLocked(tmpDir, 'MISSING', 1)).rejects.toThrow()
  })
})
