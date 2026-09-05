/**
 * Cover.
 *
 * SRD reference: `tools/srd-sources/seansbox/README.md`, "COVER" — "Physical
 * obstructions, allies, and terrain can protect you from harm."
 *
 * The SRD names three levels and their effects but does not say what geometry
 * produces which level; that is left to the GM. So this module owns the *effects*,
 * which are rules, and `grid/los.ts` owns the geometry behind a policy the engine
 * states openly as a house rule.
 */

/** Ordered from least to most protective. */
export const COVER_LEVELS = ['none', 'light', 'full', 'total'] as const;
export type CoverLevel = (typeof COVER_LEVELS)[number];

/**
 * Evasion bonus against *ranged* attacks: Light Cover +1, Full Cover +2.
 * Total Cover is not a bonus — the target cannot be targeted at all.
 */
export const COVER_EVASION_BONUS: Readonly<Record<CoverLevel, number>> = {
  none: 0,
  light: 1,
  full: 2,
  total: 0,
};

/** Melee attacks ignore cover; only ranged attacks are affected. */
export function coverEvasionBonus(cover: CoverLevel, ranged = true): number {
  return ranged ? COVER_EVASION_BONUS[cover] : 0;
}

/**
 * "Total Cover - cannot be targeted by ranged attacks until you move or the cover
 * is removed."
 */
export function canBeTargetedByRanged(cover: CoverLevel): boolean {
  return cover !== 'total';
}

/** Position in the cover order; larger is more protective. */
export function coverIndex(cover: CoverLevel): number {
  return COVER_LEVELS.indexOf(cover);
}

/** The more protective of two cover levels — cover does not stack, the best applies. */
export function bestCover(a: CoverLevel, b: CoverLevel): CoverLevel {
  return coverIndex(a) >= coverIndex(b) ? a : b;
}
