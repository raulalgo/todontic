/**
 * BlockNote ↔ Bullet[] adapter.
 *
 * Maps between our in-memory `Bullet[]` tree (the canonical outliner model,
 * serialised to disk by `serializeOutline`) and BlockNote's `PartialBlock[]`
 * (the editor's own in-memory representation).
 *
 * Design contract (Architecture Decisions):
 *  - Our `core/outline.ts` serialiser is the ONLY source of truth for disk.
 *    BlockNote's own markdown export is NEVER used for disk I/O.
 *  - `blockId` lives in a BlockNote custom `props` field (`todonticBlockId`),
 *    NOT in visible text. This lets it survive editor operations (move, indent)
 *    without contaminating the displayed content.
 *  - On cross-page paste, block IDs are stripped (Data-model invariant —
 *    IDs are page-scoped and must be reassigned on paste). This is handled by
 *    the paste handler hook, not here.
 *
 * `packages/core` may NEVER import BlockNote (browser/React dependency).
 * This adapter lives in the renderer and is the only place that touches
 * BlockNote types.
 */

import type { Block, PartialBlock } from '@blocknote/core'
import type { Bullet } from '@todontic/core'

// ─── Custom props ─────────────────────────────────────────────────────────────

/** The BlockNote prop name used to store the Todontic block ID. */
export const BLOCK_ID_PROP = 'todonticBlockId'

// ─── Bullet → BlockNote ───────────────────────────────────────────────────────

/**
 * Convert a `Bullet[]` tree to `PartialBlock[]` suitable for loading into a
 * BlockNote editor via `editor.replaceBlocks`.
 *
 * Each bullet maps to one BlockNote block of type `"bulletListItem"`.
 * Children map to nested blocks.
 * The block ID is stored in `props.todonticBlockId` (empty string if absent).
 *
 * @param bullets - The bullet tree from `parseOutline`.
 * @returns Array of `PartialBlock` for the BlockNote editor.
 */
export function bulletsToBlocks(bullets: Bullet[]): PartialBlock[] {
  return bullets.map(bulletToBlock)
}

function bulletToBlock(bullet: Bullet): PartialBlock {
  return {
    type: 'bulletListItem',
    content: bullet.text
      ? [{ type: 'text', text: bullet.text, styles: {} }]
      : [],
    props: {
      [BLOCK_ID_PROP]: bullet.blockId ?? '',
    } as Record<string, unknown>,
    children: bullet.children.length > 0 ? bulletsToBlocks(bullet.children) : [],
  }
}

// ─── BlockNote → Bullet ───────────────────────────────────────────────────────

/**
 * Convert a BlockNote `Block[]` (from `editor.document`) back to `Bullet[]`.
 *
 * Extracts plain text from inline content (joining all text segments).
 * Recovers `blockId` from `props.todonticBlockId` (undefined if empty/absent).
 * Recursively converts nested children.
 *
 * @param blocks - The editor's current document blocks.
 * @returns `Bullet[]` tree ready for `serializeOutline`.
 */
export function blocksToBullets(blocks: Block[]): Bullet[] {
  let counter = 0
  return blocks.map((block) => blockToBullet(block, () => `b${(++counter).toString()}`))
}

function blockToBullet(block: Block, nextId: () => string): Bullet {
  // Extract plain text from inline content segments.
  const text = extractText(block.content)

  // Recover block ID from custom prop.
  const rawId = (block.props as Record<string, unknown>)?.[BLOCK_ID_PROP]
  const blockId = typeof rawId === 'string' && rawId.length === 6 ? rawId : undefined

  return {
    id: nextId(),
    text,
    blockId,
    collapsed: false, // overlay applied separately by useOutlinerDoc
    children: Array.isArray(block.children)
      ? block.children.map((child) => blockToBullet(child as Block, nextId))
      : [],
    sourceMarker: '-',
  }
}

/**
 * Extract plain text from a BlockNote inline content array.
 * Joins all `text`-type segments; ignores links and other inline types.
 */
function extractText(content: Block['content']): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        return String((item as { text: unknown }).text)
      }
      return ''
    })
    .join('')
}

// ─── Paste helper ─────────────────────────────────────────────────────────────

/**
 * Strip block IDs from a `Bullet[]` tree (used on cross-page paste).
 *
 * Data-model invariant: block IDs are page-scoped. When content is pasted from
 * another page, IDs must be cleared so the editor can assign new ones lazily
 * (FR-7). The caller is responsible for triggering a save so new IDs are
 * written to disk.
 *
 * @param bullets - Bullets to strip IDs from (mutates a copy).
 * @returns New `Bullet[]` tree with all `blockId` fields removed.
 */
export function stripBlockIds(bullets: Bullet[]): Bullet[] {
  return bullets.map((b) => ({
    ...b,
    blockId: undefined,
    children: stripBlockIds(b.children),
  }))
}
