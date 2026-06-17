/**
 * StatusBar — bottom bar showing selection count (US-008).
 *
 * Shown when one or more bullets are selected. Displays "N bullets selected"
 * and offers a quick-clear button.
 */

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Number of selected bullets. */
  count: number
  /** Called when the user clicks "Clear selection". */
  onClear: () => void
}

/**
 * Status bar. Only renders content when `count > 0`.
 */
export function StatusBar({ count, onClear }: Props) {
  if (count === 0) return <div style={emptyStyle} data-testid="status-bar" />

  return (
    <div style={barStyle} data-testid="status-bar">
      <span style={textStyle}>
        {count === 1 ? '1 bullet selected' : `${count} bullets selected`}
      </span>
      <button type="button" style={clearBtnStyle} onClick={onClear}>
        Clear
      </button>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const emptyStyle: React.CSSProperties = { height: '28px' }

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 0.75rem',
  height: '28px',
  background: '#f5f5f5',
  borderTop: '1px solid #e0e0e0',
  fontSize: '0.8rem',
}

const textStyle: React.CSSProperties = {
  color: '#555',
}

const clearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#1a73e8',
  fontSize: '0.8rem',
}
