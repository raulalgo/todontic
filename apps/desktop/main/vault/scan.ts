/**
 * Recursive vault scanner.
 *
 * Walks a directory tree looking for `.md` files, skipping hidden/tool
 * directories that should never be treated as user content.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/** Directories that are never scanned for user markdown files. */
const EXCLUDED_DIRS = new Set(['.todontic', '.git', 'node_modules'])

/** Represents a raw markdown file found in the vault. */
export interface RawFile {
  /** Vault-relative path (forward-slash separators). */
  relPath: string
  /** Absolute path on disk. */
  absPath: string
  /** UTF-8 content of the file. */
  raw: string
}

/**
 * Recursively scan `rootPath` for `.md` files, excluding `.todontic/`,
 * `.git/`, and `node_modules/` directories.
 *
 * Files are read as UTF-8 strings (preserving raw bytes / line endings).
 * Returns an empty array for an empty or non-existent directory.
 *
 * @param rootPath - Absolute path to the vault root.
 */
export async function scanVault(rootPath: string): Promise<RawFile[]> {
  const results: RawFile[] = []
  await walk(rootPath, rootPath, results)
  return results
}

async function walk(rootPath: string, dir: string, results: RawFile[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as import('node:fs').Dirent[]
  } catch {
    // Directory does not exist or is unreadable — treat as empty.
    return
  }

  for (const entry of entries) {
    const entryName = String(entry.name)
    const absPath = path.join(dir, entryName)

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entryName)) {
        await walk(rootPath, absPath, results)
      }
      continue
    }

    if (entry.isFile() && entryName.endsWith('.md')) {
      let raw: string
      try {
        raw = await fs.readFile(absPath, 'utf-8')
      } catch {
        // Unreadable file — skip silently.
        continue
      }

      // Vault-relative path with forward slashes.
      const relPath = path.relative(rootPath, absPath).split(path.sep).join('/')
      results.push({ relPath, absPath, raw })
    }
  }
}
