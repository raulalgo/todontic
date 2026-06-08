/**
 * Sidebar navigation e2e — regression for the "sidebar stops switching after
 * an in-app navigation" bug.
 *
 * Root cause: useNavigation reads its initial entry only once; once any in-app
 * navigation (promote / wikilink / zoom / back-forward) set navState.current,
 * the Outliner ignored the initialRelPath prop that the sidebar drives, so
 * clicking other files did nothing. Plain switching (no in-app nav) masked it.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type ElectronApplication, _electron as electron } from 'playwright'

const MAIN_JS = join(import.meta.dirname ?? __dirname, '../out/main/index.js')

async function preInitVault(rootPath: string): Promise<void> {
  const d = join(rootPath, '.todontic')
  await mkdir(join(d, 'runs'), { recursive: true })
  await mkdir(join(d, 'cache'), { recursive: true })
  await writeFile(
    join(d, 'config.yml'),
    'codePrefix: TDC\nstatuses:\n  - todo\n  - done\nattachmentsPath: attachments\ncodePrefixes:\n  TDC:\n    next: 1\n',
    'utf-8',
  )
}

test.describe('sidebar navigation', () => {
  test('sidebar still switches pages after an in-app navigation (promote)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'todontic-sidebar-nav-'))
    await preInitVault(dir)
    await writeFile(join(dir, 'alpha.md'), '# Alpha\n\n- alpha bullet\n', 'utf-8')
    await writeFile(join(dir, 'beta.md'), '# Beta\n\n- beta bullet\n', 'utf-8')

    let app: ElectronApplication
    let win: Awaited<ReturnType<ElectronApplication['firstWindow']>>
    try {
      app = await electron.launch({
        args: [MAIN_JS],
        env: { ...process.env, TODONTIC_TEST_VAULT: dir, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      })
      win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
    } catch (err) {
      test.skip(true, `Electron could not launch: ${String(err)}`)
      return
    }

    // A runaway prop⇄state sync loop surfaces as React's "Maximum update depth
    // exceeded" pageerror — fail hard if any error fires during the journey.
    const pageErrors: string[] = []
    win.on('pageerror', (e) => pageErrors.push(String(e)))

    // Helper: assert the open page is the given one AND stays put (no oscillation
    // back to the previous page) over a short window.
    async function expectStableOpenPage(relPath: string) {
      const outliner = win.getByTestId('outliner')
      await expect(outliner).toHaveAttribute('aria-label', `Outliner: ${relPath}`, { timeout: 5000 })
      // Sample several times — an oscillating loop flips the label between pages.
      for (let i = 0; i < 6; i++) {
        await win.waitForTimeout(120)
        expect(await outliner.getAttribute('aria-label')).toBe(`Outliner: ${relPath}`)
      }
    }

    try {
      await win.getByText(dir).waitFor({ timeout: 15_000 })

      // Open alpha and promote its bullet (Cmd/Ctrl-Enter) — this is the in-app
      // navigation that previously poisoned navState and broke the sidebar.
      await win.getByTestId('page-item-alpha.md').click()
      await expectStableOpenPage('alpha.md')

      const editable = win.locator('.bn-editor [contenteditable="true"], .ProseMirror').first()
      await editable.click()
      const promote = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'
      await win.keyboard.press(promote)

      // After promote the view navigates to the new page (TDC-1.md) and it
      // appears in the sidebar — and must stay there (no sync oscillation).
      await expectStableOpenPage('TDC-1.md')
      await expect(win.getByTestId('page-item-TDC-1.md')).toBeVisible({ timeout: 5000 })

      // THE REGRESSION: click beta in the sidebar — it must switch AND stay put,
      // not flip back to the previously-open (promoted) page.
      await win.getByTestId('page-item-beta.md').click()
      await expectStableOpenPage('beta.md')
      await expect(editable).toContainText('beta bullet', { timeout: 5000 })

      // And back to alpha, to be sure the sidebar is fully alive and stable.
      await win.getByTestId('page-item-alpha.md').click()
      await expectStableOpenPage('alpha.md')

      expect(pageErrors, `page errors during journey:\n${pageErrors.join('\n')}`).toEqual([])
    } finally {
      await app.close()
    }
  })
})
