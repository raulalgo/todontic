/**
 * WikilinkMenu — autocomplete palette for `[[` wikilink insertion (US-004).
 *
 * Renders a linear command-palette-style list. Opened when the user types `[[`
 * in the editor; each entry inserts the wikilink and closes the menu.
 *
 * Slice 5: functional autocomplete UI. Wired into BlockNote in Outliner.tsx
 * once the full editor integration is done. For now this component can be
 * rendered standalone and is fully testable with RTL.
 */

import { useEffect, useRef, useState } from 'react'
import type { IndexSummary } from '@todontic/shared'
import { filterAutocomplete } from './wikilinkResolve'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** The text the user has typed after `[[`. */
  query: string
  /** Live index summary from `vault.getIndexSummary()`. */
  summary: IndexSummary
  /** Called when the user selects an entry. */
  onSelect: (code: string) => void
  /** Called when the user dismisses the menu (Esc). */
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wikilink autocomplete menu.
 *
 * Keyboard: ArrowUp/Down to move selection, Enter to confirm, Esc to cancel.
 */
export function WikilinkMenu({ query, summary, onSelect, onClose }: Props) {
  const results = filterAutocomplete(query, summary)
  const [activeIdx, setActiveIdx] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  // Reset selection when query changes.
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  // Keyboard navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = results[activeIdx]
        if (item) onSelect(item.code)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [results, activeIdx, onSelect, onClose])

  if (results.length === 0) {
    return (
      <div style={menuStyle} role="listbox" data-testid="wikilink-menu">
        <div style={emptyStyle}>No pages match</div>
      </div>
    )
  }

  return (
    <ul
      ref={listRef}
      style={menuStyle}
      role="listbox"
      aria-label="Wikilink autocomplete"
      data-testid="wikilink-menu"
    >
      {results.map((item, idx) => (
        <li
          key={item.code}
          role="option"
          aria-selected={idx === activeIdx}
          style={idx === activeIdx ? activeItemStyle : itemStyle}
          onMouseEnter={() => setActiveIdx(idx)}
          onClick={() => onSelect(item.code)}
          data-testid={`wikilink-option-${item.code}`}
        >
          <span style={codeStyle}>{item.code}</span>
          {item.title && <span style={titleStyle}>{item.title}</span>}
        </li>
      ))}
    </ul>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  background: '#fff',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  maxHeight: '240px',
  overflowY: 'auto',
  zIndex: 1000,
  listStyle: 'none',
  margin: 0,
  padding: '4px 0',
  minWidth: '200px',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: '0.875rem',
}

const activeItemStyle: React.CSSProperties = {
  ...itemStyle,
  background: '#e8f0fe',
}

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  color: '#1a73e8',
  flexShrink: 0,
}

const titleStyle: React.CSSProperties = {
  color: '#555',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const emptyStyle: React.CSSProperties = {
  padding: '8px 12px',
  color: '#999',
  fontSize: '0.875rem',
}
