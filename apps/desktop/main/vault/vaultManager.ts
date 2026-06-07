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
import { buildIndex, parsePage, reserveCodes, serializePage, parseOutline, serializeOutline, planPromotion } from '@todontic/core'
import type {
  IndexSummary,
  PageSummary,
  ParsedPage,
  PromotionRequest,
  PromotionResult,
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
import { trashItem } from './trash.js'
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

  // ─── Delete / promote (stubs — full impl in Slices 9-10) ─────────────────

  /**
   * Move a page file to the OS trash (recoverable). Updates index + emits unlinked.
   * Full implementation in Slice 10 (`vault/trash.ts` + `shell.trashItem`).
   * Stub here so the IPC channel compiles and the interface is complete.
   */
  async deletePage(relPath: string): Promise<void> {
    const vault = this.requireVault()
    const absPath = path.join(vault.rootPath, relPath)
    // Remove from in-memory index immediately.
    vault.pages.delete(relPath)
    rebuildIndex(vault)
    // Register as a self-write BEFORE trashing so the chokidar `unlinked` event
    // that fires after the file is removed is suppressed — without this the
    // watcher would emit a second `unlinked` event, causing double-processing
    // and surfacing a spurious "deleted" banner in the open page (QA Bug #4).
    vault.watcher.registerSelfWrite(absPath)
    // Move to OS trash (recoverable). Falls back to fs.unlink in non-Electron env.
    await trashItem(absPath)
    // Emit a single authoritative unlinked event.
    this.emitEvent({ type: 'unlinked', relPath })
  }

  /**
   * Promote one or more bullets to standalone pages (atomic, mutex-protected).
   *
   * Algorithm (all under configMutex):
   *   1. Skip targets that are already coded (text starts with `[[`).
   *   2. Reserve N codes (one per non-skipped target) atomically.
   *   3. For each non-skipped target, write a new page:
   *        - frontmatter: `code`, `createdAt`
   *        - body: `# <title>\n\n<childBody>` (childBody is recursive, computed
   *          by renderer via `serializeChildrenBody` — Bug #2 fix).
   *   4. Rewrite the parent page body: use `planPromotion` to construct the
   *      correct `[[code]] text [^blockId]` wikilink lines (Bug #1 fix), then
   *      match bullets by stable `blockId` or text (Bug #3 fix), serialize and
   *      `writePage`.
   *   5. On any failure after files have been written, trash them and re-throw
   *      (rollback — codes are burnt; vault remains consistent).
   *
   * `req.rewrittenBodies` is intentionally ignored — main constructs all rewritten
   * lines itself after codes are reserved, so the renderer can never inject
   * `[[PLACEHOLDER]]` text.
   */
  async promote(req: PromotionRequest): Promise<PromotionResult> {
    const vault = this.requireVault()
    const { targets, parentPage } = req

    // ── 1. Determine skip/promote sets ──────────────────────────────────────
    const toPromote: Array<{ target: typeof targets[number] }> = []
    let skipped = 0
    for (const target of targets) {
      const isAlreadyCoded = target.text.trimStart().startsWith('[[')
      if (isAlreadyCoded) {
        skipped++
        continue
      }
      toPromote.push({ target })
    }

    const n = toPromote.length
    if (n === 0) {
      return { codes: [], skipped, relPaths: [] }
    }

    const createdAbsPaths: string[] = []
    const codes: string[] = []
    const relPaths: string[] = []

    await this.configMutex.acquire()
    try {
      // ── 2. Reserve N codes atomically ─────────────────────────────────────
      const { config: currentConfig } = await loadConfig(vault.rootPath)
      const prefix = currentConfig.codePrefix
      const { config: updatedConfig, codes: reservedCodes } = reserveCodes(currentConfig, prefix, n)
      await saveConfig(vault.rootPath, updatedConfig)
      vault.config = updatedConfig

      // ── 3. Write N new pages ───────────────────────────────────────────────
      // Build rewrite map at the same time (code is known after step 2).
      // Map key: blockId (stable disk key) → rewritten text.
      // The renderer guarantees every target has a blockId (lazily assigned at
      // promotion time — FR-7 / US-005 / text-fallback-collision fix).
      const rewriteByBlockId = new Map<string, string>()

      for (let i = 0; i < n; i++) {
        const { target } = toPromote[i]!
        const code = reservedCodes[i]!
        const title = target.text.trim()
        const childBody = target.childBody ?? ''
        const newBody = childBody
          ? `# ${title}\n\n${childBody}`
          : `# ${title}\n`

        const newRelPath = `${code}.md`
        const newAbsPath = path.join(vault.rootPath, newRelPath)
        // QA Bug #7: refuse to overwrite a pre-existing file with the same code.
        // Codes are monotonic so this is unlikely, but a foreign file named
        // e.g. `TDC-5.md` would be silently clobbered without this guard.
        const targetExists = await fs.access(newAbsPath).then(() => true).catch(() => false)
        if (targetExists) {
          throw new Error(
            `Promote aborted: target file '${newRelPath}' already exists. ` +
              'The code counter is kept bumped; this code is now reserved.',
          )
        }
        const now = new Date().toISOString()

        const newPage: import('@todontic/shared').ParsedPage = {
          relPath: newRelPath,
          filePath: newAbsPath,
          frontmatter: { code, createdAt: now },
          foreignFrontmatter: '',
          todonticFirst: false,
          body: newBody,
          title,
          blockIds: [],
          hadFrontmatter: true,
          eol: '\n',
          trailingNewline: true,
        }

        const serialized = serializePage(newPage)
        // Register self-write BEFORE atomic write.
        vault.watcher.registerSelfWrite(newAbsPath)
        await atomicWrite(newAbsPath, serialized)
        createdAbsPaths.push(newAbsPath)
        vault.pages.set(newRelPath, newPage)
        codes.push(code)
        relPaths.push(newRelPath)

        // Bug #1 fix: main constructs the rewritten line using planPromotion
        // which emits `[[code]] text [^blockId]` — never a placeholder.
        // We synthesize a minimal Bullet object from the target fields so
        // planPromotion can compute the correct blockId suffix.
        const syntheticBullet: import('@todontic/core').Bullet = {
          id: target.bulletId,
          text: title,
          blockId: target.blockId,
          collapsed: false,
          children: [],
        }
        const plan = planPromotion(syntheticBullet, code)
        // rewrittenLine is `- [[code]] text [^blockId]` — strip `- ` prefix
        // to get the bullet text that serializeOutline will re-prepend.
        const rewrittenText = plan.rewrittenLine.startsWith('- ')
          ? plan.rewrittenLine.slice(2)
          : plan.rewrittenLine

        // Text-fallback-collision fix: match exclusively by blockId.
        // The renderer ensures every target has a blockId (assigned lazily if
        // the bullet had none — FR-7).  If blockId is somehow absent, skip
        // the rewrite for this target rather than risk a text collision.
        if (target.blockId) {
          rewriteByBlockId.set(target.blockId, rewrittenText)
        }
      }

      // ── 4. Rewrite parent page ─────────────────────────────────────────────
      // Parse the parent body's outline region from the authoritative page
      // object passed in the request (same snapshot the user sees).
      const region = parseOutline(parentPage.body)

      // Walk bullets and rewrite matched ones.
      // Match exclusively by blockId — the renderer guarantees every promoted
      // target carries a blockId (lazily assigned before the request is sent).
      // This eliminates the text-fallback path that caused duplicate-text
      // siblings to be mis-linked and have their children silently stripped.
      function rewriteBullets(bullets: import('@todontic/core').Bullet[]): import('@todontic/core').Bullet[] {
        return bullets.map((b) => {
          const newText = b.blockId ? rewriteByBlockId.get(b.blockId) : undefined
          if (newText !== undefined) {
            // Children moved to the new page; collapse them here.
            return { ...b, text: newText, children: [] }
          }
          return { ...b, children: rewriteBullets(b.children) }
        })
      }

      const rewrittenRegion = {
        ...region,
        bullets: rewriteBullets(region.bullets),
      }

      const newBody = serializeOutline(rewrittenRegion)
      const rewrittenParent: import('@todontic/shared').ParsedPage = {
        ...parentPage,
        body: newBody,
      }

      // writePage handles atomic write + self-write suppression + index upsert.
      await this.writePage(rewrittenParent)
      rebuildIndex(vault)
    } catch (err) {
      // ── 5. Rollback: trash any files already created ─────────────────────
      for (const absPath of createdAbsPaths) {
        const relPath = path.relative(vault.rootPath, absPath)
        vault.pages.delete(relPath)
        await trashItem(absPath)
      }
      rebuildIndex(vault)
      throw err
    } finally {
      this.configMutex.release()
    }

    // Emit created events so the renderer's wikilink index updates.
    for (const relPath of relPaths) {
      const page = vault.pages.get(relPath)
      if (page) {
        this.emitEvent({ type: 'created', relPath, page })
      }
    }

    return { codes, skipped, relPaths }
  }

  // ─── Index summary ─────────────────────────────────────────────────────────

  /**
   * Return a lightweight index summary for wikilink autocomplete.
   *
   * Extracts only codes + titles + blockId keys from the live in-memory index.
   * Does NOT ship full page content to the renderer.
   */
  getIndexSummary(): IndexSummary {
    const vault = this.requireVault()
    const pages: IndexSummary['pages'] = []
    for (const [, page] of vault.pages) {
      const code = page.frontmatter.code
      if (typeof code === 'string' && code.length > 0) {
        pages.push({ code, title: page.title })
      }
    }
    const blockIdKeys = [...vault.index.blockIds.keys()]
    return { pages, blockIdKeys }
  }

  /**
   * List EVERY page in the vault by its real relative path + title.
   *
   * Unlike {@link getIndexSummary} (coded pages only, for autocomplete), this
   * returns all parsed markdown pages — including plain uncoded notes — so the
   * sidebar can open any file the user owns. Sorted by title (then relPath).
   */
  listPages(): PageSummary[] {
    const vault = this.requireVault()
    const pages: PageSummary[] = []
    for (const [relPath, page] of vault.pages) {
      pages.push({ relPath, title: page.title })
    }
    pages.sort((a, b) => {
      const ka = (a.title ?? a.relPath).toLocaleLowerCase()
      const kb = (b.title ?? b.relPath).toLocaleLowerCase()
      return ka.localeCompare(kb)
    })
    return pages
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
