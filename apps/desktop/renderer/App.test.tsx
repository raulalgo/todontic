import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecentVault, VaultApi, VaultConfig } from '@todontic/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

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
    ...overrides,
  }
}

function installVault(vault: VaultApi): void {
  window.todontic = {
    versions: { node: '0', chrome: '0', electron: '0' },
    vault,
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

    expect(await screen.findByText(/vault is open/i)).toBeInTheDocument()
    expect(screen.getByText('/vaults/existing')).toBeInTheDocument()
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
    expect(await screen.findByText(/vault is open/i)).toBeInTheDocument()
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
