import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Renderer-process unit tests: React components + hooks under renderer/, run in
// jsdom with @testing-library. Does NOT import electron — IPC is mocked via a
// fake `window.todontic` per test.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'renderer',
    root: __dirname,
    include: ['renderer/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./renderer/test/setup.ts'],
    globals: true,
  },
})
