import { TODONTIC_VERSION } from '@todontic/shared'
import { useCallback, useState } from 'react'
import { InitializeVaultDialog } from './vault/InitializeVaultDialog'
import { OpenRecent } from './vault/OpenRecent'
import { OpenVault } from './vault/OpenVault'
import { VaultSettings } from './vault/VaultSettings'
import { useVault } from './vault/useVault'

// ─── App screens ──────────────────────────────────────────────────────────────

type Screen = 'home' | 'settings' | 'open'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * Routes between:
 *  - **No vault open** — the vault chooser (Open folder + Open Recent).
 *  - **Vault open / home** — workspace placeholder + Open-vault + Settings entries.
 *  - **Vault open / open** — the chooser again, to switch to a different vault.
 *  - **Vault open / settings** — the Settings → Vault editor.
 *
 * Open vs. initialise routing is centralised here in `handleOpenPath` so both
 * the folder picker and the Open-Recent list use it — a recent vault whose
 * `.todontic/` was removed routes to the initialise prompt instead of erroring.
 *
 * The outliner / detail view will replace the home placeholder in PRD-01.
 */
export function App() {
  const { state, openVault, initVault, pickFolder, isInitialised, saveConfig, clearError } =
    useVault()
  const [screen, setScreen] = useState<Screen>('home')

  // A folder the user chose that is not yet a vault — drives the init prompt.
  const [pendingInitPath, setPendingInitPath] = useState<string | null>(null)
  const [initBusy, setInitBusy] = useState(false)

  const { rootPath, config, recent, loading, error } = state

  // ── Open/init routing (shared by folder picker + Open Recent) ────────────────

  /**
   * Route a chosen folder: open it if it's an initialised vault, otherwise show
   * the initialise prompt. On a successful open, return to the home screen.
   */
  const handleOpenPath = useCallback(
    async (path: string) => {
      clearError()
      setPendingInitPath(null)
      if (await isInitialised(path)) {
        const ok = await openVault(path)
        if (ok) setScreen('home')
      } else {
        setPendingInitPath(path)
      }
    },
    [isInitialised, openVault, clearError],
  )

  const handleInitConfirm = useCallback(
    async (path: string) => {
      setInitBusy(true)
      try {
        const ok = await initVault(path)
        if (ok) {
          setPendingInitPath(null)
          setScreen('home')
        }
      } finally {
        setInitBusy(false)
      }
    },
    [initVault],
  )

  const handleInitCancel = useCallback(() => setPendingInitPath(null), [])

  // ── Reusable vault chooser ───────────────────────────────────────────────────

  const chooser = (
    <>
      {pendingInitPath ? (
        <InitializeVaultDialog
          folderPath={pendingInitPath}
          onConfirm={(p) => void handleInitConfirm(p)}
          onCancel={handleInitCancel}
          busy={initBusy}
          error={error}
        />
      ) : (
        <>
          <OpenVault
            pickFolder={pickFolder}
            onPick={(p) => void handleOpenPath(p)}
            loading={loading}
          />
          <OpenRecent recent={recent} onOpen={(p) => void handleOpenPath(p)} loading={loading} />
          {error && (
            <p style={errorStyle} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </>
  )

  // ── No vault open ────────────────────────────────────────────────────────────

  if (!rootPath) {
    return (
      <main style={mainStyle}>
        <header style={headerStyle}>
          <h1 style={h1Style}>Todontic</h1>
          <p style={subStyle}>v{TODONTIC_VERSION}</p>
        </header>
        {chooser}
      </main>
    )
  }

  // ── Vault open — switch-vault (open) screen ──────────────────────────────────

  if (screen === 'open') {
    return (
      <main style={mainStyle}>
        <nav style={navStyle}>
          <button
            type="button"
            style={backBtnStyle}
            onClick={() => {
              setPendingInitPath(null)
              clearError()
              setScreen('home')
            }}
          >
            ← Back
          </button>
        </nav>
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>Open a different vault</h2>
        {chooser}
      </main>
    )
  }

  // ── Vault open — Settings screen ─────────────────────────────────────────────

  if (screen === 'settings' && config) {
    return (
      <main style={mainStyle}>
        <nav style={navStyle}>
          <button type="button" style={backBtnStyle} onClick={() => setScreen('home')}>
            ← Back
          </button>
        </nav>
        <VaultSettings config={config} onSave={saveConfig} />
      </main>
    )
  }

  // ── Vault open — Home / workspace placeholder ────────────────────────────────

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={h1Style}>Todontic</h1>
            <p style={subStyle}>v{TODONTIC_VERSION}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              style={settingsBtnStyle}
              onClick={() => setScreen('open')}
              aria-label="Open a different vault"
              data-testid="open-vault"
            >
              Open vault…
            </button>
            <button
              type="button"
              style={settingsBtnStyle}
              onClick={() => setScreen('settings')}
              aria-label="Open vault settings"
              data-testid="open-settings"
            >
              Settings
            </button>
          </div>
        </div>
        <p style={vaultPathStyle}>{rootPath}</p>
      </header>

      <p style={{ color: '#666', fontSize: '0.9rem' }}>
        Vault is open. The outliner lands in PRD-01.
      </p>

      {error && (
        <p style={errorStyle} role="alert">
          {error}
        </p>
      )}
    </main>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const mainStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  padding: '2rem',
  lineHeight: 1.5,
  maxWidth: '520px',
  margin: '0 auto',
}

const headerStyle: React.CSSProperties = {
  marginBottom: '1.5rem',
}

const h1Style: React.CSSProperties = {
  margin: '0 0 0.15rem',
  fontSize: '1.5rem',
}

const subStyle: React.CSSProperties = {
  color: '#888',
  marginTop: 0,
  fontSize: '0.85rem',
}

const vaultPathStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  color: '#666',
  marginTop: '0.25rem',
  wordBreak: 'break-all',
}

const navStyle: React.CSSProperties = {
  marginBottom: '1.25rem',
}

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.9rem',
  color: '#1a73e8',
  padding: '0.25rem 0',
}

const settingsBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #bbb',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.85rem',
  padding: '0.3rem 0.8rem',
  color: '#555',
}

const errorStyle: React.CSSProperties = {
  color: '#c00',
  fontSize: '0.85rem',
  marginTop: '0.75rem',
}
