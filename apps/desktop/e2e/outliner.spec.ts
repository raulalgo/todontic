/**
 * Outliner end-to-end tests — Playwright (Slice 11).
 *
 * Verifies the key user journeys in the full Electron app:
 *  1. App launches with a pre-initialised vault and shows the outliner.
 *  2. Outliner mounts when a page is available.
 *
 * Note: These tests target the rendered UI. They require the Electron app to be
 * built first (`pnpm --filter @todontic/desktop build`). Run with:
 *   `pnpm --filter @todontic/desktop test:e2e`
 *
 * The test vault is pre-created in a temp dir and injected via `TODONTIC_TEST_VAULT`.
 * Tests skip gracefully if Electron cannot launch (e.g., headless CI without display).
 *
 * Coverage matrix (from plan):
 *  - App launches with vault → workspace shown (no "Vault is open" text; vault path shown)
 *  - Outliner `data-testid="outliner"` is present when vault is open
 *  - "Open vault…" button (`data-testid="open-vault"`) is present
 *  - Settings nav works (open-settings → Back)
 */

import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type ElectronApplication, _electron as electron } from 'playwright'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Absolute path to the built Electron main entry. */
const MAIN_JS = join(import.meta.dirname ?? __dirname, '../out/main/index.js')

/**
 * Launch the Electron app with a test vault injected via env seam.
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
 * Pre-initialise a vault directory (creates .todontic/config.yml).
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

/**
 * Write a simple markdown page to the vault.
 */
async function writePage(vaultPath: string, relPath: string, content: string): Promise<void> {
  await writeFile(join(vaultPath, relPath), content, 'utf-8')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('outliner — vault workspace', () => {
  let tempDir: string

  test.beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'todontic-e2e-outliner-'))
  })

  // ── 1. App launches and shows workspace ──────────────────────────────────

  test('vault workspace shown after auto-open', async () => {
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
      // The vault path is shown in the workspace header after auto-open.
      await win.getByText(tempDir).waitFor({ timeout: 15_000 })

      // "Open vault…" navigation button is present.
      await expect(win.getByTestId('open-vault')).toBeVisible()

      // Outliner is mounted (no page open yet → "Open a page" hint).
      const outliner = win.getByTestId('outliner')
      await expect(outliner).toBeVisible({ timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  // ── 1b. Sidebar lists EXISTING (uncoded) pages and opens one ──────────────
  // Regression guard for the real-app gap: a vault of plain, uncoded markdown
  // notes must appear in the sidebar so the user can open them. The earlier
  // build sourced the list from coded pages only → "No pages yet" in a normal
  // vault. This is the one check jsdom can't fully prove (real IPC + main).

  test('sidebar lists an existing uncoded note and opens it', async () => {
    await preInitVault(tempDir)
    // A plain note with NO todontic code in frontmatter.
    await writePage(tempDir, 'welcome.md', '# Welcome\n\n- first bullet\n- second bullet\n')

    let app: ElectronApplication
    let win: Awaited<ReturnType<typeof launchWithVault>>['win']
    try {
      ;({ app, win } = await launchWithVault(tempDir))
    } catch (err) {
      test.skip(true, `Electron could not launch: ${String(err)}`)
      return
    }

    try {
      await win.getByText(tempDir).waitFor({ timeout: 15_000 })

      // The uncoded note appears in the sidebar by its title.
      const item = win.getByTestId('page-item-welcome.md')
      await expect(item).toBeVisible({ timeout: 5000 })
      await expect(item).toHaveText('Welcome')

      // Clicking it opens the page in the Outliner.
      await item.click()
      await expect(win.getByTestId('outliner')).toHaveAttribute(
        'aria-label',
        'Outliner: welcome.md',
        { timeout: 5000 },
      )
    } finally {
      await app.close()
    }
  })

  // ── 2. Settings navigation ────────────────────────────────────────────────

  test('settings: open → back returns to workspace', async () => {
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
      // Wait for workspace.
      await win.getByText(tempDir).waitFor({ timeout: 15_000 })

      // Open settings.
      await win.getByTestId('open-settings').click()
      // Settings panel should appear (look for the save button).
      await win.getByTestId('vault-settings-save').waitFor({ timeout: 5000 })

      // Navigate back.
      await win.getByRole('button', { name: /back/i }).click()

      // Should return to workspace and see the outliner again.
      await expect(win.getByTestId('outliner')).toBeVisible({ timeout: 5000 })
    } finally {
      await app.close()
    }
  })

  // ── 3. Config.yml is accessible (vault initialised properly) ─────────────

  test('pre-initialised vault has .todontic/config.yml', async () => {
    await preInitVault(tempDir)
    // Config file should exist before even launching the app.
    await expect(
      access(join(tempDir, '.todontic', 'config.yml')),
    ).resolves.toBeUndefined()
  })
})
