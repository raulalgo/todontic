/**
 * Vault config store (main process).
 *
 * Wraps the pure `core.parseConfig` / `core.serializeConfig` functions with
 * actual filesystem I/O via `atomicWrite`.  Also owns `initVault` which
 * creates the `.todontic/` directory scaffold.
 *
 * On parse error the last-valid config is retained and the error is surfaced
 * to the caller — no exceptions bubble up for parse failures.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultConfig, parseConfig, serializeConfig } from '@todontic/core'
import type { VaultConfig } from '@todontic/shared'
import { CONFIG_RELATIVE_PATH, TODONTIC_DIR } from '@todontic/shared'
import { atomicWrite } from './atomicWrite.js'

/** Result from loading the config. */
export interface LoadConfigResult {
  config: VaultConfig
  /** Set if the on-disk YAML was invalid; the caller receives the last-valid config. */
  error?: string
}

/**
 * Load `.todontic/config.yml` from the vault at `rootPath`.
 *
 * Returns defaults + an error message if the file is missing or invalid YAML.
 */
export async function loadConfig(rootPath: string): Promise<LoadConfigResult> {
  const configPath = path.join(rootPath, CONFIG_RELATIVE_PATH)
  let raw: string
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch {
    // File missing — return defaults.
    return { config: defaultConfig(), error: 'Config file not found; using defaults.' }
  }

  return parseConfig(raw)
}

/**
 * Write `config` to `.todontic/config.yml` atomically.
 *
 * @param rootPath - Absolute vault root path.
 * @param config - The config to persist.
 */
export async function saveConfig(rootPath: string, config: VaultConfig): Promise<void> {
  const configPath = path.join(rootPath, CONFIG_RELATIVE_PATH)
  await atomicWrite(configPath, serializeConfig(config))
}

/**
 * Initialise a new vault at `rootPath`.
 *
 * Creates:
 * - `.todontic/`
 * - `.todontic/runs/`
 * - `.todontic/cache/`
 * - `.todontic/config.yml` (with `defaultConfig()` contents)
 *
 * Safe to call on an already-initialised vault: existing files are left intact.
 */
export async function initVault(rootPath: string): Promise<void> {
  const todonticDir = path.join(rootPath, TODONTIC_DIR)
  await fs.mkdir(todonticDir, { recursive: true })
  await fs.mkdir(path.join(todonticDir, 'runs'), { recursive: true })
  await fs.mkdir(path.join(todonticDir, 'cache'), { recursive: true })

  const configPath = path.join(rootPath, CONFIG_RELATIVE_PATH)
  // Only write the config if it does not already exist.
  try {
    await fs.access(configPath)
    // File exists — leave it.
  } catch {
    await atomicWrite(configPath, serializeConfig(defaultConfig()))
  }
}

/**
 * Return whether `rootPath` looks like an initialised Todontic vault
 * (i.e. `.todontic/config.yml` exists).
 */
export async function isVaultInitialised(rootPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(rootPath, CONFIG_RELATIVE_PATH))
    return true
  } catch {
    return false
  }
}
