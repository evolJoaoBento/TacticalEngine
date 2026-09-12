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

/**
 * A hide that shrugs steel off: resistance, which halves what it answers.
 *
 * Resistance is read where the damage is resolved, not at a defence prompt, so
 * this is also the specimen that proves a passive reaches a PC's own swing --
 * the one button in the game whose damage nothing else gets a chance to touch.
 */
export const A_HIDE_THAT_SHRUGS_OFF_STEEL = (definition: string): Record<string, unknown> => ({
  id: 'fixture-stone-hide',
  name: 'Stone Hide',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'Steel finds nothing soft here, and half of every cut goes nowhere.',
  kind: 'passive',
  action: false,
  defenses: { resistances: ['physical'] },
});

/**
 * Plate that turns a flat amount aside, and only against steel.
 *
 * `dice: '3'` is an expression that rolls nothing, which is how a fixed
 * reduction is spelled. `only` keeps it honest: plate is no answer to a spell.
 */
export const PLATE_THAT_TURNS_A_FLAT_AMOUNT = (definition: string): Record<string, unknown> => ({
  id: 'fixture-flat-plate',
  name: 'Banded Plate',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'Three of every blow stops at the bands and goes no further.',
  kind: 'passive',
  action: false,
  defenses: { reduce: [{ dice: '3', only: 'physical' }] },
});

/**
 * Plate that rolls for what it turns aside, against anything at all.
 *
 * The roll happens after the swing, so a seed that fixes the attack still leaves
 * this varying -- which is the point: a preview cannot know what it will take
 * off, and `reductionRolls` exists to say so.
 */
export const PLATE_THAT_ROLLS_WHAT_IT_TURNS = (definition: string): Record<string, unknown> => ({
  id: 'fixture-rolled-plate',
  name: 'Failing Plate',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'What the plate still has in it is a different amount every time.',
  kind: 'passive',
  action: false,
  defenses: { reduce: [{ dice: '1d10' }] },
});

/**
 * A wind-up: the first spotlight is spent getting ready, the next one acting.
 *
 * The token is the whole state, and it lives on the creature rather than on the
 * feature -- which is what lets two of these wind up side by side without
 * handing each other a turn. `endSpotlight` is what makes the first turn cost
 * something: without it the creature would gather itself AND swing.
 *
 * The token id is bare on purpose. More than one kind of slow thing shares this
 * one store, exactly as the shipped content does, and a test that places two of
 * them reads `tokensOn(entity, 'slow')` per creature.
 */
export const A_WIND_UP_THAT_COSTS_A_TURN = (definition: string): Record<string, unknown> => ({
  id: 'slow',
  name: 'Slow',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'Spotlight it with nothing gathered and it only gathers; spotlight it gathered and it acts.',
  kind: 'reaction',
  trigger: 'spotlighted',
  target: { kind: 'none' },
  inCombatOnly: true,
  effects: [
    {
      kind: 'branch',
      when: { kind: 'tokens', ability: 'slow', of: { kind: 'actor' }, op: '>=', value: 1 },
      then: [
        { kind: 'spendToken', ability: 'slow', all: true },
        { kind: 'log', text: 'What it was gathering itself for, it does now.', tone: 'fear' },
      ],
      otherwise: [
        { kind: 'addToken', ability: 'slow', amount: 1 },
        { kind: 'log', text: 'It gathers itself, and does nothing else.', tone: 'fear' },
        { kind: 'endSpotlight' },
      ],
    },
  ],
});

/**
 * The same wind-up with its own store and its own line.
 *
 * Simplified, and worth knowing: the winding turn costs this creature the whole
 * turn, where a block might only take its standard attack away. Nothing here can
 * forbid one attack and leave the rest of a turn standing, so anything else it
 * would have reached for waits too -- which is what one test pins.
 */
