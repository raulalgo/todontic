/**
 * Chokidar-based vault file watcher.
 *
 * Watches the vault root for `.md` file changes and emits typed events so the
 * vault manager can keep the in-memory index current.
 *
 * Self-write suppression: when the main process writes a file (via
 * `vaultManager.writePage`), a chokidar `change` event fires for that path.
 * We suppress these by recording recently-written absolute paths in a short-
 * lived set (with a TTL of `SELF_WRITE_TTL_MS`).  Events arriving within the
 * window for a registered path are treated as self-writes (index already
 * current) rather than external edits.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { parsePage } from '@todontic/core'
import type { ParsedPage } from '@todontic/shared'
import chokidar, { type FSWatcher } from 'chokidar'

/** How long (ms) a self-written path stays in the suppression set. */
const SELF_WRITE_TTL_MS = 2000

// ─── Types ────────────────────────────────────────────────────────────────────

export type WatcherEvent =
  | { type: 'added'; relPath: string; page: ParsedPage }
  | { type: 'changed'; relPath: string; page: ParsedPage }
  | { type: 'unlinked'; relPath: string }

export type WatcherCallback = (event: WatcherEvent) => void

// ─── VaultWatcher class ───────────────────────────────────────────────────────

/**
 * Wraps a chokidar `FSWatcher` for a single vault directory.
 *
 * Lifecycle: create → `start()` → use → `stop()`.
 */
export class VaultWatcher {
  private readonly rootPath: string
  private readonly onEvent: WatcherCallback
  private watcher: FSWatcher | null = null
  /** Recently-written absolute paths → expiry timestamp. */
  private readonly selfWrites = new Map<string, number>()

  constructor(rootPath: string, onEvent: WatcherCallback) {
    this.rootPath = rootPath
    this.onEvent = onEvent
  }

  /** Register `absPath` as a self-write to suppress the next chokidar event. */
  registerSelfWrite(absPath: string): void {
    this.selfWrites.set(absPath, Date.now() + SELF_WRITE_TTL_MS)
  }

  private isSelfWrite(absPath: string): boolean {
    const expiry = this.selfWrites.get(absPath)
    if (expiry === undefined) return false
    if (Date.now() < expiry) return true
    this.selfWrites.delete(absPath)
    return false
  }

  /** Start watching. Safe to call once. */
  start(): void {
    if (this.watcher) return

    this.watcher = chokidar.watch(this.rootPath, {
      ignored: [
        // Ignore .todontic and .git dirs entirely.
        /(^|[/\\])\.(todontic|git)([\\/]|$)/,
        '**/node_modules/**',
      ],
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      persistent: true,
    })

    this.watcher
      .on('add', (filePath: string) => void this.handleAddChange(filePath, 'added'))
      .on('change', (filePath: string) => void this.handleAddChange(filePath, 'changed'))
      .on('unlink', (filePath: string) => this.handleUnlink(filePath))
  }

  /** Stop watching and release resources. */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  private async handleAddChange(absPath: string, type: 'added' | 'changed'): Promise<void> {
    if (!absPath.endsWith('.md')) return
    if (this.isSelfWrite(absPath)) return

    let raw: string
    try {
      raw = await fs.readFile(absPath, 'utf-8')
    } catch {
      return // File disappeared between event and read — ignore.
    }

    const relPath = path.relative(this.rootPath, absPath).split(path.sep).join('/')
    const page = parsePage(raw, relPath, absPath)
    this.onEvent({ type, relPath, page })
  }

  private handleUnlink(absPath: string): void {
    if (!absPath.endsWith('.md')) return
    if (this.isSelfWrite(absPath)) return
    const relPath = path.relative(this.rootPath, absPath).split(path.sep).join('/')
    this.onEvent({ type: 'unlinked', relPath })
  }
}
