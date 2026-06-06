import type { RecentVault } from '@todontic/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OpenRecentProps {
  /** Last 5 recently-opened vaults, newest first. */
  recent: RecentVault[]
  /** Called when the user clicks a recent vault entry. */
  onOpen: (rootPath: string) => void
  /** True while an open operation is in flight. */
  loading?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * "Open Recent" list showing up to 5 previously-opened vaults.
 *
 * Each entry opens the vault on click.  Renders nothing when the list is empty.
 */
export function OpenRecent({ recent, onOpen, loading = false }: OpenRecentProps) {
  if (recent.length === 0) return null

  return (
    <div style={containerStyle}>
      <h3 style={headingStyle}>Recent vaults</h3>
      <ul style={listStyle}>
        {recent.map((v) => (
          <li key={v.path} style={itemStyle}>
            <button
              type="button"
              style={btnStyle}
              disabled={loading}
              onClick={() => onOpen(v.path)}
              title={v.path}
            >
              <span style={pathStyle}>{v.path}</span>
              <span style={dateStyle}>{formatDate(v.lastOpened)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  marginTop: '1.5rem',
}

const headingStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '0.85rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#888',
  fontWeight: 600,
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
}

const itemStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
}

const btnStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.45rem 0.6rem',
  background: 'none',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  textAlign: 'left',
  gap: '1rem',
}

const pathStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.82rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: '1 1 0',
  minWidth: 0,
}

const dateStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#999',
  whiteSpace: 'nowrap',
  flexShrink: 0,
}
