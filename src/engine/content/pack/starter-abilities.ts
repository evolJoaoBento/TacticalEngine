/**
 * What the starter pack's cards and features do.
 *
 * A card is a name and some text whether or not the engine can run it; these
 * are the ones it can. The rest of each card's meaning stays in its text, which
 * is how the engine has always handled a card the effect vocabulary cannot
 * express — the holder reads it and the table settles it.
 *
 * The same is true of a class or subclass feature, and the last section here is
 * the handful that are mechanical rather than read aloud. A feature's ability is
 * matched to its printed entry by name, so each one's `name` is exactly the name
 * the class or subclass prints.
 *
 * Nothing here costs Hope or Fear. Those are document field names on `cost`,
 * and both are being renamed; a starter pack that never spends them needs no
 * migration when that happens. A card that wants a price asks for Stress.
 */

import { abilitySchema, type AbilityDef } from '../abilities';

const RAW = [
  // ---- bulwark ---------------------------------------------------------------
  {
    id: 'power-slash',
    name: 'Power Slash',
    source: { kind: 'domainCard', card: 'power-slash' },
    text: 'Put your weight behind the swing: deal 2 additional damage.',
    kind: 'passive',
    modifiers: [{ stat: 'damageRoll', bonus: 2 }],
  },
  {
    id: 'iron-stance',
    name: 'Iron Stance',
    source: { kind: 'domainCard', card: 'iron-stance' },
    text: 'While you hold your ground, your Armor Score is higher.',
    kind: 'passive',
    modifiers: [{ stat: 'armorScore', bonus: 1 }],
  },
  {
    id: 'unbroken',
    name: 'Unbroken',
    source: { kind: 'domainCard', card: 'unbroken' },
    text: 'The first Severe blow you take each fight lands as Major instead.',
    kind: 'passive',
    modifiers: [{ stat: 'severeThreshold', bonus: 3 }],
  },

  // ---- shadow-step -----------------------------------------------------------
  {
    id: 'quick-hands',
    name: 'Quick Hands',
    source: { kind: 'domainCard', card: 'quick-hands' },
    text: 'Your hands are faster than the eye: gain a bonus to action rolls made to palm or plant something.',
    kind: 'passive',
    modifiers: [{ stat: 'actionRoll', bonus: 1 }],
  },
  {
    id: 'backstab',
    name: 'Backstab',
    source: { kind: 'domainCard', card: 'backstab' },
    text: 'Against a target unaware of you, your damage roll is higher.',
    kind: 'passive',
    modifiers: [{ stat: 'damageRoll', bonus: 3 }],
  },
  {
    id: 'vanish',
    name: 'Vanish',
    source: { kind: 'domainCard', card: 'vanish' },
    text: 'Break line of sight and you are gone until you act again.',
    kind: 'action',
    cost: { stress: 1 },
  },

  // ---- ember -----------------------------------------------------------------
  {
    id: 'arcane-ward',
    name: 'Arcane Ward',
    source: { kind: 'domainCard', card: 'arcane-ward' },
    text: 'A shell of warm air holds: raise your Armor Score until your next rest.',
    kind: 'passive',
    modifiers: [{ stat: 'armorScore', bonus: 2 }],
  },
  {
    id: 'emberbolt',
    name: 'Emberbolt',
    source: { kind: 'domainCard', card: 'emberbolt' },
    text: 'A thrown coal of fire. Your spells deal more damage.',
    kind: 'passive',
    modifiers: [{ stat: 'spellcastRoll', bonus: 1 }],
  },
  {
    id: 'healing-word',
    name: 'Healing Word',
    source: { kind: 'domainCard', card: 'healing-word' },
    text: 'Speak an ally steady: they clear a Stress.',
    kind: 'action',
    cost: { stress: 1 },
  },
  {
    id: 'warding-flame',
    name: 'Warding Flame',
    source: { kind: 'domainCard', card: 'warding-flame' },
    text: 'A ring of low fire. Foes crossing it are struck as they come.',
    kind: 'action',
    cost: { stress: 1 },
  },

  // ---- class and subclass features -------------------------------------------
  // A character's numbers come from more than the cards they hold, and until
  // these existed no shipped content exercised it: every ability in the pack was
  // a domain card, so the `classFeature` and `subclass` paths were reachable only
  // by a project writing its own. One mechanical feature each, at the stage a
  // level-1 character has, which is `foundation`.
  {
    id: 'sentinel-hold-fast',
    name: 'Hold Fast',
    source: { kind: 'classHope', classId: 'sentinel' },
    text: 'Spend 3 Hope to clear 2 Armor Slots.',
    cost: { hope: 3 },
    // Not the turn: spending it is something done on a turn rather than the
    // turn itself.
    action: false,
    // Nothing to fix, nothing to spend on: a sentinel with whole armour is
    // refused rather than charged.
    available: { kind: 'pool', pool: 'armorSlots', measure: 'marked', op: '>=', value: 1 },
    effects: [{ kind: 'clearArmor', amount: 2 }],
  },
  {
    id: 'cutpurse-slip-away',
    name: 'Slip Away',
    source: { kind: 'classHope', classId: 'cutpurse' },
    text: 'Spend 3 Hope to clear 2 Stress.',
    cost: { hope: 3 },
    action: false,
    available: { kind: 'pool', pool: 'stress', measure: 'marked', op: '>=', value: 1 },
    effects: [{ kind: 'clearStress', amount: 2, target: { kind: 'actor' } }],
  },
  {
    id: 'emberwright-bank-the-coals',
    name: 'Bank the Coals',
    source: { kind: 'classHope', classId: 'emberwright' },
    text: 'Spend 3 Hope to clear 2 Stress.',
    cost: { hope: 3 },
    action: false,
    available: { kind: 'pool', pool: 'stress', measure: 'marked', op: '>=', value: 1 },
    effects: [{ kind: 'clearStress', amount: 2, target: { kind: 'actor' } }],
  },
  {
    id: 'sentinel-drilled',
    name: 'Drilled',
    source: { kind: 'classFeature', classId: 'sentinel' },
    text: 'Long practice in armour: your Armor Score is 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'armorScore', bonus: 1 }],
  },
  {
    id: 'shieldbearer-set-feet',
    name: 'Set Feet',
    source: { kind: 'subclass', subclassId: 'shieldbearer', stage: 'foundation' },
    text: 'You take a blow square rather than glancing: your damage thresholds are 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'thresholds', bonus: 1 }],
  },
  {
    id: 'lampsnuffer-softstep',
    name: 'Softstep',
    source: { kind: 'subclass', subclassId: 'lampsnuffer', stage: 'foundation' },
    text: 'You are never quite where the eye expects: your Evasion is 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'evasion', bonus: 1 }],
  },
  {
    id: 'flamecaller-emberflow',
    name: 'Emberflow',
    source: { kind: 'subclass', subclassId: 'flamecaller', stage: 'foundation' },
    text: 'The heat answers quickly: your spellcast rolls are 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'spellcastRoll', bonus: 1 }],
  },
];

/**
 * The cards the engine can run. `shield-wall`, `rallying-cry`, `smoke-step`,
 * `cut-purse-strings` and `cinder-burst` ship as text only: each needs
 * something the effect vocabulary does not yet say — a timed bonus to someone
 * else, a teleport between shadows, taking a named item, a burst around a
 * chosen point — and a card with no script is still a card.
 */
export const STARTER_ABILITIES: readonly AbilityDef[] = RAW.map((raw) => abilitySchema.parse(raw));

/** By id, for a panel that has the id and wants the ability. */
export const STARTER_ABILITY_MAP: ReadonlyMap<string, AbilityDef> = new Map(
  STARTER_ABILITIES.map((ability) => [ability.id, ability]),
);
