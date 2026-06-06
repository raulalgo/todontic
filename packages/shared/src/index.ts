/**
 * Shared types and utilities used across Todontic packages.
 *
 * Kept dependency-free so every other package (core, agents, mcp-installer,
 * skills) and the desktop app can import from here without cycles.
 */

/** Built-in item statuses. User-extendable per workspace (D — status enum). */
export type BuiltinStatus = 'todo' | 'in-progress' | 'blocked' | 'done'

/** The four built-in statuses, in display order. */
export const BUILTIN_STATUSES: readonly BuiltinStatus[] = [
  'todo',
  'in-progress',
  'blocked',
  'done',
] as const

/** A status is either a built-in or a user-defined string. */
export type Status = BuiltinStatus | (string & {})

export const TODONTIC_VERSION = '0.1.0'

// ─── Path constants ───────────────────────────────────────────────────────────

/** Hidden directory Todontic creates inside each vault. */
export const TODONTIC_DIR = '.todontic'

/** Vault-relative path to the config file. */
export const CONFIG_RELATIVE_PATH = '.todontic/config.yml'

// ─── Code / prefix constants ──────────────────────────────────────────────────

/** Default code prefix applied when a vault is initialised without customisation. */
export const DEFAULT_CODE_PREFIX = 'TDC'

/** Default attachments sub-path inside the vault root. */
export const DEFAULT_ATTACHMENTS_PATH = 'attachments'

// ─── On-disk value types ──────────────────────────────────────────────────────

/**
 * The parsed contents of the `todontic:` frontmatter subtree.
 * All fields are optional — files may omit any subset (D-009).
 */
export interface TodonticFrontmatter {
  /** Monotonic code string, e.g. `TDC-42`. */
  code?: string
  /** Item status — one of the built-ins or a custom string. */
  status?: Status
  /** User-defined tags. */
  tags?: string[]
  /** ISO-8601 creation timestamp. */
  createdAt?: string
  /** ISO-8601 last-modified timestamp. */
  updatedAt?: string
  /** Arbitrary additional keys preserved from/to the `todontic:` map. */
  [key: string]: unknown
}

/**
 * A block reference extracted from a body line, e.g. `^abc123`.
 * The block ID is the 6-character alphanumeric suffix.
 */
export interface BlockRef {
  /** The full block ID including the caret, e.g. `^abc123`. */
  id: string
  /** 1-based line number inside the body where the ID appears. */
  line: number
}

/**
 * A backlink pointing from one page to another.
 * Created when page A's body contains `[[CODE]]` or `[[CODE#^id]]`.
 */
export interface Backlink {
  /** The code of the page that contains the wikilink. */
  fromCode: string
  /** The target code referenced by the wikilink. */
  toCode: string
  /** Optional block ID within the target, if the wikilink is `[[CODE#^id]]`. */
  toBlockId?: string
}

/**
 * A fully parsed Todontic page, as returned by `parsePage`.
 *
 * Design invariant (D-011): `serializePage(parsePage(raw)) === raw` for any
 * file Todontic has previously written. Foreign frontmatter keys and the entire
 * body are preserved byte-for-byte.
 */
export interface ParsedPage {
  /** Vault-relative path, e.g. `notes/my-page.md`. */
  relPath: string
  /** Absolute path on disk. Set by the caller (main process); empty string in pure-core contexts. */
  filePath: string
  /** Parsed `todontic:` frontmatter subtree. Empty object if absent. */
  frontmatter: TodonticFrontmatter
  /**
   * Foreign top-level frontmatter keys verbatim (everything except `todontic:`).
   * Preserved byte-for-byte on re-serialize (D-009, D-011).
   */
  foreignFrontmatter: string
  /**
   * Whether the `todontic:` block appeared before any foreign frontmatter keys
   * in the original file.  Used by the serializer to restore the original
   * block ordering on round-trip (D-011 / Finding #3).
   *
   * `true`  → emit todontic first, then foreign keys.
   * `false` → emit foreign keys first, then todontic (the default for files
   *            written by Todontic itself).
   */
  todonticFirst: boolean
  /** Raw body text after the frontmatter fence — byte-preserved (Philosophy #10). */
  body: string
  /** Title extracted from the first `# ` heading in the body, or null. */
  title: string | null
  /** Block IDs found in the body. */
  blockIds: BlockRef[]
  /** Whether the original file had a frontmatter block. */
  hadFrontmatter: boolean
  /** Line-ending style detected in the file. */
  eol: '\n' | '\r\n'
  /** Whether the original file ended with a newline character. */
  trailingNewline: boolean
}

/**
 * A page in the live vault index.
 * Alias for `ParsedPage` — the live vault keeps fully parsed pages.
 */
export type Page = ParsedPage

// ─── Vault index ──────────────────────────────────────────────────────────────

/**
 * In-memory index of all pages in the open vault.
 * Derived and always rebuildable from disk (load-bearing invariant).
 */
