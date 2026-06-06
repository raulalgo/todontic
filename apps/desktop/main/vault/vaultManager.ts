/**
 * Vault manager — single owner of mutable vault state in the main process.
 *
 * Responsibilities:
 * - Open a vault: scan all `.md` files → parse → build in-memory index →
 *   start chokidar watcher.
 * - Read a page from disk (parse + return).
 * - Write a page: serialize → atomic write → register self-write → upsert
 *   index in place.
 * - Reserve codes: mutex-protected load → reserve → persist → update in-memory.
 * - Set user config: mutex-protected load → merge user fields → persist →
 *   update in-memory. Never overwrites codePrefixes counters.
 * - Close: stop watcher.
 *
 * Data-flow (D-011, Philosophy #10):
 *   disk → scanVault → parsePage → Page[] → buildIndex → live VaultIndex
 *   Writes: renderer edit → IPC writePage → serializePage → atomicWrite
 *            → registerSelfWrite → upsert index
 *
 * Concurrency invariant:
 *   All writes to config.yml (both reserveCodes and setConfig) are serialised
 *   through a single per-instance AsyncMutex so there are no lost-update races.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { buildIndex, parsePage, reserveCodes, serializePage } from '@todontic/core'
import type {
  ParsedPage,
  Status,
  VaultConfig,
  VaultEventPayload,
  VaultIndex,
} from '@todontic/shared'
import { atomicWrite } from './atomicWrite.js'
import {
  initVault as coreInitVault,
  isVaultInitialised,
  loadConfig,
  saveConfig,
} from './configStore.js'
import { scanVault } from './scan.js'
import { VaultWatcher } from './watcher.js'

// ─── Async mutex ──────────────────────────────────────────────────────────────

/**
 * A minimal non-reentrant async mutex.
 *
 * All operations that must not interleave (load → reserve → persist, or
 * load → merge-user-fields → persist) acquire this lock.  A single in-process
 * lock per VaultManager instance is sufficient because Todontic has exactly one
 * main-process instance with one open vault at a time.
 */
class AsyncMutex {
  private queue: Array<() => void> = []
  private locked = false

  acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type VaultEventEmitter = (payload: VaultEventPayload) => void

/** The user-editable subset of VaultConfig (never includes counter state). */
export interface UserConfigUpdate {
  codePrefix: string
  statuses: Status[]
  attachmentsPath: string
}

/** The live in-memory vault state. */
interface LiveVault {
  rootPath: string
  pages: Map<string, ParsedPage> // relPath → ParsedPage
  index: VaultIndex
  config: VaultConfig
  watcher: VaultWatcher
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Rebuild the VaultIndex in-place from the current pages map. */
function rebuildIndex(vault: LiveVault): void {
  vault.index = buildIndex([...vault.pages.values()])
}

// ─── VaultManager class ───────────────────────────────────────────────────────

/**
 * Singleton-style manager for the currently-open vault.
 *
 * Instantiate once in main and share via `ipc.ts`.
 */
export class VaultManager {
  private vault: LiveVault | null = null
  private readonly emitEvent: VaultEventEmitter
  /**
   * Single mutex serialising ALL config.yml writers: reserveCodes and setConfig.
   * Both are read-modify-write on the same file; sharing one lock prevents
   * lost-update races (Findings #1 and #2).
   */
  private readonly configMutex = new AsyncMutex()

