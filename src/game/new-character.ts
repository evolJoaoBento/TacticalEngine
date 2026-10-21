/**
 * A character made at New Game: what was chosen, card by card, as a sheet.
 *
 * The wizard asks for the ancestry, the model that draws them, the community, the class, the
 * subclass, two level-1 domain cards, the traits and a name (`ui/NewGame.tsx`). The traits are the
 * SRD's starting spread, +2 +1 +1 +0 +0 −1, shared out among the six by the player (`swapTraits`
 * keeps it that spread); they start where the class leans (`SPREADS`, `suggestedTraits`). What the
 * wizard does not ask, this fills in, the engine's own choice, to be changed afterwards in Edit Game
 * like anything on a sheet:
 *
 *   - traits, when none were shared out: the class's suggestion
 *   - gear, when none was chosen from the table (`startingWeapons`, `startingArmors`: the catalogue's
 *     tier-1 primary weapons - a magic one only for a character who casts - and armour, the class's
 *     suggestion first): a weapon, sometimes a second, and armour from the equipment catalogue that suit the
 *     class (`GEAR`)
 *
 * A class the tables do not name - one a project brings of its own - gets the spread in trait
 * order and no gear.
 */

import { blankSheet, type CharacterSheet, type Traits } from '../engine/character/sheet';
import type { Trait } from '../engine/scene/schema';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import { characterSheetSchema } from '../engine/character/sheet-schema';

/** What the wizard asks for. */
export interface Creation {
  name: string;
  ancestryId: string;
  /** The model the character is drawn with. */
  model: string;
  communityId: string;
  classId: string;
  subclassId: string;
  /** The two level-1 domain cards chosen. */
  domainCards: string[];
  /** The traits shared out; the class's suggestion when there are none, or they are not the starting spread. */
  traits?: Traits;
  /** The weapon and armour chosen at the table, by catalogue id; the class's suggestion for either not chosen. */
  primaryWeaponId?: string;
  armorId?: string;
}

/** The six traits, in the order a sheet prints them. */
export const TRAIT_ORDER: readonly Trait[] = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];

/** What each trait is rolled for, as the SRD names it. */
export const TRAIT_VERBS: Readonly<Record<Trait, readonly string[]>> = {
  agility: ['Sprint', 'Leap', 'Maneuver'],
  strength: ['Lift', 'Smash', 'Grapple'],
  finesse: ['Control', 'Hide', 'Tinker'],
  instinct: ['Perceive', 'Sense', 'Navigate'],
  presence: ['Charm', 'Perform', 'Deceive'],
  knowledge: ['Recall', 'Analyze', 'Comprehend'],
};

/** The modifiers a new character shares out among the six traits, one each. */
export const STARTING_SPREAD: readonly number[] = [2, 1, 1, 0, 0, -1];

/** Whether traits are the starting spread: the six modifiers, one to each trait. */
export function isStartingSpread(traits: Traits): boolean {
  const values = TRAIT_ORDER.map((trait) => traits[trait]).sort((a, b) => b - a);
  return values.every((value, i) => value === STARTING_SPREAD[i]);
}

/** Two traits' modifiers traded: the spread stays the spread, whichever two are traded. */
export function swapTraits(traits: Traits, a: Trait, b: Trait): Traits {
  return { ...traits, [a]: traits[b], [b]: traits[a] };
}

const spread = (agility: number, strength: number, finesse: number, instinct: number, presence: number, knowledge: number): Traits => ({
  agility,
  strength,
  finesse,
  instinct,
  presence,
  knowledge,
});

/** Each class's traits: +2 +1 +1 0 0 −1, the higher where the class does its work. The engine's choice. */
export const SPREADS: Readonly<Record<string, Traits>> = {
  bard: spread(0, -1, 1, 0, 2, 1),
  druid: spread(1, 0, 1, 2, -1, 0),
  guardian: spread(1, 2, -1, 0, 1, 0),
  ranger: spread(2, 0, 1, 1, -1, 0),
  rogue: spread(1, -1, 2, 0, 1, 0),
  seraph: spread(0, 2, 0, 1, 1, -1),
  sorcerer: spread(0, -1, 1, 2, 1, 0),
  warrior: spread(2, 1, 0, 1, -1, 0),
  wizard: spread(-1, 0, 0, 1, 1, 2),
};

/** The traits a class starts with before the player moves them: its suggestion, or the spread in trait order. */
export function suggestedTraits(classId: string | undefined): Traits {
  return { ...((classId === undefined ? undefined : SPREADS[classId]) ?? spread(2, 1, 1, 0, 0, -1)) };
}

