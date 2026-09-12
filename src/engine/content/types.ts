/**
 * Normalized content types.
 *
 * Vendored SRD data is stringly typed ("atk": "+3", "thresholds": "8/15",
 * "damage": "1d12+2 phy"). Importers under `content/pack/` turn it into these
 * shapes once, at load time, so the rules and the runtime only ever see numbers,
 * parsed dice and enums.
 */

import type { DamageThresholds } from '../rules/damage';
import type { DiceExpression, ParsedDamage } from '../rules/dice';
import type { RangeBand } from '../rules/range';

/** Stable kebab-case identifier. Never rely on array order. */
export type ContentId = string;

/** Adversary tiers 1-4. */
export type Tier = 1 | 2 | 3 | 4;

/**
 * Adversary roles from the SRD stat blocks. `horde` carries the damage-per-HP
 * figure printed in the type line, e.g. "Horde (3/HP)".
 */
export type AdversaryRole =
  | 'bruiser'
  | 'horde'
  | 'leader'
  | 'minion'
  | 'ranged'
  | 'skulk'
  | 'social'
  | 'solo'
  | 'standard'
  | 'support';

/** How a feature is used at the table. */
export type FeatureKind = 'passive' | 'action' | 'reaction';

export interface AdversaryFeature {
  /** Feature name with the kind suffix stripped: "Relentless", "Earth Eruption". */
  name: string;
  kind: FeatureKind;
  /**
   * The parenthetical in a name like "Relentless (3)", "Minion (13)" or
   * "Horde (1d4+1)", verbatim and unparsed.
   *
   * It is deliberately a string, because the SRD gives it a different meaning per
   * feature: for `Relentless (X)` it is how many times the adversary can be
   * spotlighted per GM turn, for `Minion (X)` the damage a PC must deal to defeat
   * an additional Minion, and for `Horde (X)` the damage its standard attack
   * switches to at half HP — a dice expression, not a count. Feature
   * implementations interpret it; the importer does not guess.
   */
  parameter?: string;
  /**
   * The countdown printed after the kind, verbatim: "5", "Loop 1d6",
   * "Decreasing 8", "1d12". Kept as text because countdown behaviour is a
   * separate system; `longTerm` flags the one "Long-Term Countdown".
   */
  countdown?: string;
  longTermCountdown?: boolean;
  /** Rules text, as written. Markdown emphasis is preserved. */
  text: string;
  /**
   * True when using it requires the GM to spend their own currency. Detected
   * from the text, so treat it as a hint for the GM AI rather than a guarantee.
   *
   * Named for what it does rather than for the resource: this is about to be
   * pack data, and the resource is being renamed.
   */
  costsGmResource: boolean;
}

/** An Experience and its modifier: "Tremor Sense +2". */
export interface Experience {
  name: string;
  modifier: number;
}

export interface AdversaryDef {
  id: ContentId;
  name: string;
  tier: Tier;
  role: AdversaryRole;
  /**
   * The number in a Horde's type line, "Horde (3/HP)" — how many individual
   * creatures each marked Hit Point represents.
   *
   * The vendored SRD text never spells the notation out (it only defines the
   * `Horde (X) - Passive` *feature*, which is a damage expression and a different
   * thing), so this is carried as data and no rule consumes it yet. Two stat
   * blocks print "Horde (/HP)" with the number missing and leave it `undefined`.
   */
  hordeUnitsPerHp?: number;
  description: string;
  motivesAndTactics: string;

  /** Difficulty of rolls made against this adversary. */
  difficulty: number;
  thresholds: DamageThresholds;
  /** Hit Point slots. */
  hitPoints: number;
  /** Stress slots. */
  stress: number;

  /** Name of the standard attack: "Claws". */
  attackName: string;
  /**
   * Attack modifier. Almost always a flat number, but one stat block rolls it
   * ("+2d4"), so it is a dice expression rather than a number.
   */
  attackModifier: DiceExpression;
  attackRange: RangeBand;
  attackDamage: ParsedDamage;

  experiences: Experience[];
  features: AdversaryFeature[];
}

/** One thing an importer could not read, named well enough to fix the content. */
export interface ContentIssue {
  /** Source file or pack the entry came from. */
  source: string;
  /** The entry's name or id, when it had one. */
  entry: string;
  /** Which field failed. */
  field: string;
  /** What was wrong, and the offending value. */
  message: string;
}

/**
 * The result of importing a pack. Importers never throw on bad content: a broken
 * entry is skipped and reported, so one typo cannot take down a whole project.
 */
export interface ImportResult<T> {
  defs: T[];
  issues: ContentIssue[];
}

/** Turn a display name into a stable kebab-case id. */
export function toContentId(name: string): ContentId {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
