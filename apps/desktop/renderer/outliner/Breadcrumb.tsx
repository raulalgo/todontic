/**
 * Breadcrumb — ancestor chain for the current zoom level (US-009 / Slice 7).
 *
 * Renders "Root → Ancestor → … → Current" where each crumb is clickable to
 * zoom back up to that level. "Root" is always the page title or file name.
 *
 * Only shown when zoomed into a bullet (`zoomedBlockId !== null`).
 */

import type { BreadcrumbItem } from './useZoom'

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** The page title or filename (always the first crumb). */
  pageTitle: string
  /** The ancestor chain returned by `useZoom.state.breadcrumb`. */
  breadcrumb: BreadcrumbItem[]
  /** Called when the user clicks a crumb to zoom there (null = page root). */
  onNavigate: (blockId: string | null) => void
}

/**
 * Zoom breadcrumb trail.
 *
 * Renders as: `[Page title] > [ancestor] > [current]`.
 * Clicking a crumb calls `onNavigate` with its block ID (or null for root).
 */
export function Breadcrumb({ pageTitle, breadcrumb, onNavigate }: Props) {
  if (breadcrumb.length === 0) return null

  return (
    <nav style={navStyle} aria-label="Zoom breadcrumb" data-testid="breadcrumb">
      {/* Page root crumb */}
      <button
        type="button"
        style={crumbBtnStyle}
        onClick={() => onNavigate(null)}
        aria-label="Go to page root"
      >
        {pageTitle}
      </button>

      {/* Ancestor crumbs (all except the last, which is the current view) */}
      {breadcrumb.slice(0, -1).map((item, idx) => (
        <span key={item.blockId ?? idx} style={crumbGroupStyle}>
          <span style={separatorStyle}>›</span>
          <button
            type="button"
            style={crumbBtnStyle}
            onClick={() => onNavigate(item.blockId)}
            aria-label={`Go to ${item.text}`}
          >
            {item.text}
          </button>
        </span>
      ))}

      {/* Current zoom level (non-clickable) */}
      {breadcrumb.length > 0 && (
        <span style={crumbGroupStyle}>
          <span style={separatorStyle}>›</span>
          <span style={currentCrumbStyle} aria-current="page">
            {breadcrumb[breadcrumb.length - 1]?.text}
          </span>
        </span>
      )}
    </nav>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const navStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0',
  padding: '0.25rem 0.75rem',
  fontSize: '0.8rem',
  borderBottom: '1px solid #e0e0e0',
  background: '#fafafa',
}

const crumbGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
}

const crumbBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#1a73e8',
  fontSize: '0.8rem',
  padding: '0.1rem 0.2rem',
}

const separatorStyle: React.CSSProperties = {
  color: '#999',
  padding: '0 0.2rem',
}

const currentCrumbStyle: React.CSSProperties = {
  color: '#333',
  fontWeight: 500,
  padding: '0.1rem 0.2rem',
}
