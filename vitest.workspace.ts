import { defineWorkspace } from 'vitest/config'

// Two test projects:
//  - node:     pure-TS packages + main-process FS modules (vitest.config.ts).
//  - renderer: React renderer components, jsdom + @testing-library
//              (apps/desktop/vitest.renderer.config.ts).
// Electron-importing main modules (watcher, ipc, recentVaults) stay in the
// Playwright e2e suite — neither project here imports `electron`.
export default defineWorkspace(['./vitest.config.ts', './apps/desktop/vitest.renderer.config.ts'])
