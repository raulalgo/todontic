import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Unmount React trees and reset jsdom between tests.
afterEach(() => {
  cleanup()
})

// ─── jsdom shims ──────────────────────────────────────────────────────────────

// Mantine and BlockNote call window.matchMedia on mount; jsdom does not implement it.
// Provide a minimal stub that satisfies the media-query API.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// BlockNote's drag-handle plugin calls document.elementsFromPoint which jsdom
// does not implement. Provide a no-op stub so mouse events in tests do not throw.
if (!document.elementsFromPoint) {
  document.elementsFromPoint = () => []
}
