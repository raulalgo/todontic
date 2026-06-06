/**
 * IPC registration for vault operations.
 *
 * Registers `ipcMain.handle` for each `VaultApi` channel, plus a folder picker
 * via `dialog.showOpenDialog`.  Watcher events are forwarded to the renderer
 * via `webContents.send('vault:event', payload)`.
 *
 * All channel names are prefixed `vault:` to match the `VaultApi` contract in
 * `@todontic/shared`.
 */

import type { ParsedPage, VaultConfig, VaultEventPayload } from '@todontic/shared'
import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { isVaultInitialised } from './vault/configStore.js'
import { addRecent, listRecent } from './vault/recentVaults.js'
import { VaultManager } from './vault/vaultManager.js'

// ─── IPC channel names ────────────────────────────────────────────────────────

export const VAULT_CHANNELS = {
  pickFolder: 'vault:pickFolder',
  isInitialised: 'vault:isInitialised',
  open: 'vault:open',
  init: 'vault:init',
  listRecent: 'vault:listRecent',
  readPage: 'vault:readPage',
  writePage: 'vault:writePage',
  getConfig: 'vault:getConfig',
  getState: 'vault:getState',
  setConfig: 'vault:setConfig',
  reserveCodes: 'vault:reserveCodes',
  event: 'vault:event',
} as const

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all vault IPC handlers.
 *
 * @param getWindow - Getter that returns the current `BrowserWindow` (used to
 *   forward watcher events to the renderer). May return null before the window
 *   is created.
 * @returns The `VaultManager` instance so `main/index.ts` can call `open()` on
 *   startup.
 */
export function registerVaultIpc(getWindow: () => BrowserWindow | null): VaultManager {
  const emit = (payload: VaultEventPayload) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(VAULT_CHANNELS.event, payload)
    }
  }

  const manager = new VaultManager(emit)

  // ── vault:pickFolder ───────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.pickFolder, async () => {
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Select vault folder',
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  // ── vault:isInitialised ────────────────────────────────────────────────────
  // Side-effect-free check used by the renderer to route between open and the
  // initialise prompt. Does NOT open the vault.
  ipcMain.handle(VAULT_CHANNELS.isInitialised, async (_event, rootPath: string) => {
    return isVaultInitialised(rootPath)
  })

  // ── vault:open ─────────────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.open, async (_event, rootPath: string) => {
    await manager.open(rootPath)
    await addRecent(rootPath)
  })

  // ── vault:init ─────────────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.init, async (_event, rootPath: string) => {
    await manager.init(rootPath)
    await addRecent(rootPath)
  })

  // ── vault:listRecent ───────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.listRecent, async () => {
    return listRecent()
  })

  // ── vault:readPage ─────────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.readPage, async (_event, relPath: string) => {
    return manager.readPage(relPath)
  })

  // ── vault:writePage ────────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.writePage, async (_event, page: ParsedPage) => {
    await manager.writePage(page)
  })

  // ── vault:getConfig ────────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.getConfig, () => {
    return manager.getConfig()
  })

  // ── vault:getState ─────────────────────────────────────────────────────────
  ipcMain.handle(VAULT_CHANNELS.getState, () => {
    const rootPath = manager.getRootPath()
    if (!rootPath) return null
    return { rootPath, config: manager.getConfig() }
  })

  // ── vault:setConfig ────────────────────────────────────────────────────────
  // The renderer may send a full VaultConfig but codePrefixes counters are
  // NEVER taken from it — the manager extracts only user-editable fields and
  // re-reads the authoritative counters from disk under the shared mutex
  // (Findings #1 and #2 fix).
  ipcMain.handle(VAULT_CHANNELS.setConfig, async (_event, config: VaultConfig) => {
    await manager.setConfig({
      codePrefix: config.codePrefix,
      statuses: config.statuses,
      attachmentsPath: config.attachmentsPath,
    })
  })

  // ── vault:reserveCodes ─────────────────────────────────────────────────────
  // Routed through VaultManager.reserveCodes which shares the config mutex with
  // setConfig, preventing lost-update races (Findings #1 and #2 fix).
  ipcMain.handle(VAULT_CHANNELS.reserveCodes, async (_event, prefix: string, n: number) => {
    return manager.reserveCodes(prefix, n)
  })

  return manager
}
