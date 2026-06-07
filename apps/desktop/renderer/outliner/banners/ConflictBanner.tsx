/**
 * ConflictBanner — non-modal notification shown when the open file was changed
 * externally while the user has unsaved edits (US-003 / FR-3).
 *
 * The user can keep their local changes or reload from disk.
 */

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user chooses to keep their local edits. */
  onKeepMine: () => void
  /** Called when the user chooses to reload from disk. */
  onReload: () => void
}

/**
 * Non-modal conflict banner.
 *
 * Appears at the top of the editor when the open file was changed externally
 * while there are unsaved local edits. Offers two actions: keep mine or reload.
 */
export function ConflictBanner({ onKeepMine, onReload }: Props) {
  return (
    <div style={bannerStyle} role="alert" data-testid="conflict-banner">
      <span style={textStyle}>File changed on disk</span>
      <div style={actionsStyle}>
        <button type="button" style={keepBtnStyle} onClick={onKeepMine}>
          Keep mine
        </button>
        <button type="button" style={reloadBtnStyle} onClick={onReload}>
          Reload
        </button>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: '#fff8e1',
  borderBottom: '1px solid #ffe082',
  padding: '0.4rem 0.75rem',
  fontSize: '0.85rem',
}

const textStyle: React.CSSProperties = {
  color: '#7a5800',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
}

const keepBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #ccc',
  borderRadius: '4px',
  padding: '0.2rem 0.6rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
}

const reloadBtnStyle: React.CSSProperties = {
  background: '#1a73e8',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  padding: '0.2rem 0.6rem',
  cursor: 'pointer',
  fontSize: '0.8rem',
}
