/**
 * Recent vaults persistence.
 *
 * Persists the last 5 recently-opened vault paths in Electron's userData
 * directory as a JSON file.  This is NOT stored inside any vault (so it
 * survives vault deletion / re-init) and is not tracked by chokidar.
 *
 * Format: `{ vaults: RecentVault[] }` — newest first, max 5 entries.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { RecentVault } from '@todontic/shared'
import { app } from 'electron'

/** Maximum number of recent vault entries to keep. */
const MAX_RECENT = 5

/** Filename inside `app.getPath('userData')`. */
const RECENT_FILE = 'recent-vaults.json'

function recentFilePath(): string {
  return path.join(app.getPath('userData'), RECENT_FILE)
}

/**
 * Load the current recent-vaults list, newest first.
 * Returns an empty array on any read/parse error.
 */
export async function listRecent(): Promise<RecentVault[]> {
  try {
    const raw = await fs.readFile(recentFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as { vaults: unknown[] }
    if (!Array.isArray(parsed.vaults)) return []
    return parsed.vaults as RecentVault[]
  } catch {
    return []
  }
}

/**
 * Add (or promote) `vaultPath` to the top of the recent list and persist.
 * Trims to `MAX_RECENT` entries.
 *
 * @param vaultPath - Absolute path to the vault root.
 */
export async function addRecent(vaultPath: string): Promise<void> {
  const existing = await listRecent()
  // Remove any existing entry for this path.
  const filtered = existing.filter((v) => v.path !== vaultPath)
  const updated: RecentVault[] = [
    { path: vaultPath, lastOpened: new Date().toISOString() },
    ...filtered,
  ].slice(0, MAX_RECENT)

  await fs.writeFile(recentFilePath(), JSON.stringify({ vaults: updated }, null, 2), 'utf-8')
}

/**
 * Return the most-recently-opened vault path, or `null` if there are none.
 */
export async function getLastVault(): Promise<string | null> {
  const list = await listRecent()
  return list[0]?.path ?? null
}
