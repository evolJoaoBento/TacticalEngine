/**
 * The pack the engine ships with.
 *
 * Plain high fantasy, invented for this engine: three classes over three
 * domains, the equipment and cards they use, and ten adversaries to set them
 * against. It exists so the engine runs out of the box and so the demo has
 * content of its own — not to be a game.
 *
 * Nothing here spends a resource whose name is changing, and no field is named
 * after one, so this pack needs no migration when that rename lands.
 *
 * `STARTER_PACK` is the document form, as a project would store it.
 * `STARTER_CHARACTERS` is the same content indexed by id, which is what the
 * rules read.
 */

import type { ContentPack } from './import';
import { contentPackSchema, type ContentPackDoc } from './schema';

const STARTER: ContentPackDoc = {
  classes: [
    {
      id: 'sentinel',
      name: 'Sentinel',
      domains: ['bulwark'],
      startingEvasion: 9,
      startingHitPoints: 7,
    },
    {
      id: 'cutpurse',
      name: 'Cutpurse',
      domains: ['shadow'],
      startingEvasion: 12,
      startingHitPoints: 5,
    },
    {
      id: 'emberwright',
      name: 'Emberwright',
      domains: ['ember'],
      startingEvasion: 10,
      startingHitPoints: 5,
    },
  ],

  subclasses: [
    {
      id: 'shieldbearer',
      name: 'Shieldbearer',
      classId: 'sentinel',
      domains: ['bulwark'],
    },
    {
      id: 'lampsnuffer',
      name: 'Lampsnuffer',
      classId: 'cutpurse',
      domains: ['shadow'],
      spellcastTrait: 'finesse',
    },
    {
      id: 'flamecaller',
      name: 'Flamecaller',
      classId: 'emberwright',
      domains: ['ember'],
      spellcastTrait: 'knowledge',
    },
  ],

  ancestries: [
    { id: 'human', name: 'Human' },
    { id: 'stoneborn', name: 'Stoneborn' },
    { id: 'sylvan', name: 'Sylvan' },
  ],

  communities: [
    { id: 'wayfarer', name: 'Wayfarer' },
    { id: 'guildsworn', name: 'Guildsworn' },
  ],

  weapons: [
    {
      id: 'longsword',
      name: 'Longsword',
      tier: 1,
      slot: 'primaryPhysical',
      trait: 'strength',
      range: 'melee',
      damage: { count: 1, sides: 8, modifier: 1, types: ['physical'] },
      burden: 'oneHanded',
      features: [],
    },
    {
      id: 'round-shield',
      name: 'Round Shield',
      tier: 1,
      slot: 'secondary',
      trait: 'strength',
      range: 'melee',
      damage: { count: 1, sides: 4, modifier: 0, types: ['physical'] },
      burden: 'oneHanded',
      features: [],
    },
    {
      id: 'hunting-bow',
      name: 'Hunting Bow',
      tier: 1,
      slot: 'primaryPhysical',
      trait: 'finesse',
      range: 'far',
      damage: { count: 1, sides: 6, modifier: 1, types: ['physical'] },
      burden: 'twoHanded',
      features: [],
    },
    {
      id: 'ember-staff',
      name: 'Ember Staff',
      tier: 1,
      slot: 'primaryMagic',
      trait: 'knowledge',
      range: 'close',
      damage: { count: 1, sides: 8, modifier: 0, types: ['magic'] },
      burden: 'twoHanded',
      features: [],
    },
  ],

  armors: [
    {
      id: 'ringmail',
      name: 'Ringmail',
      tier: 1,
      baseThresholds: { major: 7, severe: 15 },
      baseScore: 4,
      features: [],
    },
    {
      id: 'padded-coat',
      name: 'Padded Coat',
      tier: 1,
      baseThresholds: { major: 5, severe: 11 },
      baseScore: 3,
      features: [],
    },
  ],

  cards: [
    card('power-slash', 'Power Slash', 'bulwark', 1, 1, 'Put your weight behind the swing: deal 2 additional damage.'),
    card('shield-wall', 'Shield Wall', 'bulwark', 1, 1, 'Until your next turn, allies within Melee range gain a bonus to Evasion.'),
    card('iron-stance', 'Iron Stance', 'bulwark', 1, 0, 'While you hold your ground, your Armor Score is higher.'),
    card('rallying-cry', 'Rallying Cry', 'bulwark', 2, 1, 'Call out: each ally who can hear you clears a Stress.'),
    card('unbroken', 'Unbroken', 'bulwark', 2, 2, 'The first Severe blow you take each fight lands as Major instead.'),

    card('quick-hands', 'Quick Hands', 'shadow', 1, 0, 'Your hands are faster than the eye: gain a bonus to action rolls made to palm or plant something.'),
    card('smoke-step', 'Smoke Step', 'shadow', 1, 1, 'Step from one shadow within Close range to another.'),
    card('backstab', 'Backstab', 'shadow', 1, 1, 'Against a target unaware of you, your damage roll is higher.'),
    card('vanish', 'Vanish', 'shadow', 2, 2, 'Break line of sight and you are gone until you act again.'),
    card('cut-purse-strings', 'Cut Purse Strings', 'shadow', 2, 1, 'Take one carried item from a target within Melee range.'),

    card('arcane-ward', 'Arcane Ward', 'ember', 1, 1, 'A shell of warm air holds: raise your Armor Score until your next rest.'),
    card('healing-word', 'Healing Word', 'ember', 1, 1, 'Speak an ally steady: they clear a Stress.'),
    card('emberbolt', 'Emberbolt', 'ember', 1, 0, 'A thrown coal of fire. Your spells deal more damage.'),
    card('cinder-burst', 'Cinder Burst', 'ember', 2, 1, 'Fire blooms: every foe within Very Close of a point takes damage.'),
    card('warding-flame', 'Warding Flame', 'ember', 2, 2, 'A ring of low fire. Foes crossing it are struck as they come.'),

    // What each class prints: in play for everybody of the class. The class lists none of them;
    // each card names the class, so a pack of extra cards for a class imports without editing it.
    printed('sentinel-shield-trained', 'Shield Trained', { kind: 'class', classId: 'sentinel' }, 'You may use a shield without it counting against your burden.'),
    printed('sentinel-drilled', 'Drilled', { kind: 'class', classId: 'sentinel' }, 'Long practice in armour: your Armor Score is 1 higher.'),
    printed('sentinel-hold-the-line', 'Hold the Line', { kind: 'class', classId: 'sentinel' }, 'When an ally within Melee range is attacked, you may take the blow in their place.'),
    printed('cutpurse-light-fingers', 'Light Fingers', { kind: 'class', classId: 'cutpurse' }, 'You have advantage on rolls to take something unnoticed.'),
    printed('cutpurse-slip-the-knot', 'Slip the Knot', { kind: 'class', classId: 'cutpurse' }, 'Once per rest, free yourself from a grapple, binding or snare without rolling.'),
    printed('emberwright-ashmark', 'Ashmark', { kind: 'class', classId: 'emberwright' }, 'You can tell by touch whether a thing has been burned.'),
    printed('emberwright-kindle', 'Kindle', { kind: 'class', classId: 'emberwright' }, 'Your next spell this turn deals 2 additional damage.'),

    // What each subclass prints, at the stage it prints it.
    printed('shieldbearer-bulwark-stance', 'Bulwark Stance', { kind: 'subclass', subclassId: 'shieldbearer', stage: 'foundation' }, 'Allies directly behind you count as having cover.'),
    printed('shieldbearer-set-feet', 'Set Feet', { kind: 'subclass', subclassId: 'shieldbearer', stage: 'foundation' }, 'You take a blow square rather than glancing: your damage thresholds are 1 higher.'),
    printed('shieldbearer-unmoved', 'Unmoved', { kind: 'subclass', subclassId: 'shieldbearer', stage: 'specialization' }, 'You cannot be pushed or pulled against your will.'),
    printed('shieldbearer-wall-of-one', 'Wall of One', { kind: 'subclass', subclassId: 'shieldbearer', stage: 'mastery' }, 'Once per fight, reduce a Severe result to Major.'),
    printed('lampsnuffer-douse', 'Douse', { kind: 'subclass', subclassId: 'lampsnuffer', stage: 'foundation' }, 'Put out an unattended light within Close range as a free action.'),
    printed('lampsnuffer-softstep', 'Softstep', { kind: 'subclass', subclassId: 'lampsnuffer', stage: 'foundation' }, 'You are never quite where the eye expects: your Evasion is 1 higher.'),
    printed('lampsnuffer-low-profile', 'Low Profile', { kind: 'subclass', subclassId: 'lampsnuffer', stage: 'specialization' }, 'In dim light or darkness, you are harder to pick out at range.'),
    printed('lampsnuffer-nobody-saw', 'Nobody Saw', { kind: 'subclass', subclassId: 'lampsnuffer', stage: 'mastery' }, 'Once per rest, undo the fact that you were noticed.'),
    printed('flamecaller-emberhand', 'Emberhand', { kind: 'subclass', subclassId: 'flamecaller', stage: 'foundation' }, 'Your Ember spells ignore one point of resistance.'),
    printed('flamecaller-emberflow', 'Emberflow', { kind: 'subclass', subclassId: 'flamecaller', stage: 'foundation' }, 'The heat answers quickly: your spellcast rolls are 1 higher.'),
    printed('flamecaller-banked-heat', 'Banked Heat', { kind: 'subclass', subclassId: 'flamecaller', stage: 'specialization' }, 'A spell you did not cast this turn burns hotter on the next.'),
    printed('flamecaller-conflagration', 'Conflagration', { kind: 'subclass', subclassId: 'flamecaller', stage: 'mastery' }, 'Once per fight, a spell strikes every foe within Very Close.'),

    // What an ancestry or a community gives whoever has it.
    printed('human-adaptable', 'Adaptable', { kind: 'ancestry', ancestryId: 'human' }, 'Once per rest, reroll a failed action roll.'),
    printed('stoneborn-deep-footing', 'Deep Footing', { kind: 'ancestry', ancestryId: 'stoneborn' }, 'You are never knocked prone by a blow alone.'),
    printed('sylvan-green-step', 'Green Step', { kind: 'ancestry', ancestryId: 'sylvan' }, 'Undergrowth costs you nothing to move through.'),
    printed('wayfarer-road-sense', 'Road Sense', { kind: 'community', communityId: 'wayfarer' }, 'You know roughly where the nearest road runs.'),
    printed('guildsworn-someone-owes-you', 'Someone Owes You', { kind: 'community', communityId: 'guildsworn' }, 'In a settlement, you can usually find a contact.'),
  ],

  adversaries: [
    adversary('fen-lurker', 'Fen Lurker', 1, 'skulk', 11, 6, 12, 4, 3, 'Grasping Arms', 2, 'melee', 1, 6, 1,
      'A long-limbed thing that waits under the water for something to wade past.',
      'Take the straggler, drown what it takes, and be gone before the others turn round.'),
    adversary('bandit-cutter', 'Bandit Cutter', 1, 'standard', 11, 6, 12, 5, 3, 'Short Blade', 2, 'melee', 1, 8, 0,
      'A road robber in boiled leather, more confident than skilled.',
      'Surround whoever looks richest; run the moment it stops being easy.'),
    adversary('bandit-archer', 'Bandit Archer', 1, 'ranged', 11, 5, 11, 4, 3, 'Loosed Arrow', 3, 'far', 1, 6, 1,
      'Perched where the road narrows, with a quiver and no hurry.',
      'Stay out of reach, shoot whoever is helping others, move when found.'),
    adversary('rot-hound', 'Rot Hound', 1, 'horde', 10, 5, 10, 6, 2, 'Worrying Bite', 1, 'melee', 1, 6, 0,
      'Dogs that did not stop when they should have. They run as one and smell worse.',
      'Pull down the isolated one; ignore pain entirely.'),
    adversary('grave-moth', 'Grave Moth', 1, 'minion', 9, 4, 8, 1, 1, 'Dust', 1, 'veryClose', 1, 4, 0,
      'Pale, hand-sized, and drawn to anything still warm.',
      'Smother lights, then faces. Never alone.'),
    adversary('wandering-hedge-priest', 'Wandering Hedge Priest', 1, 'social', 12, 5, 11, 4, 4, 'Blessed Staff', 1, 'melee', 1, 6, 0,
      'Robed, footsore, and carrying more authority than the robe deserves.',
      'Talk first, bless allies second, and leave before the fighting is settled.'),
    adversary('stone-golem', 'Stone Golem', 2, 'bruiser', 14, 12, 24, 9, 3, 'Sweeping Fist', 4, 'melee', 2, 8, 2,
      'A slab of quarried rock given orders once and never told to stop.',
      'Break whatever is nearest and in the way. It does not choose targets.'),
    adversary('briar-wraith', 'Briar Wraith', 2, 'skulk', 14, 9, 18, 6, 4, 'Thorn Lash', 3, 'close', 1, 10, 1,
      'A tangle of dead bramble that moves when nobody is looking straight at it.',
      'Separate one from the group, wound and withdraw, wear them down.'),
    adversary('bandit-captain', 'Bandit Captain', 2, 'leader', 14, 10, 20, 8, 4, 'Notched Sabre', 3, 'melee', 1, 10, 2,
      'The one whose orders the others actually follow, in a stolen officer’s coat.',
      'Hold the line, send others first, and bargain when losing.'),
    adversary('hollow-knight', 'Hollow Knight', 2, 'solo', 15, 13, 26, 12, 5, 'Rusted Greatsword', 4, 'melee', 2, 10, 2,
      'Armour standing upright with nothing inside it but intent.',
      'Fight to the end without bad or hurry. It has waited longer than this.'),
  ],
};

