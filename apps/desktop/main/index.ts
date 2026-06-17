import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, dialog } from 'electron'
import { registerVaultIpc } from './ipc.js'
import { getLastVault, listRecent } from './vault/recentVaults.js'

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

/**
 * Build and set the native application menu (US-007 gap assessment).
 *
 * The renderer already has "Open vault…" and "Recent vaults" buttons, so these
 * menu items complement — not replace — the renderer UI. They send a message to
 * the renderer to trigger the vault picker or navigate to a recent vault.
 */
async function buildAppMenu(): Promise<void> {
  const recent = await listRecent()

  const recentSubmenu: Electron.MenuItemConstructorOptions[] =
    recent.length > 0
      ? recent.map((r) => ({
          label: r.path,
          click: () => {
            mainWindow?.webContents.send('vault:open-recent', r.path)
          },
        }))
      : [{ label: 'No recent vaults', enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (name is replaced by the OS with the app name).
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open vault…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.send('vault:menu-open')
          },
        },
        {
          label: 'Recent vaults',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        process.platform === 'darwin'
          ? { role: 'close' as const }
          : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(async () => {
  // Register vault IPC handlers.  `vaultManager` is returned so we can attempt
  // the last-vault auto-reopen once the window has loaded (US-001).
  const vaultManager = registerVaultIpc(() => mainWindow)

  createWindow()

  // Build native application menu (US-007).
  await buildAppMenu()

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
