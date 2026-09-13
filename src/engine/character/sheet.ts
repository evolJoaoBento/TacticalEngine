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
import { isDomainCard, type CardDef, type CardGrant, type DomainCardDef, type ContentPack, type SubclassDef, type WeaponDef } from '../content/pack/import';
import { armorScore, pcThresholds, type DamageThresholds } from '../rules/damage';
import type { ParsedDamage } from '../rules/dice';
import type { RangeBand } from '../rules/range';
import {
  MAX_GOOD,
  MAX_SLOTS,
  STARTING_GOOD,
  createGood,
  createMarkPool,
  STARTING_STRESS_SLOTS,
  type Currency,
  type MarkPool,
} from '../rules/resources';
import type { Trait } from '../scene/schema';
import { heldCards, progressionBonuses, subclassStage, tierOf, type LevelRecord } from './progression';
import { abilitiesFor, type AbilityDef, type AbilityModifier } from '../content/abilities';

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
  /** Content ids into `ContentPack`. */
  classId: string;
  ancestryId?: string;
  communityId?: string;
  traits: Traits;
  /** Multiplies weapon damage dice. Level 1 is 1. */
  proficiency: number;
  primaryWeaponId?: string;
  secondaryWeaponId?: string;
  armorId?: string;
  /** Experiences, each spendable for a Light: "Tremor Sense +2". */
  experiences?: readonly { name: string; modifier: number }[];
  /** The subclass chosen at level 1. Its stage is read off `levels`. */
  subclassId?: string;
  /** Domain cards taken at level 1 (the SRD grants two). */
  domainCards?: readonly string[];
  /**
   * The cards in the loadout, at most five. Left out, the first five held are
   * active. `content/abilities.ts` reads it; a rest or a Recall Cost changes it.
   */
  loadout?: readonly string[];
  /** Every level taken since 1, in order. `progression.ts` reads and writes this. */
  levels?: readonly LevelRecord[];
  /**
   * Light slots crossed out for good, one per scar taken on Avoid Death.
   * "If you ever cross out your last Light slot, your character's journey ends."
   */
  scars?: number;
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
  /** The subclass, when the sheet names one the content has. */
  subclass?: SubclassDef;
  /** The trait a Spellcast Roll uses, from the subclass. Absent for a class that does not cast. */
  spellcastTrait?: Trait;
  /** Every card chosen and held: the two from level 1 and one per level since. */
  cards: readonly DomainCardDef[];
  /**
   * The cards in play without being chosen: the class's, the subclass's up to the stage reached,
   * the ancestry's, the community's, and any a project handed to this character by id. In the
   * content's order.
   */
  granted: readonly CardDef[];
  /**
   * The modifiers the character's abilities grant, those whose `requires` the
   * sheet meets. The ones with no `when` are already folded into the numbers
   * below; the rest are read at roll time against the scene.
   */
  modifiers: readonly AbilityModifier[];
  /** Proficiency with every bonus folded in. */
  proficiency: number;
  /** The sheet's traits with every recorded advancement folded in. */
  traits: Traits;
  /** Experiences with their advancement bumps folded in. */
  experiences: readonly { name: string; modifier: number }[];
  /** "Any roll made against a PC has a Difficulty equal to the target's Evasion." */
  evasion: number;
  /** Armor's base thresholds plus the character's level. */
  thresholds: DamageThresholds;
  /** Armor Slots available, capped at 12. */
  armorScore: number;
  hitPoints: number;
  stress: number;
  good: Currency;
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
  content: ContentPack,
  abilities: readonly AbilityDef[] = [],
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
  let subclass: SubclassDef | undefined;
  if (sheet.subclassId !== undefined) {
    subclass = content.subclasses.get(sheet.subclassId);
    if (subclass === undefined) miss('subclass', sheet.subclassId);
    else if (subclass.classId !== sheet.classId) {
      issues.push({
        sheet: sheet.id,
        field: 'subclass',
        message: `subclass "${sheet.subclassId}" belongs to ${subclass.classId}, not ${sheet.classId}`,
      });
    }
  }
  const cards: DomainCardDef[] = [];
  for (const id of heldCards(sheet)) {
    const card = content.cards.get(id);
    if (card === undefined) miss('domainCard', id);
    else if (!isDomainCard(card)) {
      // A granted card is in play because of what the character is; holding it as well would
      // put it in the loadout a second time.
      issues.push({ sheet: sheet.id, field: 'domainCard', message: `"${id}" is not a card a character chooses` });
    } else cards.push(card);
  }
  const granted = grantedCards(sheet, content.cards.values());
  // What the recorded levels add. Experiences fold in below; traits fold into
  // the sheet's own map so a check reads the grown number.
  const grown = progressionBonuses(sheet);

  const traits: Traits = { ...sheet.traits };
  for (const trait of Object.keys(grown.traits) as Trait[]) traits[trait] += grown.traits[trait] ?? 0;
  const experiences = (sheet.experiences ?? []).map((e) => ({
    ...e,
    modifier: e.modifier + (grown.experiences[e.name] ?? 0),
  }));

  // What the held abilities add. `requires` is the sheet's to answer here;
  // `when` is the scene's, so those wait for the roll.
  const held = abilitiesFor({ sheet, cards, granted }, abilities);
  const modifiers = held
    .flatMap((ability) => ability.modifiers)
    .filter((m) => m.requires === undefined || m.requires === 'meleeWeapon' || (m.requires === 'armored') === (armor !== undefined));
  // Proficiency first, because a modifier may add it to something else: Rise
  // Up's Severe threshold is "equal to your Proficiency", and a card that
  // raised the Proficiency itself has to be counted before that is read.
  const proficiency = Math.max(
    1,
    sheet.proficiency +
      modifiers
        .filter((m) => m.stat === 'proficiency' && m.when === undefined && m.perToken === undefined && m.requires !== 'meleeWeapon')
        .reduce((sum, m) => sum + m.bonus, 0),
  );
  // A bonus that counts tokens is never folded in: the tokens are on the table
  // rather than on the sheet, and the number changes while the fight is on.
  const folded = (stat: AbilityModifier['stat']): number =>
    modifiers
      .filter((m) => m.stat === stat && m.when === undefined && m.perToken === undefined && m.requires !== 'meleeWeapon')
      .reduce(
        (sum, m) =>
          sum + m.bonus + traitPart(m, traits) + (m.plusProficiency === true ? proficiency : 0),
        0,
      );

  // "A PC's damage thresholds are calculated by adding their level to the listed
  // damage thresholds of their equipped armor." Unarmoured is level / twice level —
  // unless Bare Bones rewrites the base.
  const bareBones = armor === undefined && modifiers.some((m) => m.stat === 'bareBones' && m.when === undefined);
  const base = pcThresholds(sheet.level, bareBones ? BARE_BONES_THRESHOLDS[tierOf(sheet.level)] : (armor?.baseThresholds ?? null));
  const thresholds: DamageThresholds = {
    major: base.major + (bonuses.majorThreshold ?? 0) + folded('majorThreshold') + folded('thresholds'),
    severe: base.severe + (bonuses.severeThreshold ?? 0) + folded('severeThreshold') + folded('thresholds'),
  };

  const character: DerivedCharacter = {
    sheet,
    ...(subclass === undefined ? {} : { subclass }),
    ...(subclass?.spellcastTrait === undefined ? {} : { spellcastTrait: subclass.spellcastTrait }),
    cards,
    granted,
    modifiers,
    proficiency,
    traits,
    experiences,
    evasion: (klass?.startingEvasion ?? 10) + (bonuses.evasion ?? 0) + grown.evasion + folded('evasion'),
    thresholds,
    // "While unarmored, your character's base Armor Score is 0." Bare Bones: 3 + Strength.
    armorScore: armorScore(bareBones ? 3 + traits.strength : (armor?.baseScore ?? 0), (bonuses.armorScore ?? 0) + folded('armorScore')),
    hitPoints: Math.min(
      MAX_SLOTS,
      (klass?.startingHitPoints ?? 5) + (bonuses.hitPoints ?? 0) + grown.hitPoints + folded('hitPoints'),
    ),
    stress: Math.min(MAX_SLOTS, STARTING_STRESS_SLOTS + (bonuses.stress ?? 0) + grown.stress + folded('stress')),
    // A scar is permanent, so it is the sheet that carries it and every scene
    // the character walks into starts a Light short.
    good: createGood(STARTING_GOOD, Math.max(0, MAX_GOOD - (sheet.scars ?? 0))),
    ...(primaryWeapon === undefined ? {} : { primaryWeapon }),
    ...(secondaryWeapon === undefined ? {} : { secondaryWeapon }),
  };
  return { character, issues };
}

