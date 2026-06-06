import type { RecentVault, VaultConfig, VaultEventPayload } from '@todontic/shared'
import { useCallback, useEffect, useState } from 'react'

// ─── State shape ──────────────────────────────────────────────────────────────

export interface VaultState {
  /** Absolute path of the currently-open vault, or null. */
  rootPath: string | null
  /** Live config of the open vault, or null. */
  config: VaultConfig | null
  /** Last 5 recently-opened vaults, newest first. */
  recent: RecentVault[]
  /** True while an open/init operation is in flight. */
  loading: boolean
  /** Last error message from a vault operation, or null. */
  error: string | null
  /** The most-recently-received watcher event (for diagnostics / future use). */
  lastEvent: VaultEventPayload | null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Central renderer hook for vault state.
 *
 * Wraps `window.todontic.vault.*` IPC calls and subscribes to `onVaultEvent`
 * to keep a lightweight local view fresh.  No business logic lives here — only
 * state synchronisation.
 *
 * Usage:
 * ```tsx
 * const { state, openVault, initVault, loadRecent } = useVault()
 * ```
 */
export function useVault() {
  const [state, setState] = useState<VaultState>({
    rootPath: null,
    config: null,
    recent: [],
    loading: false,
    error: null,
    lastEvent: null,
  })

  const vault = window.todontic?.vault

  // ── Initial load ────────────────────────────────────────────────────────────

  /** Refresh the recent-vaults list from main. */
  const loadRecent = useCallback(async () => {
    if (!vault) return
    try {
      const recent = await vault.listRecent()
      setState((s) => ({ ...s, recent }))
    } catch {
      // Non-fatal; leave existing list.
    }
  }, [vault])

  // On mount: poll for the current vault state to handle the race where main
  // auto-opens a vault before the renderer's onVaultEvent subscription is set
  // up (startup auto-reopen, US-001).
  useEffect(() => {
    if (!vault) return
    void vault.getState().then((vaultState) => {
      if (vaultState) {
        const { rootPath, config } = vaultState
        void vault.listRecent().then((recent) => {
          setState((s) =>
            // Only update if no vault is open yet — avoid clobbering a
            // concurrently-received vault:opened event.
            s.rootPath ? s : { ...s, rootPath, config, recent, loading: false, error: null },
          )
        })
      }
    })
  }, [vault])

  // Load recent list on mount (even if no vault is open yet).
  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  // ── Watcher event subscription ──────────────────────────────────────────────

  useEffect(() => {
    if (!vault) return
    const unsub = vault.onVaultEvent((payload) => {
      if (payload.type === 'opened') {
        // Main auto-opened a vault (US-001 startup re-open).
        // Hydrate the renderer state by fetching the config + recent list.
        const rootPath = payload.rootPath
        void vault.getConfig().then((config) => {
          void vault.listRecent().then((recent) => {
            setState((s) => ({ ...s, rootPath, config, recent, loading: false, error: null }))
          })
        })
      } else {
        setState((s) => ({ ...s, lastEvent: payload }))
      }
    })
    return unsub
  }, [vault])

  // ── Operations ──────────────────────────────────────────────────────────────

  /**
   * Open an existing vault (requires `.todontic/config.yml` to exist).
   * Updates `rootPath` and `config` on success.
   *
   * @returns true on success, false if the open failed (error is set in state).
   */
  const openVault = useCallback(
    async (rootPath: string): Promise<boolean> => {
      if (!vault) return false
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        await vault.open(rootPath)
        const config = await vault.getConfig()
        const recent = await vault.listRecent()
        setState((s) => ({ ...s, rootPath, config, recent, loading: false }))
        return true
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
        return false
      }
    },
    [vault],
  )

  /**
   * Initialise a new vault at `rootPath`, then open it.
   * Creates `.todontic/`, `runs/`, `cache/`, and `config.yml`.
   *
   * @returns true on success, false if init/open failed (error is set in state).
   */
  const initVault = useCallback(
    async (rootPath: string): Promise<boolean> => {
      if (!vault) return false
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        await vault.init(rootPath)
        const config = await vault.getConfig()
        const recent = await vault.listRecent()
        setState((s) => ({ ...s, rootPath, config, recent, loading: false }))
        return true
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
        return false
      }
    },
    [vault],
  )

  /**
   * Show the native folder picker and return the selected path, or null.
   * Does NOT open the vault — caller decides whether to open or init.
   */
  const pickFolder = useCallback(async (): Promise<string | null> => {
    if (!vault) return null
    return vault.pickFolder()
  }, [vault])

  /**
   * Side-effect-free check whether `rootPath` is an initialised vault.
   * Used to route between opening and showing the initialise prompt.
   */
  const isInitialised = useCallback(
    async (rootPath: string): Promise<boolean> => {
      if (!vault) return false
      return vault.isInitialised(rootPath)
    },
    [vault],
  )

  /**
   * Save updated user-editable config fields to disk and refresh local state
   * from main.
   *
   * codePrefixes counters are owned by the main process and are never taken
   * from the renderer snapshot — after setConfig we re-fetch the canonical
   * config (which includes the authoritative counter values) so our local copy
   * stays accurate (Findings #1/#2 fix).
   */
  const saveConfig = useCallback(
    async (config: VaultConfig) => {
      if (!vault) return
      setState((s) => ({ ...s, error: null }))
      try {
        await vault.setConfig(config)
        // Re-fetch from main so the renderer holds the authoritative config
        // (including any counter bumps that happened between open and save).
        const fresh = await vault.getConfig()
        setState((s) => ({ ...s, config: fresh }))
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
        }))
      }
    },
    [vault],
  )

  /** Clear the current error message. */
  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }))
  }, [])

  return {
    state,
    openVault,
    initVault,
    pickFolder,
    isInitialised,
    saveConfig,
    loadRecent,
    clearError,
  }
}
