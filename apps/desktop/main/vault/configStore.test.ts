import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultConfig } from '@todontic/core'
import { CONFIG_RELATIVE_PATH, TODONTIC_DIR } from '@todontic/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { initVault, isVaultInitialised, loadConfig, saveConfig } from './configStore.js'

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'todontic-cfg-'))
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

describe('initVault', () => {
  it('creates .todontic/ directory and subdirectories', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const todonticDir = path.join(tmpDir, TODONTIC_DIR)
    const stat = await fs.stat(todonticDir)
    expect(stat.isDirectory()).toBe(true)

    const runs = await fs.stat(path.join(todonticDir, 'runs'))
    expect(runs.isDirectory()).toBe(true)

    const cache = await fs.stat(path.join(todonticDir, 'cache'))
    expect(cache.isDirectory()).toBe(true)
  })

  it('creates config.yml', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const configPath = path.join(tmpDir, CONFIG_RELATIVE_PATH)
    const stat = await fs.stat(configPath)
    expect(stat.isFile()).toBe(true)
  })

  it('is idempotent (safe to call twice)', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)
    await expect(initVault(tmpDir)).resolves.toBeUndefined()
  })
})

describe('loadConfig', () => {
  it('returns defaults after initVault', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)
    const { config, error } = await loadConfig(tmpDir)
    expect(error).toBeUndefined()
    expect(config.codePrefix).toBe('TDC')
    expect(config.statuses).toEqual(['todo', 'in-progress', 'blocked', 'done'])
  })

  it('returns defaults + error when config file is missing', async () => {
    tmpDir = await makeTmpDir()
    const { config, error } = await loadConfig(tmpDir)
    expect(error).toBeDefined()
    expect(config.codePrefix).toBe('TDC')
  })

  it('returns error (no throw) for invalid YAML on disk', async () => {
    tmpDir = await makeTmpDir()
    await fs.mkdir(path.join(tmpDir, TODONTIC_DIR), { recursive: true })
    await fs.writeFile(path.join(tmpDir, CONFIG_RELATIVE_PATH), ': invalid: yaml: :::')
    const { config, error } = await loadConfig(tmpDir)
    expect(error).toBeDefined()
    expect(config).toBeDefined()
  })
})

describe('saveConfig', () => {
  it('persists config and loadConfig reads it back', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)

    const cfg = { ...defaultConfig(), codePrefix: 'PRJ' }
    await saveConfig(tmpDir, cfg)

    const { config, error } = await loadConfig(tmpDir)
    expect(error).toBeUndefined()
    expect(config.codePrefix).toBe('PRJ')
  })
})

describe('isVaultInitialised', () => {
  it('returns false for an empty directory', async () => {
    tmpDir = await makeTmpDir()
    expect(await isVaultInitialised(tmpDir)).toBe(false)
  })

  it('returns true after initVault', async () => {
    tmpDir = await makeTmpDir()
    await initVault(tmpDir)
    expect(await isVaultInitialised(tmpDir)).toBe(true)
  })
})