export interface VaultIndex {
  /** Pages keyed by their `todontic.code` value. */
  byCode: Map<string, ParsedPage>
  /** Pages keyed by their extracted title (may have multiple pages per title). */
  byTitle: Map<string, ParsedPage[]>
  /** Pages keyed by tag (each tag maps to all pages with that tag). */
  byTag: Map<string, ParsedPage[]>
  /** Pages keyed by status. */
  byStatus: Map<Status, ParsedPage[]>
  /** Backlinks: for each code, the list of pages that reference it. */
  backlinks: Map<string, Backlink[]>
  /**
   * Block ID index keyed as `CODE#^id` → the page that owns it.
   * Enables efficient resolution of `[[CODE#^id]]` wikilinks.
   */
  blockIds: Map<string, ParsedPage>
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Per-prefix counter state stored in config.yml. */
export interface CodePrefixConfig {
  /** The next integer to assign for this prefix (monotonic, never reused). */
  next: number
}

/** Map of prefix → counter state. */
export type CodePrefixesConfig = Record<string, CodePrefixConfig>

/** Full vault configuration stored in `.todontic/config.yml`. */
export interface VaultConfig {
  /** The active code prefix, e.g. `TDC`. */
  codePrefix: string
  /** All statuses available in this vault, in display order. */
  statuses: Status[]
  /** Vault-relative path for attachments (images, etc.). */
  attachmentsPath: string
  /** Per-prefix code counters. */
  codePrefixes: CodePrefixesConfig
}

// ─── Recent vaults ────────────────────────────────────────────────────────────

/** One entry in the recently-opened vaults list. */
export interface RecentVault {
  /** Absolute path to the vault root. */
  path: string
  /** ISO-8601 timestamp of the last open. */
  lastOpened: string
}

// ─── IPC contract ─────────────────────────────────────────────────────────────

/**
 * Watcher event payload forwarded from main to renderer via `vault:event`.
 * Renderer uses this to keep a lightweight local view of the vault fresh.
 *
 * The `opened` type is emitted by main after a successful auto-reopen on
 * startup (US-001) so the renderer can hydrate its vault state without the
 * user needing to call `vault.open()` again.
 */
export type VaultEventPayload =
  | { type: 'opened'; rootPath: string }
  | { type: 'created'; relPath: string; page: ParsedPage }
  | { type: 'changed'; relPath: string; page: ParsedPage }
  | { type: 'unlinked'; relPath: string }

/**
 * The typed IPC surface for vault operations.
 * Implemented by main process + preload; consumed by renderer.
 *
 * All paths are absolute on the main side; the renderer passes absolute vault
 * root paths for open/init. Page data crosses the boundary as plain objects
 * (Maps are serialised to arrays of pairs by the IPC layer — caller converts).
 */
export interface VaultApi {
  /**
   * Show the OS native folder picker and return the selected path,
   * or null if the user cancelled.
   */
  pickFolder(): Promise<string | null>

  /**
   * Return true if `rootPath` is already an initialised vault
   * (i.e. `.todontic/config.yml` exists). Side-effect-free — does NOT open the
   * vault. Used to decide between `open` and showing the initialise prompt.
   */
  isInitialised(rootPath: string): Promise<boolean>

  /**
   * Open (scan + index) an existing vault at `rootPath`.
   * Throws if `.todontic/config.yml` does not exist.
   */
  open(rootPath: string): Promise<void>

  /**
   * Initialise a new vault at `rootPath`:
   * creates `.todontic/`, `runs/`, `cache/`, and writes `defaultConfig()`.
   */
  init(rootPath: string): Promise<void>

  /** Return the last 5 recently-opened vault entries, newest first. */
  listRecent(): Promise<RecentVault[]>

  /**
   * Read and parse a page by vault-relative path.
   * Returns null if the file does not exist.
   */
  readPage(relPath: string): Promise<ParsedPage | null>

  /**
   * Serialize and atomically write a page back to disk.
   * Suppresses the resulting chokidar self-write event.
   */
  writePage(page: ParsedPage): Promise<void>

  /**
   * Return the current open vault's root path and config, or null if no vault
   * is open.  Used by the renderer to hydrate on mount (avoids timing race with
   * the main-process startup auto-open).
   */
  getState(): Promise<{ rootPath: string; config: VaultConfig } | null>

  /** Return the current vault config. */
  getConfig(): Promise<VaultConfig>

  /**
   * Overwrite the vault config (serialises + atomic write).
   * Applied immediately; no restart required.
   */
  setConfig(config: VaultConfig): Promise<void>

  /**
   * Reserve `n` monotonic codes for `prefix` and persist the bumped counter.
   * Returns the allocated codes (e.g. `['TDC-1', 'TDC-2']`).
   * Throws if `prefix` is not in config.codePrefixes (caller must seed first).
   */
  reserveCodes(prefix: string, n: number): Promise<string[]>

  /**
   * Subscribe to vault watcher events forwarded from main.
   * Returns an unsubscribe function.
   */
  onVaultEvent(cb: (payload: VaultEventPayload) => void): () => void
}
