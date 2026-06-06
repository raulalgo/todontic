/**
 * Pure-TS core: the outliner model and markdown ser/de.
 *
 * This is the bedrock for PRD-01 (Core Outliner) and PRD-02 (Local File
 * Storage). Two load-bearing invariants govern everything here:
 *  - Markdown files on disk are the source of truth; any in-memory index is
 *    derived and always rebuildable.
 *  - Markdown round-trip must be loss-free (write → read → write ≈ byte-stable).
 *    This is the #1 project risk (D-011) — every ser/de change needs a
 *    round-trip test.
 */

export { splitFrontmatter, joinFrontmatter } from './frontmatter.js'
export type { SplitResult } from './frontmatter.js'

export { extractBlockIds, BLOCK_ID_RE } from './blockId.js'

export { parsePage, serializePage, roundTrip } from './page.js'

export { buildIndex, WIKILINK_RE } from './vaultIndex.js'

export { parseConfig, serializeConfig, defaultConfig } from './config.js'

export { reserveCodes, peekNext } from './codeCounter.js'
