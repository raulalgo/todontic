import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenVaultProps {
  /** Show the native folder picker; returns the chosen path or null. */
  pickFolder: () => Promise<string | null>
  /**
   * Called with the chosen folder path. The caller decides whether to open it
   * or route to the initialise prompt (see `App.handleOpenPath`).
   */
  onPick: (rootPath: string) => void
  /** True while an open/init operation is in flight. */
  loading?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * "Open vault folder" button.
 *
 * Shows the OS folder picker and hands the chosen path to `onPick`. It does not
 * decide between open vs. initialise — that routing lives in `App` so it can be
 * shared by both this button and the Open-Recent list.
 */
export function OpenVault({ pickFolder, onPick, loading = false }: OpenVaultProps) {
  const [busy, setBusy] = useState(false)

  const handlePick = async () => {
    setBusy(true)
    try {
      const path = await pickFolder()
      if (path) onPick(path)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handlePick()}
      disabled={busy || loading}
      style={btnStyle}
    >
      {busy ? 'Opening…' : 'Open vault folder'}
    </button>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  fontSize: '0.95rem',
  cursor: 'pointer',
  borderRadius: '6px',
  border: '1px solid #999',
  background: '#f5f5f5',
}
