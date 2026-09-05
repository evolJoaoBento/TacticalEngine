/**
 * Character sheets: where a class, an ancestry and a pile of equipment become the
 * numbers the rules already consume.
 *
 * Until now the demo carried three hard-coded literals — an Evasion, a weapon
 * string, a hit-point count — which is fine for a fight test and useless for an
 * engine. A sheet is authored content: it names a class, an ancestry, a community
 * and some equipment by id, and every derived value falls out of those.
 *
 * The derivations are the SRD's, and each cites where it comes from, because they
 * are exactly the numbers `damage.ts`, `duality.ts` and `attack.ts` were built to
 * take: armor sets the thresholds and the Armor Slots, the class sets Evasion and
 * Hit Points, a weapon sets the trait rolled, the range band and the dice
 * Proficiency multiplies.
 *
 * DOM-free and content-driven: a sheet plus the SRD content is enough to produce
 * an attack profile, and nothing here knows what a renderer is.
 */

import type { AttackProfile, DefenderProfile } from '../combat/attack';
import type { SrdCharacterContent, WeaponDef } from '../content/srd/daggersearch';
import { armorScore, pcThresholds, type DamageThresholds } from '../rules/damage';
import type { ParsedDamage } from '../rules/dice';
import type { RangeBand } from '../rules/range';
import {
  MAX_SLOTS,
  createHope,
  createMarkPool,
  STARTING_STRESS_SLOTS,
  type Currency,
  type MarkPool,
} from '../rules/resources';
import type { Trait } from '../scene/schema';

/** The six traits, at the SRD's starting spread of +2 +1 +1 +0 +0 −1. */
export type Traits = Record<Trait, number>;

export const ZERO_TRAITS: Traits = {
  agility: 0,
  strength: 0,
  finesse: 0,
  instinct: 0,
  presence: 0,
  knowledge: 0,
};

/** Authored: what a character *is*. Runtime marks live in `SceneState`. */
export interface CharacterSheet {
  id: string;
  name: string;
  level: number;
  /** Content ids into `SrdCharacterContent`. */
  classId: string;
  ancestryId?: string;
  communityId?: string;
  traits: Traits;
  /** Multiplies weapon damage dice. Level 1 is 1. */
  proficiency: number;
  primaryWeaponId?: string;
  secondaryWeaponId?: string;
  armorId?: string;
  /** Experiences, each spendable for a Hope: "Tremor Sense +2". */
  experiences?: readonly { name: string; modifier: number }[];
  /** Flat adjustments from advancements, features or items. */
  bonuses?: {
    evasion?: number;
    hitPoints?: number;
    stress?: number;
    armorScore?: number;
    majorThreshold?: number;
    severeThreshold?: number;
  };
}

/** Everything derived from a sheet, computed once per change rather than per read. */
export interface DerivedCharacter {
  sheet: CharacterSheet;
  /** "Any roll made against a PC has a Difficulty equal to the target's Evasion." */
  evasion: number;
  /** Armor's base thresholds plus the character's level. */
  thresholds: DamageThresholds;
  /** Armor Slots available, capped at 12. */
  armorScore: number;
  hitPoints: number;
  stress: number;
  hope: Currency;
  primaryWeapon?: WeaponDef;
  secondaryWeapon?: WeaponDef;
}

export interface SheetIssue {
  sheet: string;
  field: string;
  message: string;
}

/**
 * Work out a character's numbers.
 *
 * Unknown content ids are reported rather than thrown, because a party with one
 * bad weapon reference should still be playable — the character simply fights
 * unarmed, which is a rule the SRD has anyway.
 */