export const A_WIND_UP_WITH_ITS_OWN_STORE = (definition: string): Record<string, unknown> => ({
  id: 'slow-firing',
  name: 'Slow Firing',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'It spends a turn coming to bear, and fires on the next one.',
  kind: 'reaction',
  trigger: 'spotlighted',
  target: { kind: 'none' },
  inCombatOnly: true,
  effects: [
    {
      kind: 'branch',
      when: { kind: 'tokens', ability: 'slow-firing', of: { kind: 'actor' }, op: '>=', value: 1 },
      then: [
        { kind: 'spendToken', ability: 'slow-firing', all: true },
        { kind: 'log', text: 'It comes to rest, and lets fly.', tone: 'fear' },
      ],
      otherwise: [
        { kind: 'addToken', ability: 'slow-firing', amount: 1 },
        { kind: 'log', text: 'It grinds around, winding up.', tone: 'fear' },
        { kind: 'endSpotlight' },
      ],
    },
  ],
});

/**
 * A store that goes onto whoever it hit, and holds them there.
 *
 * One token holds a target in place; three also leave them open. The store is
 * kept under the definition's own id so that what is counted is "what this
 * creature put on them" rather than a shared pile.
 *
 * Simplified: a target's own way out of it is a roll they make on their own
 * turn, and nothing in the fight loop asks a PC for one, so only the half the
 * creature does is here -- along with what that roll would have spawned, which
 * therefore never arrives.
 */
export const A_STORE_THAT_HOLDS_WHOEVER_IT_HIT = (definition: string): Record<string, unknown> => ({
  id: `${definition}-encumber`,
  name: 'Encumber',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'What it hits, it winds tighter; enough of it and they are open as well as held.',
  kind: 'reaction',
  trigger: 'dealtHit',
  action: false,
  target: { kind: 'none' },
  effects: [
    { kind: 'addToken', ability: `${definition}-encumber`, amount: 1, target: { kind: 'target' } },
    { kind: 'log', text: 'It winds tighter around them.', tone: 'fear' },
    { kind: 'applyCondition', condition: 'restrained', duration: 'scene', target: { kind: 'target' } },
    {
      kind: 'branch',
      when: { kind: 'tokens', ability: `${definition}-encumber`, of: { kind: 'target' }, op: '>=', value: 3 },
      then: [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'scene', target: { kind: 'target' } }],
    },
  ],
});

/**
 * Hurt the thing holding them badly enough and the whole store comes off.
 *
 * The band is read off the blow itself: two Hit Points is Major, which is what a
 * resolved hit reports, so the gate is a count of Hit Points taken rather than a
 * severity name.
 *
 * Simplified: it comes off everyone at once, and takes the conditions with it,
 * so somebody held by something else is freed too. Naming "whoever is carrying
 * tokens" as a target is not something the effect list can ask for.
 */
export const A_STORE_TORN_OFF_BY_A_REAL_WOUND = (definition: string): Record<string, unknown> => ({
  id: `${definition}-torn-free`,
  name: 'Torn Free',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'A wound that tells goes through whatever it was holding with.',
  kind: 'reaction',
  trigger: 'tookHitPoints',
  action: false,
  available: { kind: 'count', of: 'hitPointsTaken', op: '>=', value: 2 },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'It comes apart, and what it held falls away.', tone: 'success' },
    { kind: 'spendToken', ability: `${definition}-encumber`, all: true, target: { kind: 'allies' } },
    { kind: 'clearCondition', condition: 'restrained', target: { kind: 'allies' } },
    { kind: 'clearCondition', condition: 'vulnerable', target: { kind: 'allies' } },
  ],
});

/**
 * A Stress spent on somebody already carrying enough of the store.
 *
 * The gate is on the TARGET, not on the feature. The GM aims at the nearest
 * creature in reach, so a feature-level gate would let this pay its Stress and
 * swing at whoever that turned out to be. Direct damage, because what is being
 * tested is the gate and the spend, not armour.
 */
