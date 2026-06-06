import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Honours the vault's layout (apps/desktop/{main,preload,renderer}) rather than
// electron-vite's default src/* convention. Outputs to out/{main,preload,renderer}.
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve(__dirname, 'main/index.ts') },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'preload/index.ts'),
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: 'renderer',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'renderer/index.html') },
    },
  },
})
