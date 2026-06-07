/**
 * useOutlinerDoc — hook unit tests.
 *
 * Uses a fake vault API (no real IPC). BlockNote is never imported here —
 * the hook is pure data-management (R6 mitigation).
 *
 * Approach: we use real timers for initial-load tests and rely on `flushSave`
 * (which bypasses the debounce) for save-path tests, avoiding fake-timer
 * complexity with async state updates in jsdom.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ParsedPage, VaultEventPayload } from '@todontic/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutlinerDocVaultApi } from './useOutlinerDoc'
import { useOutlinerDoc } from './useOutlinerDoc'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePage(body: string, overrides: Partial<ParsedPage> = {}): ParsedPage {
  return {
    relPath: 'test.md',
    filePath: '/vault/test.md',
    frontmatter: {},
    foreignFrontmatter: '',
    todonticFirst: false,
    body,
    title: null,
    blockIds: [],
    hadFrontmatter: false,
    eol: '\n',
    trailingNewline: true,
    ...overrides,
  }
}

type EventCb = (payload: VaultEventPayload) => void

interface TestVault extends OutlinerDocVaultApi {
  writeCalls: ParsedPage[]
  emitEvent: (p: VaultEventPayload) => void
  _readPage: ReturnType<typeof vi.fn>
}

function makeVault(page: ParsedPage | null = null): TestVault {
  const listeners: EventCb[] = []
  const writeCalls: ParsedPage[] = []
  const readPageFn = vi.fn().mockResolvedValue(page)

  return {
    writeCalls,
    _readPage: readPageFn,
    emitEvent: (payload) => {
      for (const cb of listeners) cb(payload)
    },
    readPage: readPageFn,
    writePage: vi.fn().mockImplementation(async (p: ParsedPage) => {
      writeCalls.push(p)
    }),
    onVaultEvent: vi.fn().mockImplementation((cb: EventCb) => {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i !== -1) listeners.splice(i, 1)
      }
    }),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Initial load ──────────────────────────────────────────────────────────────

describe('useOutlinerDoc — initial load', () => {
  it('loads a page and parses bullets', async () => {
    const page = makePage('- alpha\n- beta\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))

    await waitFor(() => expect(result.current.state.loading).toBe(false))

    expect(result.current.state.bullets).toHaveLength(2)
    expect(result.current.state.bullets[0]?.text).toBe('alpha')
    expect(result.current.state.page?.relPath).toBe('test.md')
    expect(result.current.state.dirty).toBe(false)
  })

  it('sets deleted=true when page does not exist', async () => {
    const vault = makeVault(null)
    const { result } = renderHook(() => useOutlinerDoc('missing.md', vault))

    await waitFor(() => expect(result.current.state.loading).toBe(false))
    expect(result.current.state.deleted).toBe(true)
  })

  it('overlays collapsed state from frontmatter', async () => {
    const page = makePage('- item ^abc123\n', {
      hadFrontmatter: true,
      frontmatter: { collapsed: ['abc123'] },
    })
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))

    await waitFor(() => expect(result.current.state.loading).toBe(false))
    expect(result.current.state.bullets[0]?.collapsed).toBe(true)
  })
})

// ─── Save (via flushSave to bypass debounce) ───────────────────────────────────

describe('useOutlinerDoc — save', () => {
  it('writes normalised body on save', async () => {
    const page = makePage('- alpha\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      result.current.updateBullets([
        { id: 'b1', text: 'alpha', collapsed: false, children: [] },
        { id: 'b2', text: 'beta', collapsed: false, children: [] },
      ])
    })

    await act(async () => { await result.current.flushSave() })

    expect(vault.writeCalls).toHaveLength(1)
    const written = vault.writeCalls[0]!
    expect(written.body).toContain('- alpha')
    expect(written.body).toContain('- beta')
  })

  it('clears dirty flag after save', async () => {
    const page = makePage('- alpha\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      result.current.updateBullets([{ id: 'b1', text: 'changed', collapsed: false, children: [] }])
    })
    expect(result.current.state.dirty).toBe(true)

    await act(async () => { await result.current.flushSave() })
    expect(result.current.state.dirty).toBe(false)
  })

  it('debounce: multiple updateBullets → only one write after flush', async () => {
    const page = makePage('- alpha\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    const newBullets = [{ id: 'b1', text: 'changed', collapsed: false, children: [] }]
    act(() => {
      result.current.updateBullets(newBullets)
      result.current.updateBullets(newBullets)
      result.current.updateBullets(newBullets)
    })

    await act(async () => { await result.current.flushSave() })
    expect(vault.writeCalls).toHaveLength(1)
  })
})

// ─── Watcher reconciliation ───────────────────────────────────────────────────

describe('useOutlinerDoc — watcher reconciliation', () => {
  it('hot-reloads when file changes externally and doc is clean', async () => {
    const page = makePage('- original\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    // Prepare next read to return updated content.
    const newPage = makePage('- updated\n')
    vault._readPage.mockResolvedValue(newPage)

    act(() => {
      vault.emitEvent({ type: 'changed', relPath: 'test.md', page: newPage })
    })

    await waitFor(() => expect(result.current.state.bullets[0]?.text).toBe('updated'))
    expect(result.current.state.conflict).toBe(false)
  })

  it('shows conflict banner when file changes externally and doc is dirty', async () => {
    const page = makePage('- original\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    // Make the doc dirty.
    act(() => {
      result.current.updateBullets([{ id: 'b1', text: 'local change', collapsed: false, children: [] }])
    })

    // External change arrives while dirty.
    act(() => {
      vault.emitEvent({ type: 'changed', relPath: 'test.md', page: makePage('- external\n') })
    })

    await waitFor(() => expect(result.current.state.conflict).toBe(true))
  })

  it('shows deleted banner when file is unlinked externally', async () => {
    const page = makePage('- item\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      vault.emitEvent({ type: 'unlinked', relPath: 'test.md' })
    })

    await waitFor(() => expect(result.current.state.deleted).toBe(true))
  })

  it('keepMine dismisses the conflict banner without reloading', async () => {
    const page = makePage('- original\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      result.current.updateBullets([{ id: 'b1', text: 'mine', collapsed: false, children: [] }])
    })
    act(() => {
      vault.emitEvent({ type: 'changed', relPath: 'test.md', page: makePage('- external\n') })
    })
    await waitFor(() => expect(result.current.state.conflict).toBe(true))

    const readCallCount = vault._readPage.mock.calls.length
    act(() => { result.current.keepMine() })
    expect(result.current.state.conflict).toBe(false)
    // No extra readPage call — we kept ours.
    expect(vault._readPage.mock.calls.length).toBe(readCallCount)
  })

  it('reloadFromDisk reloads the file and clears dirty+conflict', async () => {
    const page = makePage('- original\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      result.current.updateBullets([{ id: 'b1', text: 'mine', collapsed: false, children: [] }])
    })
    act(() => {
      vault.emitEvent({ type: 'changed', relPath: 'test.md', page })
    })
    await waitFor(() => expect(result.current.state.conflict).toBe(true))

    const reloadedPage = makePage('- reloaded\n')
    vault._readPage.mockResolvedValue(reloadedPage)

    act(() => { result.current.reloadFromDisk() })
    await waitFor(() => expect(result.current.state.bullets[0]?.text).toBe('reloaded'))
    expect(result.current.state.conflict).toBe(false)
    expect(result.current.state.dirty).toBe(false)
  })

  it('ignores watcher events for other pages', async () => {
    const page = makePage('- item\n')
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      vault.emitEvent({ type: 'changed', relPath: 'other.md', page: makePage('- other\n') })
    })

    expect(result.current.state.conflict).toBe(false)
    expect(result.current.state.bullets[0]?.text).toBe('item')
  })
})

// ─── Collapsed state persistence ──────────────────────────────────────────────

describe('useOutlinerDoc — collapsed state persistence', () => {
  it('writes collapsed IDs to frontmatter on save', async () => {
    const page = makePage('- item ^abc123\n', { hadFrontmatter: true, frontmatter: {} })
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      result.current.updateBullets([{
        id: 'b1', text: 'item', blockId: 'abc123', collapsed: true, children: [],
      }])
    })
    await act(async () => { await result.current.flushSave() })

    expect(vault.writeCalls).toHaveLength(1)
    expect(vault.writeCalls[0]!.frontmatter.collapsed).toContain('abc123')
  })

  it('omits collapsed key when no bullets are collapsed', async () => {
    const page = makePage('- item ^abc123\n', { hadFrontmatter: true, frontmatter: {} })
    const vault = makeVault(page)
    const { result } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    act(() => {
      result.current.updateBullets([{
        id: 'b1', text: 'item', blockId: 'abc123', collapsed: false, children: [],
      }])
    })
    await act(async () => { await result.current.flushSave() })

    expect(vault.writeCalls[0]!.frontmatter.collapsed).toBeUndefined()
  })
})

// ─── Debounce flush on unmount (QA Bug #2 / gap #6) ──────────────────────────
//
// Edits within the 200ms debounce window before unmount must be persisted.
// The cleanup effect must flush any pending save — not just clear the timer.

describe('useOutlinerDoc — flush on unmount', () => {
  it('flushes pending save when unmounted within the debounce window', async () => {
    const page = makePage('- original\n')
    const vault = makeVault(page)
    const { result, unmount } = renderHook(() => useOutlinerDoc('test.md', vault))
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    // Make a dirty edit (starts the 200ms debounce timer).
    act(() => {
      result.current.updateBullets([{ id: 'b1', text: 'edited before unmount', collapsed: false, children: [] }])
    })

    // The debounce timer has NOT fired yet (we haven't advanced fake timers;
    // we rely on the flush in the cleanup effect).
    expect(vault.writeCalls).toHaveLength(0)

    // Unmount within the debounce window — cleanup should flush the save.
    await act(async () => {
      unmount()
    })

    // writePage must have been called exactly once with the edited content.
    expect(vault.writeCalls).toHaveLength(1)
    expect(vault.writeCalls[0]!.body).toContain('edited before unmount')
  })
})
