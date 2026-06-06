import type { Status, VaultConfig } from '@todontic/shared'
import { useEffect, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface VaultSettingsProps {
  /** Current vault config from the store. */
  config: VaultConfig
  /** Called to persist the updated config. Returns an error string or null. */
  onSave: (config: VaultConfig) => Promise<void>
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Settings → Vault editor.
 *
 * Lets the user update:
 *  - Code prefix (e.g. `TDC`).
 *  - Statuses (one per line, each a first-class display value).
 *  - Attachments path (vault-relative folder).
 *
 * Config changes are applied immediately on save without a restart.
 * If the save throws, the error is shown inline and the last-valid config is
 * retained (the form reflects the in-memory draft, not the persisted state).
 *
 * Mirrors YAML structure 1:1 so users can cross-reference `config.yml`.
 */
export function VaultSettings({ config, onSave }: VaultSettingsProps) {
  // ── Draft state ─────────────────────────────────────────────────────────────

  const [prefix, setPrefix] = useState(config.codePrefix)
  const [statusesText, setStatusesText] = useState(config.statuses.join('\n'))
  const [attachmentsPath, setAttachmentsPath] = useState(config.attachmentsPath)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Sync form if the config prop changes externally (e.g. another window).
  useEffect(() => {
    setPrefix(config.codePrefix)
    setStatusesText(config.statuses.join('\n'))
    setAttachmentsPath(config.attachmentsPath)
  }, [config])

  // ── Validation ──────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!prefix.trim()) return 'Code prefix must not be empty.'
    if (!/^[A-Z][A-Z0-9_-]*$/i.test(prefix.trim())) {
      return 'Code prefix must start with a letter and contain only letters, digits, hyphens, or underscores.'
    }
    const statuses = parseStatuses(statusesText)
    if (statuses.length === 0) return 'At least one status is required.'
    if (!attachmentsPath.trim()) return 'Attachments path must not be empty.'
    return null
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const trimmedPrefix = prefix.trim().toUpperCase()
    const statuses = parseStatuses(statusesText)

    // codePrefixes counters are managed exclusively by the main process.
    // Pass them through unchanged so the IPC type is satisfied; the main
    // process will always re-read the authoritative counter value from disk
    // under its config mutex and never use this value (Findings #1/#2 fix).
    const updated: VaultConfig = {
      codePrefix: trimmedPrefix,
      statuses,
      attachmentsPath: attachmentsPath.trim(),
      codePrefixes: config.codePrefixes,
    }

    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await onSave(updated)
      setSaved(true)
      // Clear the "Saved" confirmation after 2 s.
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      <h2 style={{ margin: '0 0 1.25rem' }}>Vault settings</h2>

      {/* Code prefix */}
      <label style={labelStyle}>
        <span style={labelTextStyle}>Code prefix</span>
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="TDC"
          style={inputStyle}
          disabled={saving}
          aria-label="Code prefix"
        />
        <span style={hintStyle}>
          Uppercase letters only (e.g. <code>TDC</code>). Used for new item codes like{' '}
          <code>{prefix.trim().toUpperCase() || 'TDC'}-42</code>.
        </span>
      </label>

      {/* Statuses */}
      <label style={labelStyle}>
        <span style={labelTextStyle}>Statuses</span>
        <textarea
          value={statusesText}
          onChange={(e) => setStatusesText(e.target.value)}
          rows={6}
          style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
          disabled={saving}
          aria-label="Statuses (one per line)"
        />
        <span style={hintStyle}>
          One status per line. Built-ins: todo, in-progress, blocked, done.
        </span>
      </label>

      {/* Attachments path */}
      <label style={labelStyle}>
        <span style={labelTextStyle}>Attachments folder</span>
        <input
          type="text"
          value={attachmentsPath}
          onChange={(e) => setAttachmentsPath(e.target.value)}
          placeholder="attachments"
          style={inputStyle}
          disabled={saving}
          aria-label="Attachments folder path"
        />
        <span style={hintStyle}>Vault-relative path where images and files are saved.</span>
      </label>

      {/* Actions */}
      <div style={actionsStyle}>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          style={saveBtnStyle}
          data-testid="vault-settings-save"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span style={savedStyle}>Saved</span>}
      </div>

      {error && (
        <p style={errorStyle} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStatuses(text: string): Status[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  maxWidth: '480px',
  padding: '1.5rem 0',
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  marginBottom: '1.25rem',
}

const labelTextStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: '0.9rem',
}

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  fontSize: '0.9rem',
  borderRadius: '4px',
  border: '1px solid #bbb',
  width: '100%',
  boxSizing: 'border-box',
}

const hintStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: '#888',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
}

const saveBtnStyle: React.CSSProperties = {
  padding: '0.45rem 1.25rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  borderRadius: '6px',
  border: 'none',
  background: '#1a73e8',
  color: '#fff',
}

const savedStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: '#2a8a2a',
}

const errorStyle: React.CSSProperties = {
  color: '#c00',
  fontSize: '0.85rem',
  marginTop: '0.75rem',
}
