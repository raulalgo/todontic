import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWrite } from './atomicWrite.js'

let tmpDir: string

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'todontic-test-'))
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

describe('atomicWrite', () => {
  it('writes a new file with the given content', async () => {
    tmpDir = await makeTmpDir()
    const target = path.join(tmpDir, 'new.txt')
    await atomicWrite(target, 'hello world')
    const read = await fs.readFile(target, 'utf-8')
    expect(read).toBe('hello world')
  })

  it('overwrites an existing file', async () => {
    tmpDir = await makeTmpDir()
    const target = path.join(tmpDir, 'existing.txt')
    await fs.writeFile(target, 'original')
    await atomicWrite(target, 'updated')
    const read = await fs.readFile(target, 'utf-8')
    expect(read).toBe('updated')
  })

  it('does not leave a .tmp file behind', async () => {
    tmpDir = await makeTmpDir()
    const target = path.join(tmpDir, 'clean.txt')
    await atomicWrite(target, 'content')
    const entries = await fs.readdir(tmpDir)
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
  })

  it('content is byte-identical to input (no EOL mangling)', async () => {
    tmpDir = await makeTmpDir()
    const content = 'line1\r\nline2\r\n'
    const target = path.join(tmpDir, 'crlf.txt')
    await atomicWrite(target, content)
    const read = await fs.readFile(target, 'utf-8')
    expect(read).toBe(content)
  })

  it('creates parent directory if it does not exist', async () => {
    tmpDir = await makeTmpDir()
    const nested = path.join(tmpDir, 'a', 'b', 'c.txt')
    await atomicWrite(nested, 'nested')
    const read = await fs.readFile(nested, 'utf-8')
    expect(read).toBe('nested')
  })
})
