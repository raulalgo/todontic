import { defineConfig } from 'vitest/config'

// Root unit-test runner. Covers pure-TS packages (core, agents, mcp-installer,
// skills, shared) AND main-process FS modules that do not import Electron.
// The desktop app's e2e tests run via Playwright, not here.
export default defineConfig({
  test: {
    include: [
      'packages/**/*.{test,spec}.ts',
      // Main-process FS modules (atomicWrite, scan, configStore,
      // codeCounterStore) have pure-Node tests that run here. Modules that
      // import `electron` (watcher, recentVaults, ipc) are excluded — they are
      // covered by the Playwright e2e suite instead.
      'apps/desktop/main/vault/atomicWrite.test.ts',
      'apps/desktop/main/vault/scan.test.ts',
      'apps/desktop/main/vault/configStore.test.ts',
      'apps/desktop/main/vault/codeCounterStore.test.ts',
      // VaultManager integration: open/reserve/setConfig interactions.
      // vaultManager.ts depends on watcher.ts (chokidar), but NOT on electron,
      // so the test runs safely in the vitest node environment.
      'apps/desktop/main/vault/vaultManager.test.ts',
      // Watcher self-write suppression: pure in-memory logic (no chokidar.watch
      // call; watcher.start() is never called). Runs safely in node environment.
      'apps/desktop/main/vault/watcher.test.ts',
      // recentVaults: uses a tmp file path instead of app.getPath — safe in node.
      'apps/desktop/main/vault/recentVaults.test.ts',
    ],
    environment: 'node',
  },
})
