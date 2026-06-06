import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app } from 'electron'
import { registerVaultIpc } from './ipc.js'
import { getLastVault } from './vault/recentVaults.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** Reference to the main window; null before creation or after destruction. */
let mainWindow: BrowserWindow | null = null

/**
 * Create the main window. Per PRD-08 the default surface is a narrow, dockable
 * vertical panel; for the scaffold we open a plain resizable window.
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 900,
    show: false,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(resolve(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Register vault IPC handlers.  `vaultManager` is returned so we can attempt
  // the last-vault auto-reopen once the window has loaded (US-001).
  const vaultManager = registerVaultIpc(() => mainWindow)

  createWindow()

  // Attempt to auto-reopen the last vault once the renderer has loaded.
  // `TODONTIC_TEST_VAULT` env var allows e2e tests to bypass the native dialog
  // and inject a pre-made vault path directly.
  const testVault = process.env.TODONTIC_TEST_VAULT
  const lastVault = testVault ?? (await getLastVault())

  if (lastVault) {
    // Wait for the window to finish loading before opening the vault so the
    // renderer is ready to receive the `vault:event` notifications.
    mainWindow?.webContents.once('did-finish-load', () => {
      vaultManager
        .open(lastVault)
        .then(() => {
          // Notify the renderer that a vault was auto-opened (US-001).
          // The renderer's useVault hook listens to `vault:event` and will
          // hydrate its state on receiving the `opened` payload.
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('vault:event', { type: 'opened', rootPath: lastVault })
          }
        })
        .catch((err: unknown) => {
          console.error('[main] auto-reopen failed:', err)
        })
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
