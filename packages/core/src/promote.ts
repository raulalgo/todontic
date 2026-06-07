/**
 * Promotion planner — pure functions for promoting bullets to standalone pages.
 *
 * "Promotion" means taking a bullet (and its sub-bullets) and creating a new
 * page from it. The original bullet is rewritten to `- [[CODE]] text` in the
 * parent page, preserving any existing block ID on the wikilink line.
 *
 * This module is **FS-free** — all FS operations live in `VaultManager.promote`
 * in the desktop app. The pure planner here only computes what the rewritten
 * pages should look like.
 *
 * Data-model constraints:
 *  - The promoted bullet's text becomes the title H1 of the new page.
 *  - Sub-bullets move into the new page's body as the outline.
 *  - The original bullet line is rewritten to `- [[CODE]] <text> [^blockId]`.
 *    If the bullet had a block ID, it is appended AFTER the wikilink
 *    (Data-model line 153: `- [[CODE]] text ^id`).
 *  - Already-coded bullets (those whose text already starts with `[[...]]` or
 *    whose frontmatter has a `code`) are skipped in bulk promotion.
 *  - Codes are never reused (burnt on undo — enforced by VaultManager).
 */

import type { Bullet } from './outline.js'
import { serializeOutline } from './outline.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The result of planning a single-bullet promotion.
 * All fields are pure strings; FS operations are the caller's responsibility.
 */
export interface PromotionPlan {
  /**
   * The full body for the new page (outline of the promoted bullet's children,
   * preceded by a `# <title>` heading).
   */
  newPageBody: string
  /**
   * Title of the new page (the promoted bullet's text, stripped of any block ID).
   */
  newPageTitle: string
  /**
   * The rewritten line for the promoted bullet in the parent page.
   * Format: `- [[CODE]] <text>` or `- [[CODE]] <text> ^<blockId>`.
   */
  rewrittenLine: string
}

/**
 * Result of planning a bulk promotion (N bullets).
 */
export interface BulkPromotionPlan {
  /** Plans in the same order as the input `targets`. */
  plans: PromotionPlan[]
  /** Indices of targets that were skipped (already coded). */
  skippedIndices: number[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine whether a bullet is already promoted (has a wikilink as its text).
 *
 * A bullet is "already coded" if its `text` starts with `[[` (wikilink) or if
 * the caller indicates it already has a code (passed via `isAlreadyCoded`).
 *
 * @param bullet - The bullet to check.
 * @returns True if the bullet is already a promoted page reference.
 */
export function isAlreadyCoded(bullet: Bullet): boolean {
  return bullet.text.trimStart().startsWith('[[')
}

/**
 * Serialize a bullet's sub-bullets into a body string (no heading).
 * Used for the body of promoted pages: children become the outline.
 */
export function serializeChildrenBody(children: Bullet[]): string {
  if (children.length === 0) return ''
  return serializeOutline({ prefix: '', bullets: children, suffix: '\n' })
}

// ─── Single promotion ─────────────────────────────────────────────────────────

/**
 * Plan the promotion of a single bullet.
 *
 * @param bullet - The bullet to promote (with its children).
 * @param code   - The code to assign to the new page (e.g. `TDC-42`).
 * @returns A `PromotionPlan` with the computed strings.
 */
export function planPromotion(bullet: Bullet, code: string): PromotionPlan {
  const title = bullet.text.trim()
  const childrenBody = serializeChildrenBody(bullet.children)

  // New page body: H1 heading + children outline.
  const newPageBody = `# ${title}\n\n${childrenBody}`

  // Rewritten parent line: `[[CODE]] text [^blockId]`.
  const blockIdSuffix = bullet.blockId ? ` ^${bullet.blockId}` : ''
  const rewrittenLine = `- [[${code}]] ${title}${blockIdSuffix}`

  return { newPageBody, newPageTitle: title, rewrittenLine }
}

// ─── Bulk promotion ───────────────────────────────────────────────────────────

/**
 * Plan the promotion of multiple bullets (bulk).
 *
 * Processes targets in document order. Already-coded bullets are skipped and
 * recorded in `skippedIndices`.
 *
 * @param bullets - The full parent bullet tree (for context).
 * @param targetIds - Session IDs of the bullets to promote (document order).
 * @param codes     - Pre-reserved codes, one per non-skipped target (in order).
 *   The length of `codes` must match `targetIds.length - skipped.length`.
 * @returns `BulkPromotionPlan` with plans and skipped indices.
 */
export function planBulkPromotion(
  bullets: Bullet[],
  targetIds: string[],
  codes: string[],
): BulkPromotionPlan {
  const plans: PromotionPlan[] = []
  const skippedIndices: number[] = []
  let codeIdx = 0

  // Build a lookup map for quick access by session ID.
  const bulletMap = new Map<string, Bullet>()
  function collectBullets(bs: Bullet[]) {
    for (const b of bs) {
      bulletMap.set(b.id, b)
      collectBullets(b.children)
    }
  }
  collectBullets(bullets)

  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i]!
    const bullet = bulletMap.get(id)
    if (!bullet) {
      skippedIndices.push(i)
      continue
    }
    if (isAlreadyCoded(bullet)) {
      skippedIndices.push(i)
      continue
    }
    const code = codes[codeIdx++]
    if (!code) {
      // Not enough codes — shouldn't happen if caller reserved correctly.
      skippedIndices.push(i)
      continue
    }
    plans.push(planPromotion(bullet, code))
  }

  return { plans, skippedIndices }
}

/**
 * Apply a bulk promotion plan to the parent bullet tree.
 *
 * Replaces each promoted bullet in the tree with a wikilink bullet whose text
 * is the `rewrittenLine` from the plan (with the marker prefix stripped).
 *
 * Returns a new bullet tree (does not mutate the input).
 *
 * @param bullets    - The parent bullet tree.
 * @param targetIds  - Session IDs of promoted bullets (in order).
 * @param plans      - Plans (non-skipped only, in order).
 * @param skippedIndices - Indices of targets that were skipped.
 * @returns New bullet tree with promoted bullets rewritten.
 */
export function applyPromotionToParentBullets(
  bullets: Bullet[],
  targetIds: string[],
  plans: PromotionPlan[],
  skippedIndices: Set<number>,
): Bullet[] {
  // Map: bullet session ID → rewritten text (for non-skipped targets).
  const rewriteMap = new Map<string, string>()
  let planIdx = 0
  for (let i = 0; i < targetIds.length; i++) {
    if (skippedIndices.has(i)) continue
    const plan = plans[planIdx++]
    const id = targetIds[i]
    if (plan && id) {
      // Strip the `- ` prefix from rewrittenLine to get the text.
      const text = plan.rewrittenLine.startsWith('- ')
        ? plan.rewrittenLine.slice(2)
        : plan.rewrittenLine
      rewriteMap.set(id, text)
    }
  }

  function rewrite(bs: Bullet[]): Bullet[] {
    return bs.map((b) => {
      const newText = rewriteMap.get(b.id)
      if (newText !== undefined) {
        // Rewritten bullet: replace text, strip children (they moved to new page).
        return { ...b, text: newText, children: [] }
      }
      return { ...b, children: rewrite(b.children) }
    })
  }

  return rewrite(bullets)
}