export function deriveCharacter(
  sheet: CharacterSheet,
  content: SrdCharacterContent,
): { character: DerivedCharacter; issues: SheetIssue[] } {
  const issues: SheetIssue[] = [];
  const miss = (field: string, id: string): void => {
    issues.push({ sheet: sheet.id, field, message: `unknown ${field} "${id}"` });
  };

  const klass = content.classes.get(sheet.classId);
  if (klass === undefined) miss('class', sheet.classId);
  if (sheet.ancestryId !== undefined && !content.ancestries.has(sheet.ancestryId)) {
    miss('ancestry', sheet.ancestryId);
  }
  if (sheet.communityId !== undefined && !content.communities.has(sheet.communityId)) {
    miss('community', sheet.communityId);
  }

  const armor = sheet.armorId === undefined ? undefined : content.armors.get(sheet.armorId);
  if (sheet.armorId !== undefined && armor === undefined) miss('armor', sheet.armorId);

  const primaryWeapon = lookupWeapon(sheet.primaryWeaponId, content, sheet, issues, 'primaryWeapon');
  const secondaryWeapon = lookupWeapon(
    sheet.secondaryWeaponId,
    content,
    sheet,
    issues,
    'secondaryWeapon',
  );

  const bonuses = sheet.bonuses ?? {};
  // "A PC's damage thresholds are calculated by adding their level to the listed
  // damage thresholds of their equipped armor." Unarmoured is level / twice level.
  const base = pcThresholds(sheet.level, armor?.baseThresholds ?? null);
  const thresholds: DamageThresholds = {
    major: base.major + (bonuses.majorThreshold ?? 0),
    severe: base.severe + (bonuses.severeThreshold ?? 0),
  };

  const character: DerivedCharacter = {
    sheet,
    evasion: (klass?.startingEvasion ?? 10) + (bonuses.evasion ?? 0),
    thresholds,
    // "While unarmored, your character's base Armor Score is 0."
    armorScore: armorScore(armor?.baseScore ?? 0, bonuses.armorScore ?? 0),
    hitPoints: Math.min(
      MAX_SLOTS,
      (klass?.startingHitPoints ?? 5) + (bonuses.hitPoints ?? 0),
    ),
    stress: Math.min(MAX_SLOTS, STARTING_STRESS_SLOTS + (bonuses.stress ?? 0)),
    hope: createHope(),
    ...(primaryWeapon === undefined ? {} : { primaryWeapon }),
    ...(secondaryWeapon === undefined ? {} : { secondaryWeapon }),
  };
  return { character, issues };
}

function lookupWeapon(
  id: string | undefined,
  content: SrdCharacterContent,
  sheet: CharacterSheet,
  issues: SheetIssue[],
  field: string,
): WeaponDef | undefined {
  if (id === undefined) return undefined;
  const weapon = content.weapons.get(id);
  if (weapon === undefined) {
    issues.push({ sheet: sheet.id, field, message: `unknown ${field} "${id}"` });
  }
  return weapon;
}

/** "Successful unarmed attacks inflict [Proficiency]d4 damage." */
export const UNARMED: { damage: ParsedDamage; range: RangeBand; trait: Trait } = {
  damage: { count: 1, sides: 4, modifier: 0, types: ['physical'] },
  range: 'melee',
  trait: 'strength',
};

/**
 * The attack a character makes with a weapon, ready for `resolveAttack`.
 *
 * "The trait that applies to an attack roll is specified by the weapon or spell
 * being used", and a character with no weapon punches: "Unarmed attack rolls use
 * either Strength or Finesse (GM's choice)."
 */
export function attackProfile(
  character: DerivedCharacter,
  which: 'primary' | 'secondary' = 'primary',
): AttackProfile {
  const weapon = which === 'primary' ? character.primaryWeapon : character.secondaryWeapon;
  const traits = character.sheet.traits;

  if (weapon === undefined) {
    return {
      kind: 'pc',
      name: 'Unarmed',
      modifier: { count: 0, sides: 0, modifier: traits[UNARMED.trait] },
      range: UNARMED.range,
      damage: UNARMED.damage,
      proficiency: character.sheet.proficiency,
    };
  }

  return {
    kind: 'pc',
    name: weapon.name,
    // The attack modifier is the weapon's trait; features that add to it are
    // applied by the caller as `AttackOptions.bonus`, so this stays the sheet's.
    modifier: { count: 0, sides: 0, modifier: traits[weapon.trait] },
    range: weapon.range,
    damage: weapon.damage,
    proficiency: character.sheet.proficiency,
  };
}

/** How this character is attacked: Evasion, thresholds and their armor. */
export function defenderProfile(character: DerivedCharacter): DefenderProfile {
  return { difficulty: character.evasion, thresholds: character.thresholds };
}

/** The starting pools for a character entering a scene. */
export function startingPools(character: DerivedCharacter): {
  hitPoints: MarkPool;
  stress: MarkPool;
  armorSlots: MarkPool;
  hope: Currency;
} {
  return {
    hitPoints: createMarkPool(character.hitPoints),
    stress: createMarkPool(character.stress),
    armorSlots: createMarkPool(character.armorScore),
    hope: { ...character.hope },
  };
}

/** A sheet with the SRD's level-1 defaults, for a quick character or a test. */
export function blankSheet(id: string, classId: string, overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    id,
    name: id,
    level: 1,
    classId,
    traits: { ...ZERO_TRAITS },
    proficiency: 1,
    ...overrides,
  };
}
