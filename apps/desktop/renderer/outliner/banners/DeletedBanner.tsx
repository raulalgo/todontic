/**
 * DeletedBanner — non-modal notification shown when the open file was deleted
 * externally (US-003 / FR-3).
 */

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Non-modal deleted-file banner.
 *
 * Appears when the watcher detects the open page was unlinked from disk.
 * No action is offered — the user must close or navigate away.
 */
export function DeletedBanner() {
  return (
    <div style={bannerStyle} role="alert" data-testid="deleted-banner">
      <span style={textStyle}>
        This file was deleted externally. Changes cannot be saved.
      </span>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: '#fbe9e7',
  borderBottom: '1px solid #ef9a9a',
  padding: '0.4rem 0.75rem',
  fontSize: '0.85rem',
}

const textStyle: React.CSSProperties = {
  color: '#7f0000',
}
