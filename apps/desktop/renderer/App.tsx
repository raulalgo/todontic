import { TODONTIC_VERSION } from '@todontic/shared'
import type { ParsedPage, VaultEventPayload } from '@todontic/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Outliner } from './outliner/Outliner'
import { InitializeVaultDialog } from './vault/InitializeVaultDialog'
import { OpenRecent } from './vault/OpenRecent'
import { OpenVault } from './vault/OpenVault'
import { VaultSettings } from './vault/VaultSettings'
import { useVault } from './vault/useVault'

// ─── App screens ──────────────────────────────────────────────────────────────

type Screen = 'home' | 'settings' | 'open'

/** Vault-relative path of the page currently shown in the outliner, or null. */
type ActivePage = string | null

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
  const [activePage, setActivePage] = useState<ActivePage>(null)

  // ── Page list (PRD-01 critical fix: make outliner reachable) ─────────────────
  // A lightweight list of pages visible in the left sidebar so the user can
  // select a page and open it in the Outliner. We load this from the vault index
  // via getIndexSummary (already wired IPC) and keep it live via onVaultEvent.
  const [pageList, setPageList] = useState<Array<{ relPath: string; title: string | null }>>([])
  const pageListLoadedRef = useRef(false)

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

  // ── Load page list when vault opens / refreshes ──────────────────────────────
  // Uses listPages (every page by its real relPath — INCLUDING plain uncoded
  // notes), kept live by the watcher event stream for new/removed pages.
  // NOTE: getIndexSummary is wikilink-only (coded pages, relPath assumed
  // `CODE.md`) — wrong for a sidebar, which must list all files the user owns.
  const refreshPageList = useCallback(async () => {
    const vaultApi = window.todontic?.vault
    if (!vaultApi || !state.rootPath) return
    try {
      const pages = await vaultApi.listPages()
      setPageList(pages)
    } catch {
      // Non-fatal — page list stays as-is.
    }
  }, [state.rootPath])

  // Load page list when vault root changes.
  useEffect(() => {
    if (state.rootPath) {
      pageListLoadedRef.current = false
      void refreshPageList()
    } else {
      setPageList([])
      setActivePage(null)
    }
  }, [state.rootPath, refreshPageList])

  // Keep page list live via vault events (created / unlinked).
  useEffect(() => {
    const vaultApi = window.todontic?.vault
    if (!vaultApi || !state.rootPath) return
    const unsub = vaultApi.onVaultEvent((payload: VaultEventPayload) => {
      if (payload.type === 'created' || payload.type === 'unlinked') {
        void refreshPageList()
      }
    })
    return unsub
  }, [state.rootPath, refreshPageList])

  // ── Native menu command receiver (Bug #4 fix) ────────────────────────────────
  // Wire `vault:menu-open` and `vault:open-recent` channels sent by the native
  // File menu in main/index.ts.  Without this subscription the menu items are
  // silently dead — the channels had no renderer consumer.
  useEffect(() => {
    const menuApi = window.todontic?.onMenuCommand
    if (!menuApi) return
    const unsub = menuApi((payload) => {
      if (payload.command === 'open') {
        // Trigger the same "Open vault…" flow as the renderer button.
        setPendingInitPath(null)
        clearError()
        setScreen('open')
      } else if (payload.command === 'open-recent') {
        // Open the recent vault (same routing as the Open Recent list).
        void handleOpenPath(payload.path)
      }
    })
    return unsub
  }, [clearError, handleOpenPath])

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
    <main style={workspaceStyle}>
      {/* Left sidebar: page list */}
      <aside style={sidebarStyle} data-testid="page-sidebar">
        <div style={sidebarHeaderStyle}>
          <strong style={{ fontSize: '0.8rem', color: '#555' }}>Todontic</strong>
          <span style={{ fontSize: '0.7rem', color: '#aaa', marginLeft: '0.25rem' }}>
            v{TODONTIC_VERSION}
          </span>
        </div>
        <div style={sidebarActionsStyle}>
          <button
            type="button"
            style={sidebarBtnStyle}
            onClick={() => setScreen('open')}
            aria-label="Open a different vault"
            data-testid="open-vault"
          >
            Open vault…
          </button>
          <button
            type="button"
            style={sidebarBtnStyle}
            onClick={() => setScreen('settings')}
            aria-label="Open vault settings"
            data-testid="open-settings"
          >
            Settings
          </button>
        </div>
        <p style={vaultPathStyle} title={rootPath ?? ''}>
          {rootPath}
        </p>
        {error && (
          <p style={errorStyle} role="alert">
            {error}
          </p>
        )}
        <nav aria-label="Pages" style={pageNavStyle}>
          {pageList.length === 0 ? (
            <p style={noPageStyle}>No pages yet.</p>
          ) : (
            <ul style={pageListStyle} role="listbox" aria-label="Vault pages">
              {pageList.map((p) => (
                <li
                  key={p.relPath}
                  role="option"
                  aria-selected={activePage === p.relPath}
                  style={activePage === p.relPath ? activePageItemStyle : pageItemStyle}
                  onClick={() => setActivePage(p.relPath)}
                  data-testid={`page-item-${p.relPath}`}
                >
                  {p.title ?? p.relPath}
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      {/* Right pane: Outliner — primary workspace (PRD-01). */}
      <div style={editorPaneStyle}>
        <Outliner
          relPath={activePage ?? undefined}
          vault={state.rootPath ? window.todontic?.vault : null}
          onNavigate={setActivePage}
        />
      </div>
    </main>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/** Full-screen two-column layout for the workspace (sidebar + editor pane). */
const workspaceStyle: React.CSSProperties = {
  display: 'flex',
  height: '100vh',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1.5,
  overflow: 'hidden',
}

const sidebarStyle: React.CSSProperties = {
  width: '200px',
  minWidth: '160px',
  maxWidth: '260px',
  borderRight: '1px solid #e0e0e0',
  display: 'flex',
  flexDirection: 'column',
  padding: '0.75rem 0.5rem',
  overflow: 'hidden',
  background: '#fafafa',
}

const sidebarHeaderStyle: React.CSSProperties = {
  paddingBottom: '0.5rem',
  borderBottom: '1px solid #eee',
  marginBottom: '0.5rem',
}

const sidebarActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  marginBottom: '0.5rem',
}

const sidebarBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '0.78rem',
  padding: '0.2rem 0.5rem',
  color: '#555',
  textAlign: 'left',
}

const pageNavStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  marginTop: '0.25rem',
}

const pageListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

const pageItemStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  cursor: 'pointer',
  fontSize: '0.82rem',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: '#333',
}

const activePageItemStyle: React.CSSProperties = {
  ...pageItemStyle,
  background: '#e8f0fe',
  color: '#1a73e8',
  fontWeight: 600,
}

const noPageStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#aaa',
  padding: '0.25rem 0.5rem',
  margin: 0,
}

const editorPaneStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

/** Styles for the pre-vault-open and settings/open screens (not the workspace). */
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
  fontSize: '0.75rem',
  color: '#888',
  margin: '0.25rem 0',
  wordBreak: 'break-all',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