/** A domain card: one a character chooses. Every one is an ability rather than a spell or a grimoire here. */
function card(
  id: string,
  name: string,
  domain: string,
  level: number,
  recallCost: number,
  text: string,
): ContentPackDoc['cards'][number] {
  return { id, name, grant: { kind: 'chosen' }, domain, type: 'ability', level, recallCost, text, features: [] };
}

/** A card a class, subclass, ancestry or community prints: in play for whoever that describes. */
function printed(
  id: string,
  name: string,
  grant: ContentPackDoc['cards'][number]['grant'],
  text: string,
): ContentPackDoc['cards'][number] {
  return { id, name, grant, text, features: [] };
}

/** A stat block, written out flat because the shape is wide and the values matter. */
function adversary(
  id: string,
  name: string,
  tier: 1 | 2,
  role: ContentPackDoc['adversaries'][number]['role'],
  difficulty: number,
  major: number,
  severe: number,
  hitPoints: number,
  stress: number,
  attackName: string,
  attackModifier: number,
  attackRange: ContentPackDoc['adversaries'][number]['attackRange'],
  damageCount: number,
  damageSides: number,
  damageModifier: number,
  description: string,
  motivesAndTactics: string,
): ContentPackDoc['adversaries'][number] {
  return {
    id,
    name,
    tier,
    role,
    difficulty,
    thresholds: { major, severe },
    hitPoints,
    stress,
    attackName,
    attackModifier: { count: 0, sides: 0, modifier: attackModifier },
    attackRange,
    attackDamage: { count: damageCount, sides: damageSides, modifier: damageModifier, types: ['physical'] },
    description,
    motivesAndTactics,
    experiences: [],
    features: [],
  };
}

/** Parsed once here, so a mistake in the content above is a failure at import. */
export const STARTER_PACK: ContentPackDoc = contentPackSchema.parse(STARTER);

const index = <T extends { id: string }>(defs: readonly T[]): ReadonlyMap<string, T> =>
  new Map(defs.map((def) => [def.id, def]));

/** The same content, by id, which is the form the rules read. */
export const STARTER_CHARACTERS: ContentPack = {
  weapons: index(STARTER_PACK.weapons),
  armors: index(STARTER_PACK.armors),
  classes: index(STARTER_PACK.classes),
  ancestries: index(STARTER_PACK.ancestries),
  communities: index(STARTER_PACK.communities),
  subclasses: index(STARTER_PACK.subclasses),
  cards: index(STARTER_PACK.cards),
};

/** The adversaries, by id, as the GM's side reads them. */
export const STARTER_ADVERSARIES = index(STARTER_PACK.adversaries);

export { STARTER_ABILITIES } from './starter-abilities';
export { STARTER_CONDITIONS } from './starter-conditions';
