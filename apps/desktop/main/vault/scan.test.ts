import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanVault } from './scan.js'

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'todontic-scan-'))
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

describe('scanVault', () => {
  it('finds nested .md files', async () => {
    tmpDir = await makeTmpDir()
    await fs.mkdir(path.join(tmpDir, 'sub'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'root.md'), '# Root')
    await fs.writeFile(path.join(tmpDir, 'sub', 'nested.md'), '# Nested')

    const files = await scanVault(tmpDir)
    const relPaths = files.map((f) => f.relPath).sort()
    expect(relPaths).toContain('root.md')
    expect(relPaths).toContain('sub/nested.md')
  })

  it('excludes .todontic/ directory', async () => {
    tmpDir = await makeTmpDir()
    await fs.mkdir(path.join(tmpDir, '.todontic'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.todontic', 'hidden.md'), '# Hidden')
    await fs.writeFile(path.join(tmpDir, 'visible.md'), '# Visible')

    const files = await scanVault(tmpDir)
    expect(files.map((f) => f.relPath)).not.toContain('.todontic/hidden.md')
    expect(files.map((f) => f.relPath)).toContain('visible.md')
  })

  it('excludes .git/ directory', async () => {
    tmpDir = await makeTmpDir()
    await fs.mkdir(path.join(tmpDir, '.git'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.git', 'COMMIT_EDITMSG'), 'commit')
    await fs.writeFile(path.join(tmpDir, 'page.md'), '# Page')

    const files = await scanVault(tmpDir)
    expect(files.map((f) => f.relPath)).not.toContain('.git/COMMIT_EDITMSG')
    expect(files.map((f) => f.relPath)).toContain('page.md')
  })

  it('ignores non-.md files', async () => {
    tmpDir = await makeTmpDir()
    await fs.writeFile(path.join(tmpDir, 'readme.txt'), 'text')
    await fs.writeFile(path.join(tmpDir, 'image.png'), 'binary')
    await fs.writeFile(path.join(tmpDir, 'note.md'), '# Note')

    const files = await scanVault(tmpDir)
    expect(files.map((f) => f.relPath)).toEqual(['note.md'])
  })

  it('returns empty array for an empty directory', async () => {
    tmpDir = await makeTmpDir()
    const files = await scanVault(tmpDir)
    expect(files).toHaveLength(0)
  })

  it('returns raw content matching disk bytes', async () => {
    tmpDir = await makeTmpDir()
    const content = '---\ntodontic:\n  code: TDC-1\n---\n# Hello\n'
    await fs.writeFile(path.join(tmpDir, 'p.md'), content)
    const files = await scanVault(tmpDir)
    expect(files[0]?.raw).toBe(content)
  })
})
