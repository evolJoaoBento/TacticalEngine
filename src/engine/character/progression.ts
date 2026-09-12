/**
 * Levelling up, the Daggerheart way.
 *
 * There is no experience bar. The GM says the party levels, and each character
 * then makes choices from a tier table: two advancements (some cost both
 * picks), one new domain card, and at the tier thresholds an Experience and a
 * Proficiency bump. This module holds the tables and the rule that a choice is
 * legal; it never mutates a sheet, it hands back a new one.
 *
 * Progress is *recorded*, not baked in: a sheet carries the list of
 * advancements it has taken, and `deriveCharacter` folds them into the numbers.
 * That is what lets a save hold a character who has grown, and an editor show
 * how they got there.
 *
 * The tier tables follow the core rulebook's level-up sheet (Chapter 2,
 * "Choosing Advancements"): tier 2 has no subclass, Proficiency or multiclass
 * boxes; tiers 3 and 4 may also tick an unmarked box on the previous tier's
 * sheet; the extra-card box is capped at level 4 on the tier 2 sheet and 7 on
 * tier 3; taking an upgraded subclass card crosses out that tier's multiclass
 * box, and multiclassing crosses out an unused subclass box (so mastery is
 * out of reach) and the other multiclass box.
 */

import type { ContentPack } from '../content/pack/import';
import type { Trait } from '../scene/schema';
import type { CharacterSheet } from './sheet';

/** Levels 2–4 are tier 2, 5–7 tier 3, 8–10 tier 4. Level 1 is tier 1 on its own. */
export type Tier = 1 | 2 | 3 | 4;

export function tierOf(level: number): Tier {
  if (level >= 8) return 4;
  if (level >= 5) return 3;
  if (level >= 2) return 2;
  return 1;
}

export const MAX_LEVEL = 10;

/**
 * Which tier's sheet a box is ticked on. Left out, it is the tier of the level
 * being taken; set, it is the previous tier, whose unmarked boxes tiers 3 and
 * 4 may still spend.
 */
interface Box {
  fromTier?: Tier;
}

/** One choice off the level-up sheet. */
export type Advancement =
  | ({ kind: 'traits'; traits: [Trait, Trait] } & Box)
  | ({ kind: 'hitPoint' } & Box)
  | ({ kind: 'stress' } & Box)
  | ({ kind: 'experiences'; names: [string, string] } & Box)
  | ({ kind: 'domainCard'; card: string } & Box)
  | ({ kind: 'evasion' } & Box)
  | ({ kind: 'subclass' } & Box)
  | ({ kind: 'proficiency' } & Box)
  | ({ kind: 'multiclass'; classId: string; domain: string } & Box);

export type AdvancementKind = Advancement['kind'];

/** What a tier's sheet offers: how many times each box can be ticked, and what it costs. */
export interface TierOption {
  kind: AdvancementKind;
  /** Boxes on the sheet for this option in this tier. */
  limit: number;
  /** Advancement picks it consumes. Two for the big ones. */
  cost: 1 | 2;
  /** For the extra-card box: the highest card level this tier's box allows. */
  cardCap?: number;
}

const COMMON: TierOption[] = [
  { kind: 'traits', limit: 3, cost: 1 },
  { kind: 'hitPoint', limit: 2, cost: 1 },
  { kind: 'stress', limit: 2, cost: 1 },
  { kind: 'experiences', limit: 1, cost: 1 },
  { kind: 'evasion', limit: 1, cost: 1 },
];

const UPPER: TierOption[] = [
  { kind: 'subclass', limit: 1, cost: 1 },
  { kind: 'proficiency', limit: 1, cost: 2 },
  { kind: 'multiclass', limit: 1, cost: 2 },
];

export const TIER_OPTIONS: Readonly<Record<Tier, readonly TierOption[]>> = {
  1: [],
  2: [...COMMON, { kind: 'domainCard', limit: 1, cost: 1, cardCap: 4 }],
  3: [...COMMON, { kind: 'domainCard', limit: 1, cost: 1, cardCap: 7 }, ...UPPER],
  4: [...COMMON, { kind: 'domainCard', limit: 1, cost: 1 }, ...UPPER],
};

/** The tier whose unmarked boxes a level in `tier` may also spend, if any. */
export function previousTier(tier: Tier): Tier | null {
  return tier === 3 ? 2 : tier === 4 ? 3 : null;
}