const STAGE_ORDER = ['foundation', 'specialization', 'mastery'] as const;

/**
 * The cards in play for a sheet without being chosen: whatever grants a card to its class, to its
 * subclass up to the stage reached, to its ancestry, to its community, or to it by name. In the
 * order the cards come.
 *
 * `deriveCharacter` asks once, to fold passive bonuses into the numbers. The world and the action
 * bar ask again every time they read, against the content as it stands: a card handed to somebody
 * after their sheet was derived is in their hands at once, as an ability written into a project
 * always was.
 */
export function grantedCards(sheet: CharacterSheet, cards: Iterable<CardDef>): CardDef[] {
  const reached = STAGE_ORDER.indexOf(subclassStage(sheet));
  return [...cards].filter((card) => grantedTo(card.grant, sheet, reached));
}

/** Whether a card's grant puts it in play for this sheet. A chosen card is the loadout's to say. */
function grantedTo(grant: CardGrant, sheet: CharacterSheet, reached: number): boolean {
  switch (grant.kind) {
    case 'chosen':
      return false;
    case 'class':
      return grant.classId === sheet.classId;
    case 'subclass':
      return grant.subclassId === sheet.subclassId && STAGE_ORDER.indexOf(grant.stage) <= reached;
    case 'ancestry':
      return grant.ancestryId === sheet.ancestryId;
    case 'community':
      return grant.communityId === sheet.communityId;
    case 'given':
      return grant.characters.includes(sheet.id);
    case 'adversary':
      return false;
  }
}