  constructor(emitEvent: VaultEventEmitter) {
    this.emitEvent = emitEvent
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Open the vault at `rootPath`.
   * Scans all `.md` files, builds the index, and starts the watcher.
   * Closes any previously-open vault first.
   *
   * @throws if the vault has not been initialised (no `.todontic/config.yml`).
   */
  async open(rootPath: string): Promise<void> {
    await this.close()

    const isInit = await isVaultInitialised(rootPath)
    if (!isInit) {
      throw new Error(`Vault at '${rootPath}' is not initialised. Run vault.init(rootPath) first.`)
    }

    const { config } = await loadConfig(rootPath)

    const rawFiles = await scanVault(rootPath)
    const pages = new Map<string, ParsedPage>()
    for (const { relPath, absPath, raw } of rawFiles) {
      const page = parsePage(raw, relPath, absPath)
      pages.set(relPath, page)
    }

    const index = buildIndex([...pages.values()])

    // Capture vault in a closure so the watcher callback can update it.
    // We'll set `this.vault` before starting the watcher.
    // watcher is assigned on the next line; the partial object is safe because
    // we set liveVault.watcher before calling watcher.start() below.
    const liveVault = { rootPath, pages, index, config } as LiveVault

    const watcher = new VaultWatcher(rootPath, (event) => {
      if (event.type === 'added' || event.type === 'changed') {
        liveVault.pages.set(event.relPath, event.page)
        rebuildIndex(liveVault)
        this.emitEvent({
          type: event.type === 'added' ? 'created' : 'changed',
          relPath: event.relPath,
          page: event.page,
        })
      } else if (event.type === 'unlinked') {
        liveVault.pages.delete(event.relPath)
        rebuildIndex(liveVault)
        this.emitEvent({ type: 'unlinked', relPath: event.relPath })
      }
    })

    liveVault.watcher = watcher
    this.vault = liveVault
    watcher.start()
  }

  /**
   * Initialise a new vault at `rootPath` (creates `.todontic/config.yml`),
   * then opens it.
   */
  async init(rootPath: string): Promise<void> {
    await coreInitVault(rootPath)
    await this.open(rootPath)
  }

  /** Close the currently-open vault and release the watcher. */
  async close(): Promise<void> {
    if (this.vault) {
      await this.vault.watcher.stop()
      this.vault = null
    }
  }

  // ─── Page I/O ──────────────────────────────────────────────────────────────

  /**
   * Read and parse a page by vault-relative path.
   * Returns `null` if the file does not exist.
   */
  async readPage(relPath: string): Promise<ParsedPage | null> {
    const vault = this.requireVault()
    const absPath = path.join(vault.rootPath, relPath)
    let raw: string
    try {
      raw = await fs.readFile(absPath, 'utf-8')
    } catch {
      return null
    }
    return parsePage(raw, relPath, absPath)
  }

  /**
   * Serialize `page` and write it to disk atomically.
   *
   * The written path is registered as a self-write so the chokidar event
   * fired by the rename does not cause a spurious "external edit" notification.
   * The in-memory index is updated in-place immediately.
   */
  async writePage(page: ParsedPage): Promise<void> {
    const vault = this.requireVault()
    const absPath = path.join(vault.rootPath, page.relPath)
    const contents = serializePage(page)

    // Register the self-write BEFORE the atomic write so the watcher event
    // (which may fire before the write returns on some OS/FS combos) is
    // suppressed correctly.
    vault.watcher.registerSelfWrite(absPath)
    await atomicWrite(absPath, contents)

    // Update the in-memory page and rebuild the index.
    vault.pages.set(page.relPath, { ...page, filePath: absPath })
    rebuildIndex(vault)
  }

  // ─── Config ────────────────────────────────────────────────────────────────

  /** Return the current vault config (reflects the latest persisted state). */
  getConfig(): VaultConfig {
    return this.requireVault().config
  }

  /**
   * Update the user-editable fields of the vault config and persist it.
   *
   * Only `codePrefix`, `statuses`, and `attachmentsPath` are accepted from the
   * renderer.  The `codePrefixes` counter map is NEVER overwritten by this
   * method — it always re-reads the authoritative value from disk inside the
   * shared config mutex so a concurrent `reserveCodes` call cannot be silently
   * reverted (Findings #1 and #2 fix).
   *
   * A new prefix that does not yet appear in `codePrefixes` is seeded with
   * `next: 1` here (same as VaultSettings did before, but now safely under
   * the lock with a fresh on-disk base).
   */
  async setConfig(update: UserConfigUpdate): Promise<void> {
    const vault = this.requireVault()
    await this.configMutex.acquire()
    try {
      // Always load fresh from disk so we never clobber a bumped counter.
      const { config: current } = await loadConfig(vault.rootPath)

      // Seed the new prefix if it doesn't exist yet (counter starts at 1).
      const codePrefixes = { ...current.codePrefixes }
      if (!codePrefixes[update.codePrefix]) {
        codePrefixes[update.codePrefix] = { next: 1 }
      }

      const merged: VaultConfig = {
        codePrefix: update.codePrefix,
        statuses: update.statuses,
        attachmentsPath: update.attachmentsPath,
        codePrefixes,
      }

      await saveConfig(vault.rootPath, merged)
      // Keep in-memory config in sync so getConfig() is never stale.
      vault.config = merged
    } finally {
      this.configMutex.release()
    }
  }

  /**
   * Reserve `n` monotonic codes for `prefix` in the open vault.
   *
   * The operation is serialised through the shared config mutex so concurrent
   * callers (and concurrent `setConfig` calls) never see overlapping or
   * clobbered counter values.
   *
   * @param prefix - Code prefix (must already exist in config.codePrefixes or
   *   will be seeded automatically at next: 1).
   * @param n      - Number of codes to reserve (≥ 1).
   * @returns Allocated codes, e.g. `['TDC-1', 'TDC-2']`.
   */
  async reserveCodes(prefix: string, n: number): Promise<string[]> {
    const vault = this.requireVault()
    await this.configMutex.acquire()
    try {
      // Always load from disk inside the lock — this is the single authoritative read.
      const { config: current } = await loadConfig(vault.rootPath)
      const { config: updated, codes } = reserveCodes(current, prefix, n)
      // Persist the bumped counter before returning codes — all-or-none.
      await saveConfig(vault.rootPath, updated)
      // Keep in-memory config in sync so getConfig() reflects the bumped counter.
      vault.config = updated
      return codes
    } finally {
      this.configMutex.release()
    }
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  /** Return the root path of the currently-open vault, or null. */
  getRootPath(): string | null {
    return this.vault?.rootPath ?? null
  }

  /** Return true if a vault is currently open. */
  isOpen(): boolean {
    return this.vault !== null
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private requireVault(): LiveVault {
    if (!this.vault) {
      throw new Error('No vault is currently open. Call vault.open() first.')
    }
    return this.vault
  }
}
