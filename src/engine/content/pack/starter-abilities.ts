/**
 * What the starter pack's cards and features do.
 *
 * A card is a name and some text whether or not the engine can run it; these
 * are the ones it can. The rest of each card's meaning stays in its text, which
 * is how the engine has always handled a card the effect vocabulary cannot
 * express — the holder reads it and the table settles it.
 *
 * The same is true of a class or subclass feature, and the last section here is
 * the handful that are mechanical rather than read aloud. Each sits on the card
 * the class or subclass prints, by id: the card says what grants it, so nothing
 * here is matched to anything by name.
 *
 * Nothing here costs Light or Shadow. Those are document field names on `cost`,
 * and both are being renamed; a starter pack that never spends them needs no
 * migration when that happens. A card that wants a price asks for Stress.
 */

import { abilitySchema, type AbilityDef } from '../abilities';

const RAW = [
  // ---- bulwark ---------------------------------------------------------------
  {
    id: 'power-slash',
    name: 'Power Slash',
    source: { card: 'power-slash' },
    text: 'Put your weight behind the swing: deal 2 additional damage.',
    kind: 'passive',
    modifiers: [{ stat: 'damageRoll', bonus: 2 }],
  },
  {
    id: 'iron-stance',
    name: 'Iron Stance',
    source: { card: 'iron-stance' },
    text: 'While you hold your ground, your Armor Score is higher.',
    kind: 'passive',
    modifiers: [{ stat: 'armorScore', bonus: 1 }],
  },
  {
    id: 'unbroken',
    name: 'Unbroken',
    source: { card: 'unbroken' },
    text: 'The first Severe blow you take each fight lands as Major instead.',
    kind: 'passive',
    modifiers: [{ stat: 'severeThreshold', bonus: 3 }],
  },

  // ---- shadow-step -----------------------------------------------------------
  {
    id: 'quick-hands',
    name: 'Quick Hands',
    source: { card: 'quick-hands' },
    text: 'Your hands are faster than the eye: gain a bonus to action rolls made to palm or plant something.',
    kind: 'passive',
    modifiers: [{ stat: 'actionRoll', bonus: 1 }],
  },
  {
    id: 'backstab',
    name: 'Backstab',
    source: { card: 'backstab' },
    text: 'Against a target unaware of you, your damage roll is higher.',
    kind: 'passive',
    modifiers: [{ stat: 'damageRoll', bonus: 3 }],
  },
  {
    id: 'vanish',
    name: 'Vanish',
    source: { card: 'vanish' },
    text: 'Break line of sight and you are gone until you act again.',
    kind: 'action',
    cost: { stress: 1 },
  },

  // ---- ember -----------------------------------------------------------------
  {
    id: 'arcane-ward',
    name: 'Arcane Ward',
    source: { card: 'arcane-ward' },
    text: 'A shell of warm air holds: raise your Armor Score until your next rest.',
    kind: 'passive',
    modifiers: [{ stat: 'armorScore', bonus: 2 }],
  },
  {
    id: 'emberbolt',
    name: 'Emberbolt',
    source: { card: 'emberbolt' },
    text: 'A thrown coal of fire. Your spells deal more damage.',
    kind: 'passive',
    modifiers: [{ stat: 'spellcastRoll', bonus: 1 }],
  },
  {
    id: 'healing-word',
    name: 'Healing Word',
    source: { card: 'healing-word' },
    text: 'Speak an ally steady: they clear a Stress.',
    kind: 'action',
    cost: { stress: 1 },
  },
  {
    id: 'warding-flame',
    name: 'Warding Flame',
    source: { card: 'warding-flame' },
    text: 'A ring of low fire. Foes crossing it are struck as they come.',
    kind: 'action',
    cost: { stress: 1 },
    target: { kind: 'self' },
    inCombatOnly: true,
    // No check: the ring goes down and the crossing is the whole of the spell,
    // which is what the card says. It also means using it answers at once
    // rather than waiting on dice.
    effects: [
      { kind: 'log', text: 'Low fire takes in a ring around their feet.', tone: 'good' },
      {
        kind: 'zone',
        zone: 'warding-flame',
        name: 'Warding Flame',
        condition: 'warding-flame-ring',
        at: 'actor',
        band: 'melee',
        side: 'adversaries',
        onDeath: 'end',
      },
    ],
  },

  /**
   * The first shipped card aimed at the ground rather than at anybody.
   *
   * `target.kind: 'point'` binds `bindings.point`, which is what the board reads
   * to light the tiles it may be thrown at and to show what a spot would catch
   * before it is committed to. `around: 'point'` on the roll's own selector is
   * what makes the bloom measured from the spot instead of from the caster --
   * the engine has covered that path in unit tests since it was written, and
   * this is the first content to walk down it.
   */
  {
    id: 'cinder-burst',
    name: 'Cinder Burst',
    source: { card: 'cinder-burst' },
    text: 'Fire blooms: every foe within Very Close of a point takes damage.',
    kind: 'action',
    cost: { stress: 1 },
    target: { kind: 'point', range: 'far' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'They choose a spot across the room, and it blooms.', tone: 'good' },
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'veryClose', around: 'point' },
          prompt: 'Cinder Burst: one roll, against everything the bloom covers.',
          always: [{ kind: 'damage', dice: '1d10', type: 'magic', using: 'proficiency', target: { kind: 'hit' } }],
        },
      },
    ],
  },

  /**
   * A named ally, and a condition that carries the bonus until the scene ends.
   *
   * The note at the foot of this file used to call this one "a timed bonus to
   * someone else" and file it as unsayable. A condition with a duration is
   * exactly that, so the note was out of date rather than the vocabulary short.
   */
  // Rallying Cry: "each ally who can hear you" is everyone within Far of the one calling out. It
  // is paid in Stress, as every card here is, rather than in Light.
  {
    id: 'rallying-cry',
    name: 'Rallying Cry',
    source: { card: 'rallying-cry' },
    text: 'Call out: each ally who can hear you clears a Stress.',
    kind: 'action',
    cost: { stress: 1 },
    target: { kind: 'self' },
    effects: [
      { kind: 'log', text: 'The call carries, and shoulders come up.', tone: 'good' },
      { kind: 'clearStress', amount: 1, target: { kind: 'allies', range: 'far' } },
    ],
  },
  // Smoke Step: from one shadow to another within Close. Nothing between the two has to let them
  // pass, so it is a blink to the spot rather than a walk there.
  {
    id: 'smoke-step',
    name: 'Smoke Step',
    source: { card: 'smoke-step' },
    text: 'Step from one shadow within Close range to another.',
    kind: 'action',
    cost: { stress: 1 },
    target: { kind: 'point', range: 'close' },
    effects: [
      { kind: 'log', text: 'They are there, and then they are somewhere else.', tone: 'good' },
      { kind: 'move', to: 'point', teleport: true, budget: 'close' },
    ],
  },
  {
    id: 'shield-wall',
    name: 'Shield Wall',
    source: { card: 'shield-wall' },
    text: 'Until your next turn, allies within Melee range gain a bonus to Evasion.',
    kind: 'action',
    cost: { stress: 1 },
    target: { kind: 'ally', range: 'melee' },
    inCombatOnly: true,
    effects: [
      { kind: 'log', text: 'A shield comes across, and there is somewhere to stand.', tone: 'good' },
      { kind: 'applyCondition', condition: 'behind-the-shield', duration: 'scene', target: { kind: 'target' } },
    ],
  },

  // ---- class and subclass features -------------------------------------------
  // A character's numbers come from more than the cards they choose. One
  // mechanical feature each, on the card the class or subclass prints, at the
  // stage a level-1 character has, which is `foundation`.
  {
    id: 'sentinel-drilled',
    name: 'Drilled',
    source: { card: 'sentinel-drilled' },
    text: 'Long practice in armour: your Armor Score is 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'armorScore', bonus: 1 }],
  },
  {
    id: 'shieldbearer-set-feet',
    name: 'Set Feet',
    source: { card: 'shieldbearer-set-feet' },
    text: 'You take a blow square rather than glancing: your damage thresholds are 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'thresholds', bonus: 1 }],
  },
  {
    id: 'lampsnuffer-softstep',
    name: 'Softstep',
    source: { card: 'lampsnuffer-softstep' },
    text: 'You are never quite where the eye expects: your Evasion is 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'evasion', bonus: 1 }],
  },
  /**
   * The sentinel's signature, which the class has printed as prose since the
   * pack was written. Both conditions it needs already exist in
   * `content/conditions.ts`: `holding-the-line` is the marker that says the
   * stance is up, and `caught-in-the-line` carries the pull, the hold and the
   * line the log writes about it. Only the ability that puts the ground down
   * was missing.
   *
   * No `modifiers`, deliberately: a probe sentinel is granted this, and
   * `starter.test.ts` pins that character's Armor Score at exactly what Drilled
   * and Iron Stance are worth.
   */
  {
    id: 'sentinel-hold-the-line',
    name: 'Hold the Line',
    source: { card: 'sentinel-hold-the-line' },
    text: 'When an ally within Melee range is attacked, you may take the blow in their place.',
    cost: { stress: 1 },
    target: { kind: 'self' },
    inCombatOnly: true,
    action: false,
    effects: [
      { kind: 'log', text: 'They set their feet, and the ground around them stops being neutral.', tone: 'good' },
      { kind: 'applyCondition', condition: 'holding-the-line', duration: 'scene', target: { kind: 'actor' } },
      {
        kind: 'zone',
        zone: 'hold-the-line',
        name: 'Hold the Line',
        condition: 'caught-in-the-line',
        at: 'actor',
        band: 'veryClose',
        side: 'adversaries',
        onDeath: 'end',
      },
    ],
  },
  {
    id: 'flamecaller-emberflow',
    name: 'Emberflow',
    source: { card: 'flamecaller-emberflow' },
    text: 'The heat answers quickly: your spellcast rolls are 1 higher.',
    kind: 'passive',
    modifiers: [{ stat: 'spellcastRoll', bonus: 1 }],
  },
];

/**
 * The cards the engine can run. `cut-purse-strings` ships as text only, and a
 * card with no script is still a card — the holder reads it and the table
 * settles it.
 *
 * Four of the five that used to be listed here are now scripted: Rallying Cry
 * and Smoke Step since, with nothing new asked of the vocabulary. A timed bonus to
 * someone else is a condition with a duration, and a burst around a chosen point
 * is `around: 'point'`; both were already sayable, so the note was out of date
 * rather than the vocabulary short. `cut-purse-strings` is the one with a real
 * blocker: `addItem` names a bare item id with no source, so taking what somebody
 * else is carrying cannot be said, and a pack card naming one project's `gold`
 * would couple the pack to that project and render as a raw id anywhere else.
 */
export const STARTER_ABILITIES: readonly AbilityDef[] = RAW.map((raw) => abilitySchema.parse(raw));

/** By id, for a panel that has the id and wants the ability. */
export const STARTER_ABILITY_MAP: ReadonlyMap<string, AbilityDef> = new Map(
  STARTER_ABILITIES.map((ability) => [ability.id, ability]),
);