/**
 * The trait that matters most to a character: the one their subclass casts spells with, or - for a class
 * that casts none - the one the class leans on hardest, where its suggestion puts the +2.
 */
export function keyTrait(classId: string | undefined, spellcastTrait?: Trait): Trait {
  if (spellcastTrait !== undefined) return spellcastTrait;
  const suggested = suggestedTraits(classId);
  return TRAIT_ORDER.find((trait) => suggested[trait] === 2) ?? TRAIT_ORDER[0]!;
}

/** What each class sets out with, from the equipment catalogue. The engine's choice. */
export const GEAR: Readonly<Record<string, { primary: string; secondary?: string; armor: string }>> = {
  bard: { primary: 'primary-rapier', secondary: 'secondary-small-dagger', armor: 'armor-gambeson-armor' },
  druid: { primary: 'primary-shortstaff', armor: 'armor-leather-armor' },
  guardian: { primary: 'primary-battleaxe', armor: 'armor-chainmail-armor' },
  ranger: { primary: 'primary-shortbow', armor: 'armor-leather-armor' },
  rogue: { primary: 'primary-dagger', secondary: 'secondary-small-dagger', armor: 'armor-gambeson-armor' },
  seraph: { primary: 'primary-hallowed-axe', secondary: 'secondary-round-shield', armor: 'armor-chainmail-armor' },
  sorcerer: { primary: 'primary-dualstaff', armor: 'armor-gambeson-armor' },
  warrior: { primary: 'primary-longsword', armor: 'armor-chainmail-armor' },
  wizard: { primary: 'primary-greatstaff', armor: 'armor-leather-armor' },
};

/**
 * The primary weapons a new character may start with: the catalogue's tier-1 ones, a magic one only
 * for a character whose subclass casts, and the class's suggestion first.
 */
export function startingWeapons(classId: string | undefined, casts: boolean): string[] {
  const suggested = classId === undefined ? undefined : GEAR[classId]?.primary;
  const ids = EQUIPMENT.weapons
    .filter((weapon) => weapon.tier === 1 && (weapon.slot === 'primaryPhysical' || (weapon.slot === 'primaryMagic' && casts)))
    .map((weapon) => weapon.id);
  return suggested !== undefined && ids.includes(suggested) ? [suggested, ...ids.filter((id) => id !== suggested)] : ids;
}

/** The armour a new character may start with: the catalogue's tier-1, the class's suggestion first. */
export function startingArmors(classId: string | undefined): string[] {
  const suggested = classId === undefined ? undefined : GEAR[classId]?.armor;
  const ids = EQUIPMENT.armors.filter((armor) => armor.tier === 1).map((armor) => armor.id);
  return suggested !== undefined && ids.includes(suggested) ? [suggested, ...ids.filter((id) => id !== suggested)] : ids;
}

/** Whether a catalogue id is an armour's, rather than a weapon's. */
export function isArmor(id: string): boolean {
  return EQUIPMENT.armors.some((armor) => armor.id === id);
}

/** An id from a name: lower case, words joined by hyphens, nothing else; `hero` when that leaves nothing. */
export function idFromName(name: string): string {
  const id = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return id === '' ? 'hero' : id;
}

/** The sheet for what was chosen. */
export function sheetFor(creation: Creation): CharacterSheet {
  const suggested = GEAR[creation.classId];
  const primary = creation.primaryWeaponId ?? suggested?.primary;
  const armor = creation.armorId ?? suggested?.armor;
  // The class's second weapon goes with its first; with another first, only if that one leaves a hand free.
  const oneHanded = EQUIPMENT.weapons.find((weapon) => weapon.id === primary)?.burden === 'oneHanded';
  const secondary = primary === suggested?.primary || oneHanded ? suggested?.secondary : undefined;
  return characterSheetSchema.parse(
    blankSheet(idFromName(creation.name), creation.classId, {
      name: creation.name.trim(),
      ancestryId: creation.ancestryId,
      communityId: creation.communityId,
      subclassId: creation.subclassId,
      traits: creation.traits !== undefined && isStartingSpread(creation.traits) ? { ...creation.traits } : suggestedTraits(creation.classId),
      domainCards: [...creation.domainCards],
      model: creation.model,
      ...(primary === undefined ? {} : { primaryWeaponId: primary }),
      ...(armor === undefined ? {} : { armorId: armor }),
      ...(secondary === undefined ? {} : { secondaryWeaponId: secondary }),
    }),
  );
}
