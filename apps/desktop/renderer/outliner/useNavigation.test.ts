import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NavEntry } from './useNavigation'
import { useNavigation } from './useNavigation'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function entry(relPath: string, zoomBlockId?: string): NavEntry {
  return { relPath, zoomBlockId }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useNavigation — initial state', () => {
  it('starts with null current if no initialEntry', () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.state.current).toBeNull()
    expect(result.current.state.canGoBack).toBe(false)
    expect(result.current.state.canGoForward).toBe(false)
  })

  it('starts with the given initialEntry as current', () => {
    const { result } = renderHook(() => useNavigation(entry('home.md')))
    expect(result.current.state.current?.relPath).toBe('home.md')
    expect(result.current.state.canGoBack).toBe(false)
  })
})

describe('useNavigation — navigateTo', () => {
  it('pushes a new entry and updates current', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('b.md')) })
    expect(result.current.state.current?.relPath).toBe('b.md')
  })

  it('enables canGoBack after push', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('b.md')) })
    expect(result.current.state.canGoBack).toBe(true)
    expect(result.current.state.canGoForward).toBe(false)
  })

  it('truncates forward history on new branch', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('b.md')) })
    act(() => { result.current.navigateTo(entry('c.md')) })
    act(() => { result.current.goBack() })
    act(() => { result.current.goBack() })
    // Now at a.md with b.md and c.md in forward history.
    act(() => { result.current.navigateTo(entry('d.md')) })
    // Forward history truncated — only d.md is ahead.
    expect(result.current.state.canGoForward).toBe(false)
    expect(result.current.state.current?.relPath).toBe('d.md')
  })

  it('does not add duplicate consecutive entry', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('a.md')) })
    // Still at a.md, no back history.
    expect(result.current.state.canGoBack).toBe(false)
  })

  it('records zoom entries (with zoomBlockId)', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('a.md', 'abc123')) })
    expect(result.current.state.current?.zoomBlockId).toBe('abc123')
  })
})

describe('useNavigation — back / forward', () => {
  it('goBack moves to previous entry', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('b.md')) })
    act(() => { result.current.goBack() })
    expect(result.current.state.current?.relPath).toBe('a.md')
  })

  it('goForward moves to next entry', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('b.md')) })
    act(() => { result.current.goBack() })
    act(() => { result.current.goForward() })
    expect(result.current.state.current?.relPath).toBe('b.md')
  })

  it('goBack is no-op at start of stack', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.goBack() })
    expect(result.current.state.current?.relPath).toBe('a.md')
  })

  it('goForward is no-op at end of stack', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.goForward() })
    expect(result.current.state.current?.relPath).toBe('a.md')
  })

  it('canGoBack and canGoForward update correctly after back', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('b.md')) })
    act(() => { result.current.navigateTo(entry('c.md')) })
    act(() => { result.current.goBack() })
    expect(result.current.state.canGoBack).toBe(true)
    expect(result.current.state.canGoForward).toBe(true)
    act(() => { result.current.goBack() })
    expect(result.current.state.canGoBack).toBe(false)
    expect(result.current.state.canGoForward).toBe(true)
  })
})

describe('useNavigation — zoom entries', () => {
  it('zoom entry differs from page entry (different zoomBlockId)', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('a.md', 'abc123')) })
    // Should be a new stack entry.
    expect(result.current.state.canGoBack).toBe(true)
    expect(result.current.state.current?.zoomBlockId).toBe('abc123')
  })

  it('going back from zoom returns to page root', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.navigateTo(entry('a.md', 'abc123')) })
    act(() => { result.current.goBack() })
    expect(result.current.state.current?.zoomBlockId).toBeUndefined()
    expect(result.current.state.current?.relPath).toBe('a.md')
  })
})

describe('useNavigation — replaceCurrent', () => {
  it('replaces current entry without adding to stack', () => {
    const { result } = renderHook(() => useNavigation(entry('a.md')))
    act(() => { result.current.replaceCurrent(entry('a.md', 'abc123')) })
    expect(result.current.state.current?.zoomBlockId).toBe('abc123')
    expect(result.current.state.canGoBack).toBe(false)
  })
})
