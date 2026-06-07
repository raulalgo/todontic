/**
 * PromoteDialog — confirmation dialog for bulk promotion (US-010, Slice 10).
 *
 * Shown when the user tries to promote more than 10 bullets at once.
 * The user must explicitly confirm: "Promote N bullets…? [Promote][Cancel]".
 * There is no "don't ask again" (Design §6).
 *
 * Rendered as a modal overlay. Uses a simple HTML dialog pattern (no Mantine
 * Modal) to avoid adding dependencies.
 */

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Number of bullets to be promoted (shown in the message). */
  count: number
  /** Number of bullets that will be skipped (already coded). */
  skipped?: number
  /** Called when the user confirms the bulk promotion. */
  onConfirm: () => void
  /** Called when the user cancels. */
  onCancel: () => void
}

/**
 * Bulk-promote confirmation dialog.
 *
 * Only rendered when `count > BULK_THRESHOLD` (caller decides when to show it).
 */
export function PromoteDialog({ count, skipped = 0, onConfirm, onCancel }: Props) {
  const toPromote = count - skipped

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Confirm bulk promotion">
      <div style={dialogStyle}>
        <h2 style={titleStyle}>Promote {count} bullets?</h2>
        <p style={bodyStyle}>
          This will create {toPromote} new page{toPromote !== 1 ? 's' : ''}
          {skipped > 0 ? ` (${skipped} already promoted, skipped)` : ''}.
          This action can be undone by navigating to each new page and deleting it.
        </p>
        <div style={actionsStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            style={confirmBtnStyle}
            onClick={onConfirm}
            data-testid="promote-dialog-confirm"
          >
            Promote {toPromote} bullet{toPromote !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Threshold above which the PromoteDialog is shown (US-010). */
export const BULK_PROMOTE_THRESHOLD = 10

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  maxWidth: '420px',
  width: '90vw',
  boxShadow: '0 4px 24px rgba(0,0,0,0.16)',
}

const titleStyle: React.CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.1rem',
  fontWeight: 600,
}

const bodyStyle: React.CSSProperties = {
  margin: '0 0 1.25rem',
  fontSize: '0.9rem',
  color: '#444',
  lineHeight: 1.5,
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '0.75rem',
}

const cancelBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #bbb',
  borderRadius: '6px',
  padding: '0.4rem 1rem',
  cursor: 'pointer',
  fontSize: '0.9rem',
}

const confirmBtnStyle: React.CSSProperties = {
  background: '#1a73e8',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  padding: '0.4rem 1rem',
  cursor: 'pointer',
  fontSize: '0.9rem',
  fontWeight: 500,
}
