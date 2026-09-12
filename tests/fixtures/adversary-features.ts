/**
 * Stat-block features for a test to be hit by.
 *
 * The GM's side of the table gets what `cards.ts` gives the party's: specimens
 * named for the mechanism they carry rather than for any creature they were
 * read off, so more than one block can share one without a catalogue growing
 * back. A feature that only one test ever reads still belongs beside that
 * test; these are the ones two files ask for.
 *
 * Each is a factory over the definition id it is sourced to, because a feature
 * belongs to whatever is standing there — `abilitiesForAdversary` matches on
 * that id, so a specimen sourced to a creature nobody placed is simply never
 * offered. Pass the id of the block the test stood up.
 *
 * They live outside `src/` with the rest of the fixtures: nothing the app
 * bundles may import them, so a fixture can never become shipped content.
 */

/**
 * A wound that answers: something that hits back the moment it is hurt badly.
 *
 * `trigger: 'tookSevere'` is the whole specimen. The engine reads that band as
 * a floor rather than a bracket — anything worse than Severe is still Severe —
 * so this fires on a blow that forces more Hit Points than the dice would have
 * rolled, which is a thing a second file asserts. What reaches the room is
 * deliberately plain damage: the specimen is about *when* it goes off.
 */
export const A_WOUND_THAT_ANSWERS = (definition: string): Record<string, unknown> => ({
  id: 'fixture-answering-wound',
  name: 'Answering Wound',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'Hurt it badly enough and what is inside it reaches everything standing close.',
  kind: 'reaction',
  trigger: 'tookSevere',
  action: false,
  target: { kind: 'none', range: 'close' },
  effects: [
    { kind: 'log', text: 'The wound opens, and the room pays for it.', tone: 'fear' },
    { kind: 'damage', dice: '1d10', type: 'physical', target: { kind: 'allies', range: 'close' } },
  ],
});

/**
 * A spray that eats armour: one attack across a whole band, and whatever it
 * beats loses an Armor Slot for nothing — or a Hit Point, with no slot left.
 *
 * Which of the two happens is decided per target, which is why the mechanic is
 * a `run` hook rather than an effect list: a list branches once for everybody
 * at once. The hook's `fear` argument is the GM's cut for the ones who had
 * nothing left to give up.
 */
export const A_SPRAY_THAT_EATS_ARMOUR = (definition: string): Record<string, unknown> => ({
  id: 'fixture-armour-spray',
  name: 'Caustic Spray',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'Sprays a whole band at once, and what it beats finds no use in armour.',
  target: { kind: 'none', range: 'close' },
  inCombatOnly: true,
  effects: [
    { kind: 'log', text: 'It sprays the room, and the air goes sour.', tone: 'combat' },
    {
      kind: 'attack',
      // Everyone in reach, each rolled for separately. The band is the whole
      // of the aim: the engine does not model facing, so "in front of it" is
      // not a thing a specimen can ask for.
      range: 'close',
      target: { kind: 'allies', range: 'close' },
      damage: '2d6',
      onHit: [{ kind: 'run', hook: 'mark-armor-or-hit-point', args: { fear: true } }],
    },
  ],
});