function lookupWeapon(
  id: string | undefined,
  content: ContentPack,
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

/** Bare Bones' base thresholds by tier: "Tier 1: 9/19, Tier 2: 11/24, Tier 3: 13/31, Tier 4: 15/38". */
const BARE_BONES_THRESHOLDS: Readonly<Record<1 | 2 | 3 | 4, DamageThresholds>> = {
  1: { major: 9, severe: 19 },
  2: { major: 11, severe: 24 },
  3: { major: 13, severe: 31 },
  4: { major: 15, severe: 38 },
};

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
  // The derived traits, so an advancement that raised Strength raises the swing.
  const traits = character.traits;

  if (weapon === undefined) {
    return {
      kind: 'pc',
      name: 'Unarmed',
      modifier: { count: 0, sides: 0, modifier: traits[UNARMED.trait] },
      trait: UNARMED.trait,
      range: UNARMED.range,
      damage: UNARMED.damage,
      proficiency: character.proficiency,
    };
  }

  return {
    kind: 'pc',
    name: weapon.name,
    // The attack modifier is the weapon's trait; features that add to it are
    // applied by the caller as `AttackOptions.bonus`, so this stays the sheet's.
    modifier: { count: 0, sides: 0, modifier: traits[weapon.trait] },
    trait: weapon.trait,
    range: weapon.range,
    damage: weapon.damage,
    proficiency: character.proficiency,
  };
}

/**
 * What a modifier's trait half is worth: the trait, or half of it rounded up.
 *
 * Rounded up because the SRD rounds up wherever it divides, and read the same
 * way here and in the world so a folded bonus and a scene-dependent one agree.
 */
export function traitPart(modifier: Pick<AbilityModifier, 'plusTrait' | 'halveTrait'>, traits: Traits): number {
  if (modifier.plusTrait === undefined) return 0;
  const value = traits[modifier.plusTrait];
  return modifier.halveTrait === true ? Math.ceil(value / 2) : value;
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
  good: Currency;
} {
  return {
    hitPoints: createMarkPool(character.hitPoints),
    stress: createMarkPool(character.stress),
    armorSlots: createMarkPool(character.armorScore),
    good: { ...character.good },
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