/** An option as offered at a level: which tier's sheet the box sits on. */
export interface OfferedOption extends TierOption {
  tier: Tier;
}

/** Picks a level-up grants. */
export const PICKS_PER_LEVEL = 2;

/** Levels at which the tier achievements land: a new Experience and +1 Proficiency. */
export const ACHIEVEMENT_LEVELS: readonly number[] = [2, 5, 8];
/** Levels at which every marked trait is cleared, so it can be raised again. */
export const TRAIT_CLEAR_LEVELS: readonly number[] = [5, 8];

/** One recorded level-up, so a sheet can say how it got here. */
export interface LevelRecord {
  level: number;
  advancements: Advancement[];
  /** The domain card gained at this level. */
  domainCard: string;
  /** The Experience gained at a tier achievement level. */
  experience?: { name: string; modifier: number };
}

/** What a character wants to do with a level. */
export interface LevelUpPlan {
  advancements: Advancement[];
  domainCard: string;
  experience?: { name: string; modifier: number };
}

export interface LevelUpIssue {
  field: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Reading a sheet's history
// ---------------------------------------------------------------------------

/** How many boxes of an option are ticked on one tier's sheet. */
export function takenInTier(sheet: CharacterSheet, tier: Tier, kind: AdvancementKind): number {
  let count = 0;
  for (const record of sheet.levels ?? []) {
    for (const advancement of record.advancements) {
      if (advancement.kind === kind && (advancement.fromTier ?? tierOf(record.level)) === tier) count++;
    }
  }
  return count;
}

function hasMulticlassed(sheet: CharacterSheet): boolean {
  return (sheet.levels ?? []).some((r) => r.advancements.some((a) => a.kind === 'multiclass'));
}

/**
 * Whether a box is crossed out rather than merely used up. An upgraded
 * subclass card crosses out that tier's multiclass box; multiclassing crosses
 * out the other multiclass box and an unused subclass box, which is what puts
 * the mastery card out of reach.
 */
export function crossedOut(sheet: CharacterSheet, tier: Tier, kind: AdvancementKind): string | null {
  if (kind === 'multiclass') {
    if (hasMulticlassed(sheet)) return 'already multiclassed';
    if (takenInTier(sheet, tier, 'subclass') > 0) return `crossed out by the tier ${tier} subclass card`;
  }
  if (kind === 'subclass' && hasMulticlassed(sheet) && subclassStage(sheet) !== 'foundation') {
    return 'multiclassing crossed out the mastery card';
  }
  return null;
}

/** Traits raised by an advancement since the last clear. */
export function markedTraits(sheet: CharacterSheet): Set<Trait> {
  const marked = new Set<Trait>();
  for (const record of sheet.levels ?? []) {
    if (TRAIT_CLEAR_LEVELS.includes(record.level)) marked.clear();
    for (const advancement of record.advancements) {
      if (advancement.kind === 'traits') for (const trait of advancement.traits) marked.add(trait);
    }
  }
  return marked;
}

/** The subclass stage a sheet has reached: how many upgrade cards it has taken. */
export function subclassStage(sheet: CharacterSheet): 'foundation' | 'specialization' | 'mastery' {
  let upgrades = 0;
  for (const record of sheet.levels ?? []) {
    for (const advancement of record.advancements) if (advancement.kind === 'subclass') upgrades++;
  }
  return upgrades >= 2 ? 'mastery' : upgrades === 1 ? 'specialization' : 'foundation';
}

/** Every domain a character may draw cards from: the class's, plus a multiclass's chosen one. */
export function domainsOf(sheet: CharacterSheet, content: ContentPack): string[] {
  const domains = [...(content.classes.get(sheet.classId)?.domains ?? [])];
  for (const record of sheet.levels ?? []) {
    for (const advancement of record.advancements) {
      if (advancement.kind === 'multiclass' && !domains.includes(advancement.domain)) {
        domains.push(advancement.domain);
      }
    }
  }
  return domains;
}

/** Every domain card the sheet holds, from level 1 and each level since. */
export function heldCards(sheet: CharacterSheet): string[] {
  const cards = [...(sheet.domainCards ?? [])];
  for (const record of sheet.levels ?? []) {
    cards.push(record.domainCard);
    for (const advancement of record.advancements) {
      if (advancement.kind === 'domainCard') cards.push(advancement.card);
    }
  }
  return cards;
}

/** Whether a sheet may take a card: right domain, low enough level, not already held. */
export function cardAllowed(
  sheet: CharacterSheet,
  content: ContentPack,
  cardId: string,
  atLevel: number,
): { ok: true } | { ok: false; reason: string } {
  const card = content.domainCards.get(cardId);
  if (card === undefined) return { ok: false, reason: `unknown domain card "${cardId}"` };
  if (!domainsOf(sheet, content).includes(card.domain)) {
    return { ok: false, reason: `"${card.name}" is a ${card.domain} card, outside this character's domains` };
  }
  if (card.level > atLevel) return { ok: false, reason: `"${card.name}" is level ${card.level}` };
  if (heldCards(sheet).includes(cardId)) return { ok: false, reason: `"${card.name}" is already held` };
  return { ok: true };
}

/**
 * Options with a box still open at this level, and how many picks each costs:
 * this tier's sheet first, then whatever is left unmarked on the previous
 * tier's, each tagged with the sheet it sits on.
 */
export function availableAdvancements(sheet: CharacterSheet, atLevel: number): OfferedOption[] {
  const tier = tierOf(atLevel);
  const previous = previousTier(tier);
  const offered: OfferedOption[] = [];
  for (const from of previous === null ? [tier] : [tier, previous]) {
    for (const option of TIER_OPTIONS[from]) {
      if (crossedOut(sheet, from, option.kind) !== null) continue;
      const limit = option.limit - takenInTier(sheet, from, option.kind);
      if (limit > 0) offered.push({ ...option, limit, tier: from });
    }
  }
  return offered;
}

// ---------------------------------------------------------------------------
// Taking a level
// ---------------------------------------------------------------------------

/**
 * Level a sheet up by one, or say what is wrong with the plan.
 *
 * Nothing is applied unless the whole plan is legal — a level-up is one
 * decision, not five, and half of one would leave a sheet no rule describes.
 */
export function levelUp(
  sheet: CharacterSheet,
  content: ContentPack,
  plan: LevelUpPlan,
): { sheet: CharacterSheet; issues: LevelUpIssue[] } {
  const issues: LevelUpIssue[] = [];
  const fail = (field: string, message: string): void => void issues.push({ field, message });
  const next = sheet.level + 1;
  const tier = tierOf(next);

  if (sheet.level >= MAX_LEVEL) fail('level', `already at level ${MAX_LEVEL}`);

  // ---- the picks ----
  let spent = 0;
  const takenNow = new Map<string, number>();
  /** The cap on an extra card taken through a given pick, by its index in the plan. */
  const cardCaps = new Map<number, number>();
  plan.advancements.forEach((advancement, index) => {
    const from = advancement.fromTier ?? tier;
    if (from !== tier && from !== previousTier(tier)) {
      fail('advancements', `tier ${tier} cannot spend a box on the tier ${from} sheet`);
      return;
    }
    const option = TIER_OPTIONS[from].find((o) => o.kind === advancement.kind);
    if (option === undefined) {
      fail('advancements', `"${advancement.kind}" is not on the tier ${from} sheet`);
      return;
    }
    spent += option.cost;
    const crossed = crossedOut(sheet, from, advancement.kind);
    if (crossed !== null) fail('advancements', `"${advancement.kind}" on the tier ${from} sheet: ${crossed}`);
    const key = `${from}:${advancement.kind}`;
    const already = takenInTier(sheet, from, advancement.kind) + (takenNow.get(key) ?? 0);
    if (already >= option.limit) fail('advancements', `"${advancement.kind}" has no boxes left in tier ${from}`);
    takenNow.set(key, (takenNow.get(key) ?? 0) + 1);
    if (option.cardCap !== undefined) cardCaps.set(index, option.cardCap);
  });
  // A subclass card and a multiclass on the same sheet cross each other out.
  const kindsNow = new Set(plan.advancements.map((a) => a.kind));
  if (kindsNow.has('subclass') && kindsNow.has('multiclass')) {
    fail('advancements', 'an upgraded subclass card and a multiclass cross each other out');
  }
  if (spent !== PICKS_PER_LEVEL) {
    fail('advancements', `a level-up spends exactly ${PICKS_PER_LEVEL} picks; this plan spends ${spent}`);
  }

  // ---- each pick's own rule ----
  const marked = markedTraits(sheet);
  const bumpedNow = new Set<Trait>();
  plan.advancements.forEach((advancement, index) => {
    switch (advancement.kind) {
      case 'traits': {
        const [a, b] = advancement.traits;
        if (a === b) fail('traits', 'the two traits must differ');
        for (const trait of advancement.traits) {
          if (marked.has(trait) || bumpedNow.has(trait)) fail('traits', `${trait} is already marked`);
          bumpedNow.add(trait);
        }
        break;
      }
      case 'experiences': {
        const names = new Set((sheet.experiences ?? []).map((e) => e.name));
        for (const name of advancement.names) {
          if (!names.has(name)) fail('experiences', `no Experience named "${name}"`);
        }
        if (advancement.names[0] === advancement.names[1]) fail('experiences', 'the two Experiences must differ');
        break;
      }
      case 'domainCard': {
        const allowed = cardAllowed(sheet, content, advancement.card, Math.min(next, cardCaps.get(index) ?? next));
        if (!allowed.ok) fail('domainCard', allowed.reason);
        if (advancement.card === plan.domainCard) fail('domainCard', 'that is already the card this level grants');
        break;
      }
      case 'subclass':
        if (sheet.subclassId === undefined) fail('subclass', 'no subclass to upgrade');
        if (subclassStage(sheet) === 'mastery') fail('subclass', 'already at mastery');
        break;
      case 'multiclass': {
        const klass = content.classes.get(advancement.classId);
        if (klass === undefined) fail('multiclass', `unknown class "${advancement.classId}"`);
        else if (advancement.classId === sheet.classId) fail('multiclass', 'that is already this character\'s class');
        else if (!klass.domains.includes(advancement.domain)) {
          fail('multiclass', `${klass.name} does not have the ${advancement.domain} domain`);
        }
        if ((sheet.levels ?? []).some((r) => r.advancements.some((a) => a.kind === 'multiclass'))) {
          fail('multiclass', 'already multiclassed');
        }
        break;
      }
      default:
        break;
    }
  });

  // ---- the card every level grants ----
  const granted = cardAllowed(sheet, content, plan.domainCard, next);
  if (!granted.ok) fail('domainCard', granted.reason);

  // ---- the tier achievement ----
  const achievement = ACHIEVEMENT_LEVELS.includes(next);
  if (achievement && plan.experience === undefined) {
    fail('experience', `level ${next} grants a new Experience; name it`);
  }
  if (!achievement && plan.experience !== undefined) {
    fail('experience', `level ${next} does not grant an Experience`);
  }

  if (issues.length > 0) return { sheet, issues };

  const record: LevelRecord = {
    level: next,
    advancements: plan.advancements.map((a) => ({ ...a })),
    domainCard: plan.domainCard,
    ...(plan.experience === undefined ? {} : { experience: { ...plan.experience } }),
  };
  return {
    sheet: {
      ...sheet,
      level: next,
      proficiency: sheet.proficiency + (achievement ? 1 : 0) + (takenNow.get('proficiency') ?? 0),
      experiences: [
        ...(sheet.experiences ?? []),
        ...(plan.experience === undefined ? [] : [{ ...plan.experience }]),
      ],
      levels: [...(sheet.levels ?? []), record],
    },
    issues: [],
  };
}

/**
 * What a sheet's recorded levels add to the numbers. `deriveCharacter` reads
 * this; nothing else needs to know how the record is shaped.
 */
export function progressionBonuses(sheet: CharacterSheet): {
  traits: Partial<Record<Trait, number>>;
  hitPoints: number;
  stress: number;
  evasion: number;
  experiences: Record<string, number>;
} {
  const traits: Partial<Record<Trait, number>> = {};
  const experiences: Record<string, number> = {};
  let hitPoints = 0;
  let stress = 0;
  let evasion = 0;
  for (const record of sheet.levels ?? []) {
    for (const advancement of record.advancements) {
      switch (advancement.kind) {
        case 'traits':
          for (const trait of advancement.traits) traits[trait] = (traits[trait] ?? 0) + 1;
          break;
        case 'hitPoint':
          hitPoints++;
          break;
        case 'stress':
          stress++;
          break;
        case 'evasion':
          evasion++;
          break;
        case 'experiences':
          for (const name of advancement.names) experiences[name] = (experiences[name] ?? 0) + 1;
          break;
        default:
          break;
      }
    }
  }
  return { traits, hitPoints, stress, evasion, experiences };
}
