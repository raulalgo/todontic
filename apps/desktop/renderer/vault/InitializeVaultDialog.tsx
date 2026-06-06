// ─── Types ────────────────────────────────────────────────────────────────────

interface InitializeVaultDialogProps {
  /** The folder the user selected that is not yet a vault. */
  folderPath: string
  /** Called with the rootPath when the user confirms initialisation. */
  onConfirm: (rootPath: string) => void
  /** Called when the user cancels and wants to pick a different folder. */
  onCancel: () => void
  /** True while the init operation is in progress. */
  busy?: boolean
  /** Error message to display below the actions. */
  error?: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dialog-style prompt asking the user whether to initialise a plain folder as
 * a Todontic vault.
 *
 * Shown by `OpenVault` when the selected folder has no `.todontic/config.yml`.
 * On confirm: calls `vault.init(path)` then `vault.open(path)`.
 * On cancel: returns to the folder-picker state.
 */
export function InitializeVaultDialog({
  folderPath,
  onConfirm,
  onCancel,
  busy = false,
  error = null,
}: InitializeVaultDialogProps) {
  return (
    <div style={containerStyle}>
      <h2 style={{ margin: '0 0 0.5rem' }}>Initialize vault here?</h2>
      <p style={descStyle}>
        The folder below is not yet a Todontic vault. Initializing it will create a{' '}
        <code>.todontic/</code> directory with a default config file. Your existing files will not
        be modified.
      </p>
      <p style={pathStyle}>{folderPath}</p>

      <div style={actionsStyle}>
        <button
          type="button"
          onClick={() => onConfirm(folderPath)}
          disabled={busy}
          style={{ ...btnStyle, background: '#1a73e8', color: '#fff', border: 'none' }}
        >
          {busy ? 'Initializing…' : 'Initialize vault'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={btnStyle}>
          Cancel
        </button>
      </div>

      {error && <p style={errorStyle}>{error}</p>}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  maxWidth: '480px',
  padding: '1.5rem',
  border: '1px solid #ddd',
  borderRadius: '8px',
  background: '#fafafa',
}

const descStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  color: '#444',
  margin: '0 0 0.75rem',
  lineHeight: 1.5,
}

const pathStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.85rem',
  background: '#eee',
  padding: '0.35rem 0.6rem',
  borderRadius: '4px',
  wordBreak: 'break-all',
  margin: '0 0 1rem',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.75rem',
}

const btnStyle: React.CSSProperties = {
  padding: '0.45rem 1.1rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  borderRadius: '6px',
  border: '1px solid #aaa',
  background: '#f0f0f0',
}

const errorStyle: React.CSSProperties = {
  color: '#c00',
  fontSize: '0.85rem',
  marginTop: '0.75rem',
}
