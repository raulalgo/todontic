import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * Playwright configuration for the Todontic desktop e2e suite.
 *
 * Uses electron-vite's production build (`out/main/index.js`) as the Electron
 * entry point.  Run with:
 *   `pnpm --filter @todontic/desktop test:e2e`
 *
 * The `TODONTIC_TEST_VAULT` environment variable (honoured by `main/index.ts`)
 * lets tests bypass the native folder picker by injecting a pre-created temp
 * vault path.
 */
export default defineConfig({
  testDir: resolve(__dirname, 'e2e'),
  testMatch: '**/*.spec.ts',
  // Headed mode off in CI; flip to true locally for debugging.
  use: {
    headless: false,
  },
  // Single project: Electron (not a browser).
  projects: [
    {
      name: 'electron',
    },
  ],
  // One retry in CI to handle slow Electron startup timing.
  retries: process.env.CI ? 1 : 0,
  // Allow ample time for Electron to launch and build the vault.
  timeout: 30_000,
  reporter: [['list']],
})
