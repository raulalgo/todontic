import type {
  IndexSummary,
  PageSummary,
  ParsedPage,
  PromotionRequest,
  PromotionResult,
  RecentVault,
  VaultApi,
  VaultConfig,
  VaultEventPayload,
} from '@todontic/shared'
import { contextBridge, ipcRenderer } from 'electron'

// ─── Native menu bridge ───────────────────────────────────────────────────────

/**
 * Payload emitted by the main-process native menu to the renderer.
 *
 * `open` — user clicked "Open vault…" (equivalent to the renderer's Open button).
 * `open-recent` — user clicked a Recent vault entry; `path` is the vault path.
 */
export type MenuCommandPayload =
  | { command: 'open' }
  | { command: 'open-recent'; path: string }

/**
 * Preload bridge. Exposes a minimal, explicit API to the renderer over the
 * context-isolation boundary.
 *
 * Surfaces:
 *  - `versions` — runtime version strings (scaffold / debug).
 *  - `vault`    — typed `VaultApi` surface backed by ipcRenderer.invoke.
 *
 * D-009: only typed channels defined in `VaultApi` are exposed; no raw IPC
 * passthrough.
 */

// ─── Vault namespace ──────────────────────────────────────────────────────────

/**
 * Vault API implementation bridging renderer calls to main-process IPC.
 * Method signatures match `VaultApi` in `@todontic/shared`.
 */
const vault: VaultApi = {
  pickFolder(): Promise<string | null> {
    return ipcRenderer.invoke('vault:pickFolder') as Promise<string | null>
  },

  isInitialised(rootPath: string): Promise<boolean> {
    return ipcRenderer.invoke('vault:isInitialised', rootPath) as Promise<boolean>
  },

  open(rootPath: string): Promise<void> {
    return ipcRenderer.invoke('vault:open', rootPath) as Promise<void>
  },

  init(rootPath: string): Promise<void> {
    return ipcRenderer.invoke('vault:init', rootPath) as Promise<void>
  },

  listRecent(): Promise<RecentVault[]> {
    return ipcRenderer.invoke('vault:listRecent') as Promise<RecentVault[]>
  },

  readPage(relPath: string): Promise<ParsedPage | null> {
    return ipcRenderer.invoke('vault:readPage', relPath) as Promise<ParsedPage | null>
  },

  writePage(page: ParsedPage): Promise<void> {
    return ipcRenderer.invoke('vault:writePage', page) as Promise<void>
  },

  getConfig(): Promise<VaultConfig> {
    return ipcRenderer.invoke('vault:getConfig') as Promise<VaultConfig>
  },

  getState(): Promise<{ rootPath: string; config: VaultConfig } | null> {
    return ipcRenderer.invoke('vault:getState') as Promise<{
      rootPath: string
      config: VaultConfig
    } | null>
  },

  setConfig(config: VaultConfig): Promise<void> {
    return ipcRenderer.invoke('vault:setConfig', config) as Promise<void>
  },

  reserveCodes(prefix: string, n: number): Promise<string[]> {
    return ipcRenderer.invoke('vault:reserveCodes', prefix, n) as Promise<string[]>
  },

  /**
   * Subscribe to vault watcher events forwarded from main via `vault:event`.
   * Returns an unsubscribe function — call it to remove the listener.
   */
  onVaultEvent(cb: (payload: VaultEventPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: VaultEventPayload) => {
      cb(payload)
    }
    ipcRenderer.on('vault:event', listener)
    return () => {
      ipcRenderer.removeListener('vault:event', listener)
    }
  },

  getIndexSummary(): Promise<IndexSummary> {
    return ipcRenderer.invoke('vault:getIndexSummary') as Promise<IndexSummary>
  },

  listPages(): Promise<PageSummary[]> {
    return ipcRenderer.invoke('vault:listPages') as Promise<PageSummary[]>
  },

  deletePage(relPath: string): Promise<void> {
    return ipcRenderer.invoke('vault:deletePage', relPath) as Promise<void>
  },

  promote(req: PromotionRequest): Promise<PromotionResult> {
    return ipcRenderer.invoke('vault:promote', req) as Promise<PromotionResult>
  },
}

// ─── Native menu listener ─────────────────────────────────────────────────────

/**
 * Subscribe to native menu commands forwarded from the main process.
 *
 * Bridges the `vault:menu-open` and `vault:open-recent` channels that the
 * native File menu sends via `mainWindow.webContents.send(...)`.
 *
 * Returns an unsubscribe function — call it to remove the listener.
 */
function onMenuCommand(cb: (payload: MenuCommandPayload) => void): () => void {
  const openListener = () => cb({ command: 'open' })
  const recentListener = (_evt: Electron.IpcRendererEvent, vaultPath: string) =>
    cb({ command: 'open-recent', path: vaultPath })

  ipcRenderer.on('vault:menu-open', openListener)
  ipcRenderer.on('vault:open-recent', recentListener)

  return () => {
    ipcRenderer.removeListener('vault:menu-open', openListener)
    ipcRenderer.removeListener('vault:open-recent', recentListener)
  }
}

// ─── Full API object ──────────────────────────────────────────────────────────

const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  vault,
  onMenuCommand,
} as const

export type TodonticApi = typeof api

contextBridge.exposeInMainWorld('todontic', api)
