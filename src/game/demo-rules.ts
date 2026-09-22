/**
 * The demo's house rules and its cast: the range bands, the movement, the
 * models, the stat blocks and the character content it plays with, and the
 * three sheets the party starts as. Numbers and content only; nothing here
 * runs, and nothing here reads the game.
 */

import { blankSheet, type CharacterSheet } from '../engine/character/sheet';
import { STARTER_ADVERSARIES, STARTER_CHARACTERS } from '../engine/content/pack/starter';
import type { AdversaryDef } from '../engine/content/types';
import { DEFAULT_MOVEMENT, type MovementRules } from '../engine/grid/pathfinding';
import { DEFAULT_WALK, type WalkRules } from '../engine/grid/walk';
import { DEFAULT_JUMP_RULES, type JumpRules } from '../engine/rules/jump';

/** Adversary stat blocks, keyed by content id, from the pack the engine ships with. */
export const DEMO_ADVERSARIES: ReadonlyMap<string, AdversaryDef> = STARTER_ADVERSARIES;

/**
 * The prototype's creature types are its own homebrew, and the starter pack has
 * no stat block under those names, so the demo stands one of its own in their
 * place — the same substitution the end-to-end combat test makes.
 *
 * Every creature the legacy map places currently becomes this one. Giving the
 * map's three types a stat block each is a small change to `LEGACY_ADVERSARY_IDS`
 * and would put the variety back.
 */
export const DEMO_ADVERSARY_ID = 'hollow-knight';

/** The way out of the vault, added by the demo because the legacy map had none. */
export const DEMO_STAIR_ID = 'stair-down';

/**
 * One of each stat block, stood along the vault's back wall to be looked at and never fought.
 *
 * The east wall, because it is the far side of the room from the door: the fight happens between
 * the door and the husks, and a row of bystanders there would be stood in the middle of it. Row 9
 * is left out -- the stair down is on the tile beside it, and nothing should stand in its mouth.
 */
export const DEMO_LINE_UP_ID = 'line-up';
export const DEMO_LINE_UP_X = 21;
export const DEMO_LINE_UP_ROWS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 10, 11, 12];

/** Tight bands, so a 22x16 map spans more than one of them. */
export const DEMO_BAND_TILES = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

/**
 * The Agility Roll a fighter makes to get farther than one move in a fight: Movement Under
 * Pressure. The rules leave the number to the GM; this is the demo's.
 */
export const DEMO_MOVE_DIFFICULTY = 12;

/**
 * Nobody walks in an L on a battlemap: every creature in the demo steps
 * diagonally, at the price of a diagonal, and does not cut a corner it could
 * not squeeze through.
 */
export const DEMO_MOVEMENT: MovementRules = { ...DEFAULT_MOVEMENT, diagonals: true, diagonalCostMultiplier: Math.SQRT2 };

/** The body a creature in the demo walks with. */
export const DEMO_WALK: WalkRules = { ...DEFAULT_WALK, maxStepHeight: DEMO_MOVEMENT.maxStepHeight };

/** The jump rules a project plays by: its own, or the engine's where it has said nothing. */
export const jumpRulesFor = (project?: { jump?: JumpRules | undefined }): JumpRules => project?.jump ?? DEFAULT_JUMP_RULES;

/** How everybody in a project's rooms steps: the demo's way, with a step as high as the project's jump rules say. */
export const movementFor = (project?: { jump?: JumpRules | undefined }): MovementRules => ({ ...DEMO_MOVEMENT, maxStepHeight: jumpRulesFor(project).stepHeight });

/** The body they walk with, stepping as high. */
export const walkFor = (project?: { jump?: JumpRules | undefined }): WalkRules => ({ ...DEMO_WALK, maxStepHeight: jumpRulesFor(project).stepHeight });

/**
 * Which model an entity uses. Party members carry a class name and adversaries an
 * SRD content id; neither is a model id, so the demo maps them.
 */
export const DEMO_MODELS: Readonly<Record<string, string>> = {
  // The starter pack's three classes, on the hero bodies the library has. A
  // class without a line here would stand as the magenta placeholder - which is
  // the library's honest "asked for a model I do not have", so this is a map to
  // keep complete rather than a fallback to hide behind.
  sentinel: 'knight',
  cutpurse: 'rogue',
  emberwright: 'mage',
  // Its adversaries, each drawn with the file of its own name in `public/models`.
  // One with no file there would keep the stand-in body, because `fallbackFor`
  // answers for adversaries in `main.ts`; the set is complete, so none does.
  'bandit-archer': 'bandit-archer',
  'bandit-captain': 'bandit-captain',
  'bandit-cutter': 'bandit-cutter',
  'briar-wraith': 'briar-wraith',
  'fen-lurker': 'fen-lurker',
  'grave-moth': 'grave-moth',
  'hollow-knight': 'hollow-knight',
  'rot-hound': 'rot-hound',
  'stone-golem': 'stone-golem',
  'wandering-hedge-priest': 'wandering-hedge-priest',
};

/** Classes, ancestries, communities, armor and weapons, from the pack we ship. */
export const DEMO_CHARACTERS = STARTER_CHARACTERS;

/**
 * The demo party, as authored character sheets.
 *
 * Everything mechanical — Evasion, Hit Points, damage thresholds, Armor Slots and
 * the trait each attack rolls — is derived from the class, ancestry and equipment
 * these name, rather than written down here.
 */
export const PARTY_SHEETS: readonly CharacterSheet[] = [
  blankSheet('kara', 'sentinel', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    ancestryId: 'stoneborn',
    communityId: 'wayfarer',
    armorId: 'ringmail',
    primaryWeaponId: 'longsword',
    subclassId: 'shieldbearer',
    domainCards: ['power-slash', 'iron-stance'],
    experiences: [{ name: 'Held the line', modifier: 2 }],
    // A body of her own rather than the class's. `DEMO_MODELS` still answers for any
    // character who names none, so this is a choice and not a new requirement.
    model: 'quim',
  }),
  blankSheet('finn', 'cutpurse', {
    name: 'Finn',
    traits: { agility: 2, strength: -1, finesse: 2, instinct: 1, presence: 0, knowledge: 0 },
    ancestryId: 'sylvan',
    communityId: 'guildsworn',
    armorId: 'padded-coat',
    primaryWeaponId: 'hunting-bow',
    subclassId: 'lampsnuffer',
    domainCards: ['quick-hands', 'backstab'],
    experiences: [{ name: 'Knows a locksmith', modifier: 2 }],
    model: 'violet',
  }),
  blankSheet('mira', 'emberwright', {
    name: 'Mira',
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 2 },
    ancestryId: 'human',
    communityId: 'guildsworn',
    armorId: 'padded-coat',
    primaryWeaponId: 'ember-staff',
    subclassId: 'flamecaller',
    domainCards: ['arcane-ward', 'healing-word'],
    experiences: [{ name: 'Read the old script', modifier: 2 }],
    model: 'scarlet',
  }),
];
