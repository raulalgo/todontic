import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecentVault, VaultApi, VaultConfig } from '@todontic/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// ─── BlockNote mock (required when App renders the workspace and mounts Outliner) ─
// The same mock pattern as Outliner.test.tsx — BlockNote does not run in jsdom.
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ onChange }: { editor: unknown; onChange?: () => void }) => (
    <div data-testid="blocknote-editor" onClick={onChange} />
  ),
}))
vi.mock('@blocknote/mantine/style.css', () => ({}))
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: () => ({
    document: [],
    getTextCursorPosition: () => ({ block: null }),
    replaceBlocks: vi.fn(),
    updateBlock: vi.fn(),
  }),
}))

// ─── Fake VaultApi ──────────────────────────────────────────────────────────────

const sampleConfig = (codePrefix = 'TDC'): VaultConfig => ({
  codePrefix,
  statuses: ['todo', 'in-progress', 'blocked', 'done'],
  attachmentsPath: 'attachments',
  codePrefixes: { [codePrefix]: { next: 1 } },
})

/**
 * Build a fake `VaultApi` of vi.fn()s with safe defaults. Override per test.
 * Mirrors the contract the preload bridge implements.
 */
function makeVault(overrides: Partial<VaultApi> = {}): VaultApi {
  return {
    pickFolder: vi.fn().mockResolvedValue(null),
    isInitialised: vi.fn().mockResolvedValue(false),
    open: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    listRecent: vi.fn().mockResolvedValue([] as RecentVault[]),
    readPage: vi.fn().mockResolvedValue(null),
    writePage: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(sampleConfig()),
    setConfig: vi.fn().mockResolvedValue(undefined),
    reserveCodes: vi.fn().mockResolvedValue([]),
    onVaultEvent: vi.fn().mockReturnValue(() => {}),
    getIndexSummary: vi.fn().mockResolvedValue({ pages: [], blockIdKeys: [] }),
    listPages: vi.fn().mockResolvedValue([]),
    deletePage: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue({ codes: [], skipped: 0, relPaths: [] }),
    ...overrides,
  }
}

function installVault(vault: VaultApi): void {
  window.todontic = {
    versions: { node: '0', chrome: '0', electron: '0' },
    vault,
    // No-op menu listener — tests drive the menu via direct UI interaction.
    onMenuCommand: () => () => {},
  }
}

afterEach(() => {
  window.todontic = undefined
})

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('App — no vault open', () => {
  it('shows the vault chooser', async () => {
    installVault(makeVault())
    render(<App />)
    expect(await screen.findByRole('button', { name: /open vault folder/i })).toBeInTheDocument()
  })
})

describe('App — open flow routing', () => {
  it('opens an initialised folder straight into the workspace', async () => {
    const vault = makeVault({
      pickFolder: vi.fn().mockResolvedValue('/vaults/existing'),
      isInitialised: vi.fn().mockResolvedValue(true),
      getConfig: vi.fn().mockResolvedValue(sampleConfig()),
    })
    installVault(vault)
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: /open vault folder/i }))

    // Vault workspace is shown (path is visible and Outliner is mounted).
    expect(await screen.findByText('/vaults/existing')).toBeInTheDocument()
    expect(screen.getByTestId('open-vault')).toBeInTheDocument()
    expect(vault.open).toHaveBeenCalledWith('/vaults/existing')
    expect(vault.init).not.toHaveBeenCalled()
  })

  it('routes an uninitialised folder to the Initialize prompt, then initialises', async () => {
    const vault = makeVault({
      pickFolder: vi.fn().mockResolvedValue('/vaults/blank'),
      isInitialised: vi.fn().mockResolvedValue(false),
    })
    installVault(vault)
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: /open vault folder/i }))

    expect(await screen.findByText(/initialize vault here\?/i)).toBeInTheDocument()
    expect(screen.getByText('/vaults/blank')).toBeInTheDocument()
    expect(vault.open).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Initialize vault' }))

    await waitFor(() => expect(vault.init).toHaveBeenCalledWith('/vaults/blank'))
    // Vault workspace is shown after init.
    expect(await screen.findByTestId('open-vault')).toBeInTheDocument()
  })

  // Regression: a recent vault whose `.todontic/` was removed used to call
  // open() directly and fail silently. It must now route to the Initialize prompt.
  it('routes a no-longer-initialised recent vault to the Initialize prompt', async () => {
    const recent: RecentVault[] = [{ path: '/vaults/gone', lastOpened: new Date().toISOString() }]
    const vault = makeVault({
      listRecent: vi.fn().mockResolvedValue(recent),
      isInitialised: vi.fn().mockResolvedValue(false),
    })
    installVault(vault)
    render(<App />)

    const recentBtn = await screen.findByTitle('/vaults/gone')
    await userEvent.click(recentBtn)

    expect(await screen.findByText(/initialize vault here\?/i)).toBeInTheDocument()
    expect(vault.open).not.toHaveBeenCalled()
  })
})