export const A_SPEND_GATED_ON_WHAT_THEY_CARRY = (definition: string): Record<string, unknown> => ({
  id: `${definition}-crush`,
  name: 'Crush',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'Somebody wound tight enough is worth the effort of closing on.',
  cost: { stress: 1 },
  target: {
    kind: 'creature',
    range: 'melee',
    when: { kind: 'tokens', ability: `${definition}-encumber`, of: { kind: 'target' }, op: '>=', value: 3 },
  },
  inCombatOnly: true,
  effects: [
    { kind: 'log', text: 'It closes, and squeezes.', tone: 'fear' },
    { kind: 'damage', dice: '2d6+8', type: 'physical', direct: true, target: { kind: 'target' } },
  ],
});

/**
 * An overload: ten more damage on a blow already in the air, and then it acts
 * again.
 *
 * `trigger: 'rollingDamage'` is the whole placement -- the hit has landed, the
 * dice are being read, and nothing has been compared to a threshold yet. The one
 * Stress pays for both halves, the bonus and the second spotlight, so the GM's
 * own pool is never billed for the extra turn.
 *
 * The log names nothing, because two blocks share this one.
 */
export const AN_OVERLOAD_THAT_BUYS_ANOTHER_TURN = (definition: string): Record<string, unknown> => ({
  id: `${definition}-overload`,
  name: 'Overload',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'It can drive itself past what it should bear, and keep going afterwards.',
  kind: 'reaction',
  trigger: 'rollingDamage',
  action: false,
  cost: { stress: 1 },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'It overloads, and the blow comes down heavier.', tone: 'fear' },
    { kind: 'boostDamage', amount: 10 },
    { kind: 'spotlightAgain' },
  ],
});

/**
 * A watcher that adds its own attack to somebody else's hit.
 *
 * `allyRollingDamage` is a different trigger from the overload's, and that
 * difference is the test: this fires into another creature's blow and never into
 * its own. The range gate is read from this creature's chair to whoever is being
 * hit -- not from the attacker's, where everyone is always in range, a hit having
 * just landed.
 */
export const A_WATCHER_THAT_ADDS_TO_A_HIT = (definition: string): Record<string, unknown> => ({
  id: `${definition}-into-the-same-spot`,
  name: 'Into the Same Spot',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'It waits for somebody else to open a target up, and puts its own shot through it.',
  kind: 'reaction',
  trigger: 'allyRollingDamage',
  action: false,
  cost: { stress: 1 },
  available: { kind: 'withinRange', range: 'far' },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'It swings around and fires into the same spot.', tone: 'fear' },
    { kind: 'boostDamage', dice: 'weapon' },
  ],
});

/**
 * Something that comes for whoever is bleeding, on a wound it did not deal.
 *
 * Both halves of the gate earn their place: range is measured to the one who was
 * hit rather than to the attacker, and at least one Hit Point must actually have
 * been marked, so a blow that was shrugged off draws nothing.
 *
 * Simplified: it strikes from where it stands rather than being handed a
 * spotlight of its own -- the same swing without the turn's bookkeeping -- and it
 * goes for the one bleeding.
 */
export const A_HUNGER_DRAWN_TO_A_WOUND = (definition: string): Record<string, unknown> => ({
  id: `${definition}-drawn-to-the-wound`,
  name: 'Drawn to the Wound',
  source: { kind: 'adversary', adversaries: [definition] },
  text: 'A wound close by is an invitation, and it does not wait to be asked twice.',
  kind: 'reaction',
  trigger: 'nearbyTookDamage',
  action: false,
  cost: { stress: 1 },
  available: {
    kind: 'all',
    of: [
      { kind: 'withinRange', range: 'close', of: { kind: 'hit' } },
      { kind: 'count', of: 'hitPointsTaken', op: '>=', value: 1 },
    ],
  },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'Blood in the air, and something turns toward it.', tone: 'fear' },
    { kind: 'move', how: 'toward', of: { kind: 'hit' }, range: 'melee', budget: 'close' },
    { kind: 'attack', target: { kind: 'hit' } },
  ],
});
