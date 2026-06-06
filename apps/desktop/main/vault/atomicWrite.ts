/**
 * Atomic file write using a tmp-file + fsync + rename strategy.
 *
 * Guarantees (FR-4):
 * - On POSIX systems, `fs.rename` over an existing file is atomic at the
 *   filesystem level (same volume), so a concurrent reader always sees either
 *   the old or the new content, never a partial write.
 * - `fs.fsync` flushes kernel buffers to disk before the rename, protecting
 *   against data loss on unexpected process termination.
 * - No `.tmp` file is left behind on success or on write failure (the temp
 *   file is removed in the error path).
 *
 * Line-ending preservation (FR-5): the `contents` string is written as-is
 * (UTF-8 without BOM).  The core `serializePage` layer is responsible for
 * preserving the original EOL style — this function does not re-format.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Write `contents` to `absPath` atomically.
 *
 * The write goes to `<dir>/<file>.<rand>.tmp` first, then is renamed over the
 * target.  If any step fails the temp file is cleaned up and the error is
 * re-thrown; the original file (if any) is left untouched.
 *
 * @param absPath - Absolute path of the target file.
 * @param contents - UTF-8 string to write.
 */
export async function atomicWrite(absPath: string, contents: string): Promise<void> {
  const dir = path.dirname(absPath)
  const rand = randomBytes(6).toString('hex')
  const tmpPath = path.join(dir, `${path.basename(absPath)}.${rand}.tmp`)

  let fd: fs.FileHandle | null = null
  try {
    // Ensure the directory exists.
    await fs.mkdir(dir, { recursive: true })

    fd = await fs.open(tmpPath, 'w')
    await fd.writeFile(contents, 'utf-8')
    await fd.sync()
    await fd.close()
    fd = null

    await fs.rename(tmpPath, absPath)
  } catch (err) {
    if (fd) {
      try {
        await fd.close()
      } catch {
        // Ignore close errors during error path.
      }
    }
    // Best-effort cleanup of the temp file.
    try {
      await fs.unlink(tmpPath)
    } catch {
      // Ignore — the file may not have been created yet.
    }
    throw err
  }
}