describe('App — switch vault while one is open', () => {
  it('reaches the chooser via "Open vault…" and opens a different vault', async () => {
    const vault = makeVault({
      // Auto-hydrate as if vault A is already open (startup getState).
      getState: vi.fn().mockResolvedValue({ rootPath: '/vaults/a', config: sampleConfig() }),
      isInitialised: vi.fn().mockResolvedValue(true),
      pickFolder: vi.fn().mockResolvedValue('/vaults/b'),
      getConfig: vi.fn().mockResolvedValue(sampleConfig('PRJ')),
    })
    installVault(vault)
    render(<App />)

    // Workspace for vault A is shown.
    expect(await screen.findByText('/vaults/a')).toBeInTheDocument()

    // Open the switch-vault screen.
    await userEvent.click(screen.getByTestId('open-vault'))
    expect(await screen.findByText(/open a different vault/i)).toBeInTheDocument()

    // Pick + open vault B.
    await userEvent.click(screen.getByRole('button', { name: /open vault folder/i }))

    expect(await screen.findByText('/vaults/b')).toBeInTheDocument()
    expect(vault.open).toHaveBeenCalledWith('/vaults/b')
  })
})

// ─── Coverage gap #1: App sidebar → Outliner page open ──────────────────────
//
// Proves the headline PRD-01 fix: selecting a page in the sidebar passes
// `relPath` to the Outliner, which calls `vault.readPage` with that path.
//
// REGRESSION GUARD: an earlier version sourced the sidebar from getIndexSummary
// (coded pages only) and derived relPath as `${code}.md`. A real vault of plain,
// UNCODED notes therefore showed "No pages yet" and no file could be opened. The
// sidebar now uses listPages (every page by its real on-disk relPath). These
// tests deliberately use uncoded notes so that bug cannot return.

describe('App — sidebar → Outliner page open (PRD-01 reachability)', () => {
  it('lists plain UNCODED notes and opens one in the Outliner', async () => {
    const vault = makeVault({
      // Start with a vault already open so the workspace renders immediately.
      getState: vi.fn().mockResolvedValue({ rootPath: '/vaults/test', config: sampleConfig() }),
      // A real vault of uncoded markdown notes — NONE have a todontic code.
      // (getIndexSummary would return [] for these; the sidebar must not rely on it.)
      listPages: vi.fn().mockResolvedValue([
        { relPath: 'sample-note-1.md', title: 'Sample Note One' },
        { relPath: 'sample-note-2.md', title: null },
      ]),
      readPage: vi.fn().mockResolvedValue(null),
    })
    installVault(vault)
    render(<App />)

    // Wait for the workspace to hydrate (vault path is visible in the sidebar).
    await waitFor(() => expect(screen.getByText('/vaults/test')).toBeInTheDocument())

    // Both uncoded notes must appear — including the one with no title (falls
    // back to its relPath).
    const titled = await screen.findByTestId('page-item-sample-note-1.md')
    expect(titled).toHaveTextContent('Sample Note One')
    const untitled = await screen.findByTestId('page-item-sample-note-2.md')
    expect(untitled).toHaveTextContent('sample-note-2.md')

    // Clicking opens it — Outliner gets the REAL relPath, not a `${code}.md` guess.
    await userEvent.click(titled)
    await waitFor(() => {
      expect(vault.readPage).toHaveBeenCalledWith('sample-note-1.md')
    })
    await waitFor(() => {
      expect(screen.getByTestId('outliner')).toHaveAttribute(
        'aria-label',
        'Outliner: sample-note-1.md',
      )
    })
  })

  it('does not derive the sidebar from getIndexSummary (coded pages only)', async () => {
    // If listPages returns the user's notes, getIndexSummary must be irrelevant
    // to the list — even when it is empty (the common case for a fresh vault of
    // plain notes). This pins the regression: sidebar membership = listPages.
    const vault = makeVault({
      getState: vi.fn().mockResolvedValue({ rootPath: '/vaults/test', config: sampleConfig() }),
      getIndexSummary: vi.fn().mockResolvedValue({ pages: [], blockIdKeys: [] }),
      listPages: vi.fn().mockResolvedValue([{ relPath: 'notes.md', title: 'Notes' }]),
    })
    installVault(vault)
    render(<App />)

    await waitFor(() => expect(screen.getByText('/vaults/test')).toBeInTheDocument())
    expect(await screen.findByTestId('page-item-notes.md')).toHaveTextContent('Notes')
    expect(vault.listPages).toHaveBeenCalled()
  })
})
