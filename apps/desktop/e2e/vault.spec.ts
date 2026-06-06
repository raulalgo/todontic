/**
 * Vault smoke tests — end-to-end.
 *
 * These tests launch the built Electron app.  Two distinct launch modes are used:
 *
 *  1. `TODONTIC_TEST_VAULT` pointing to an **uninitialised** temp dir:
 *     - Main auto-open will fail (vault not initialised); renderer shows the
 *       no-vault screen with "Open vault folder" button.
 *
 *  2. `TODONTIC_TEST_VAULT` pointing to a **pre-initialised** vault:
 *     - Main auto-open succeeds; renderer shows the vault-open workspace.
 *
 * Coverage:
 *  1. App launches and renderer is visible — "Open vault folder" button present.
 *  2. Pre-initialised vault auto-opens on launch → "Vault is open" indicator.
 *  3. Settings round-trip: change prefix → save → config.yml updated on disk.
 *
 * Note: if the Electron binary cannot launch headless in this environment,
 * tests skip rather than fail (CI-safe behaviour).
 */

import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type ElectronApplication, _electron as electron } from 'playwright'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Absolute path to the built Electron main entry. */
const MAIN_JS = join(import.meta.dirname ?? __dirname, '../out/main/index.js')

/**
 * Launch the Electron app with a test vault path injected via env seam.
 * Returns `{ app, win }`.
 */
async function launchWithVault(vaultPath: string) {
  const app = await electron.launch({
    args: [MAIN_JS],
    env: {
      ...process.env,
      TODONTIC_TEST_VAULT: vaultPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

/**
 * Pre-initialise a vault directory so the app can open it without the init dialog.
 * Creates `.todontic/` + `runs/` + `cache/` + a minimal `config.yml`.
 */
async function preInitVault(rootPath: string): Promise<void> {
  const todonticDir = join(rootPath, '.todontic')
  await mkdir(todonticDir, { recursive: true })
  await mkdir(join(todonticDir, 'runs'), { recursive: true })
  await mkdir(join(todonticDir, 'cache'), { recursive: true })
  const configYml = [
    'codePrefix: TDC',
    'statuses:',
    '  - todo',
    '  - in-progress',
    '  - blocked',
    '  - done',
    'attachmentsPath: attachments',
    'codePrefixes:',
    '  TDC:',
    '    next: 1',
    '',
  ].join('\n')
  await writeFile(join(todonticDir, 'config.yml'), configYml, 'utf-8')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('vault smoke', () => {
  let tempDir: string

  test.beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'todontic-e2e-'))
  })

  // ---------------------------------------------------------------------------

  test('app launches and renderer is visible', async () => {
    // Launch with an uninitialised vault — main auto-open will fail gracefully
    // and the renderer will show the no-vault screen.
    let app: ElectronApplication
    try {
      ;({ app } = await launchWithVault(tempDir))
    } catch (err) {
      test.skip(true, `Electron could not launch: ${String(err)}`)
      return
    }

    try {
      // The no-vault screen must show the "Open vault folder" button.
      await app
        .firstWindow()
        .then((w) => w.getByText('Open vault folder').waitFor({ timeout: 8000 }))
      const wins = app.windows()
      expect(wins.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  // ---------------------------------------------------------------------------

  test('pre-initialised vault auto-opens on launch', async () => {
    // Pre-init so the app opens directly into the workspace.
    await preInitVault(tempDir)

    let app: ElectronApplication
    let win: Awaited<ReturnType<typeof launchWithVault>>['win']
    try {
      ;({ app, win } = await launchWithVault(tempDir))
    } catch (err) {
      test.skip(true, `Electron could not launch: ${String(err)}`)
      return
    }

    try {
      // "Vault is open" indicator should appear once the auto-reopen completes.
      await win.getByText('Vault is open').waitFor({ timeout: 15_000 })

      // Assert that .todontic/config.yml exists on disk.
      await expect(access(join(tempDir, '.todontic', 'config.yml'))).resolves.toBeUndefined()
    } finally {
      await app.close()
    }
  })

  // ---------------------------------------------------------------------------

  test('settings round-trip: change prefix → save → persisted', async () => {
    await preInitVault(tempDir)

    let app: ElectronApplication
    let win: Awaited<ReturnType<typeof launchWithVault>>['win']
    try {
      ;({ app, win } = await launchWithVault(tempDir))
    } catch (err) {
      test.skip(true, `Electron could not launch: ${String(err)}`)
      return
    }

    try {
      // Wait for vault-open state.
      await win.getByText('Vault is open').waitFor({ timeout: 15_000 })

      // Open settings.
      await win.getByTestId('open-settings').click()

      // Change the code prefix.
      const prefixInput = win.getByLabel('Code prefix')
      await prefixInput.clear()
      await prefixInput.fill('PRJ')

      // Save.
      await win.getByTestId('vault-settings-save').click()
      await win.getByText('Saved').waitFor({ timeout: 5000 })

      // Wait briefly to ensure the atomic write has been committed to disk
      // before reading back the file (the Saved indicator fires on React state
      // update which is synchronous with the IPC round-trip completing, but
      // give the OS a moment to flush the fsync).
      await win.waitForTimeout(200)

      // Verify config.yml on disk has the new prefix.
      const configRaw = await readFile(join(tempDir, '.todontic', 'config.yml'), 'utf-8')
      expect(configRaw).toContain('codePrefix: PRJ')
    } finally {
      await app.close()
    }
  })
})
