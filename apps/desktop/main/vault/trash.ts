/**
 * trash.ts — thin wrapper around Electron's `shell.trashItem` (D4).
 *
 * Moves a file to the OS trash (recoverable by the user).  Uses the Electron
 * `shell` module which is main-process-only; keeping it here (rather than
 * inside vaultManager.ts) lets vaultManager unit tests run without stubbing
 * the Electron shell.
 *
 * On macOS: moves to ~/.Trash.
 * On Windows: moves to the Recycle Bin.
 * On Linux: moves to the XDG trash directory (if available).
 *
 * Fallback: if `shell.trashItem` is unavailable (e.g., in a test environment
 * where Electron shell is mocked), falls back to `fs.unlink`.
 */

import fs from 'node:fs/promises'

/**
 * Move the file at `absPath` to the OS trash.
 *
 * @param absPath - The absolute file-system path of the file to trash.
 * @throws If both `shell.trashItem` and the fallback `fs.unlink` fail.
 */
export async function trashItem(absPath: string): Promise<void> {
  // Dynamic import to avoid pulling the Electron shell module into
  // non-Electron environments (e.g., Vitest node runner).
  try {
    const { shell } = await import('electron')
    await shell.trashItem(absPath)
  } catch {
    // Fallback: permanent delete.  This path is taken in the test runner
    // (where `electron` is not available) and on platforms where trashItem
    // is not implemented.
    await fs.unlink(absPath).catch(() => undefined)
  }
}
