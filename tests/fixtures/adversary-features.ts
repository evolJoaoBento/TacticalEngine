/**
 * Stat-block features for a test to be hit by.
 *
 * The GM's side of the table gets what `cards.ts` gives the party's: specimens
 * named for the mechanism they carry rather than for any creature they were
 * read off, so more than one block can share one without a catalogue growing
 * back. A feature that only one test ever reads still belongs beside that
 * test; these are the ones two files ask for.
 *
 * Each is a factory over the definition id whose block prints it, because a
 * feature belongs to whatever is standing there — its card is granted to that
 * id, so a specimen printed on a creature nobody placed is simply never
 * offered. Pass the id of the block the test stood up.
 *
 * They live outside `src/` with the rest of the fixtures: nothing the app
 * bundles may import them, so a fixture can never become shipped content.
 */

import { abilitySchema, type AbilityDef } from '../../src/engine/content/abilities';
import { cardDefSchema } from '../../src/engine/content/pack/schema';
import type { CodeDef } from '../../src/engine/scene/schema';

/** A card as a project stores it. */
type Card = ReturnType<typeof cardDefSchema.parse>;

/** A stat block's feature as a project carries it: the card its blocks print, and the ability on it. */
export interface Printed {
  card: Card;
  ability: AbilityDef;
}

/**
 * A feature printed on the named blocks: a card granted by `adversary`, under the feature's own id
 * and name, and the ability sitting on it. What the feature does is written once; which blocks
 * print it is the card's to say.
 */
export function printed(adversaries: string | readonly string[], feature: Record<string, unknown>): Printed {
  const ability = abilitySchema.parse({ ...feature, source: { card: feature['id'] } });
  const card = cardDefSchema.parse({
    id: ability.id,
    name: ability.name,
    grant: { kind: 'adversary', adversaries: typeof adversaries === 'string' ? [adversaries] : [...adversaries] },
  });
  return { card, ability };
}

/** Lay printed features into a project: each card, and the ability on it. */
export function print(project: { cards: Card[]; abilities: AbilityDef[] }, ...features: readonly Printed[]): void {
  for (const { card, ability } of features) {
    project.cards.push(card);
    project.abilities.push(ability);
  }
}

/**
 * A wound that answers: something that hits back the moment it is hurt badly.
 *
 * `trigger: 'tookSevere'` is the whole specimen. The engine reads that band as
 * a floor rather than a bracket — anything worse than Severe is still Severe —
 * so this fires on a blow that forces more Hit Points than the dice would have
 * rolled, which is a thing a second file asserts. What reaches the room is
 * deliberately plain damage: the specimen is about *when* it goes off.
 */
export const A_WOUND_THAT_ANSWERS = (definition: string): Printed => printed(definition, {
  id: 'fixture-answering-wound',
  name: 'Answering Wound',
  text: 'Hurt it badly enough and what is inside it reaches everything standing close.',
  kind: 'reaction',
  trigger: 'tookSevere',
  action: false,
  target: { kind: 'none', range: 'close' },
  effects: [
    { kind: 'log', text: 'The wound opens, and the room pays for it.', tone: 'bad' },
    { kind: 'damage', dice: '1d10', type: 'physical', target: { kind: 'allies', range: 'close' } },
  ],
});

/**
 * A spray that eats armour: one attack across a whole band, and whatever it
 * beats loses an Armor Slot for nothing — or a Hit Point, with no slot left.
 *
 * Which of the two happens is decided per target, which is why the mechanic is
 * a `run` hook rather than an effect list: a list branches once for everybody
 * at once. The hook's `bad` argument is the GM's cut for the ones who had
 * nothing left to give up. The hook is `ARMOUR_OR_HIT_POINT_CODE`, below: the
 * engine ships none, so a test lays it into the project's code with the block.
 */
export const A_SPRAY_THAT_EATS_ARMOUR = (definition: string): Printed => printed(definition, {
  id: 'fixture-armour-spray',
  name: 'Caustic Spray',
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
      onHit: [{ kind: 'run', hook: 'fixture-armor-or-hit-point', args: { bad: true } }],
    },
  ],
});

/** The code behind the spray, shaped as a project carries code: per target, a slot or a Hit Point. */
export const ARMOUR_OR_HIT_POINT_CODE: CodeDef = {
  id: 'fixture-armor-or-hit-point',
  name: 'Armour or a Hit Point',
  notes: 'Each creature hit marks an Armor Slot for nothing, or a Hit Point with none left.',
  source: `for (var i = 0; i < ctx.hit.length; i++) {
  var id = ctx.hit[i];
  var room = ctx.pool(id, 'armorSlots') || 0;
  if (room > 0) {
    ctx.log('The spray eats an Armor Slot for nothing.', 'combat');
    ctx.queue([{ kind: 'markArmor', amount: 1, target: { kind: 'entity', id: id } }]);
  } else {
    ctx.log('No armour left to give up: the spray takes a Hit Point.', 'bad');
    var effects = [{ kind: 'damage', amount: 1, direct: true, target: { kind: 'entity', id: id } }];
    if (ctx.args.bad === true) effects.push({ kind: 'gainBad' });
    ctx.queue(effects);
  }
}`,
};

/**
 * A hide that shrugs steel off: resistance, which halves what it answers.
 *
 * Resistance is read where the damage is resolved, not at a defence prompt, so
 * this is also the specimen that proves a passive reaches a PC's own swing --
 * the one button in the game whose damage nothing else gets a chance to touch.
 */
export const A_HIDE_THAT_SHRUGS_OFF_STEEL = (definition: string): Printed => printed(definition, {
  id: 'fixture-stone-hide',
  name: 'Stone Hide',
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
export const PLATE_THAT_TURNS_A_FLAT_AMOUNT = (definition: string): Printed => printed(definition, {
  id: 'fixture-flat-plate',
  name: 'Banded Plate',
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
export const PLATE_THAT_ROLLS_WHAT_IT_TURNS = (definition: string): Printed => printed(definition, {
  id: 'fixture-rolled-plate',
  name: 'Failing Plate',
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
export const A_WIND_UP_THAT_COSTS_A_TURN = (definition: string): Printed => printed(definition, {
  id: 'slow',
  name: 'Slow',
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
        { kind: 'log', text: 'What it was gathering itself for, it does now.', tone: 'bad' },
      ],
      otherwise: [
        { kind: 'addToken', ability: 'slow', amount: 1 },
        { kind: 'log', text: 'It gathers itself, and does nothing else.', tone: 'bad' },
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
export const A_WIND_UP_WITH_ITS_OWN_STORE = (definition: string): Printed => printed(definition, {
  id: 'slow-firing',
  name: 'Slow Firing',
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
        { kind: 'log', text: 'It comes to rest, and lets fly.', tone: 'bad' },
      ],
      otherwise: [
        { kind: 'addToken', ability: 'slow-firing', amount: 1 },
        { kind: 'log', text: 'It grinds around, winding up.', tone: 'bad' },
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
export const A_STORE_THAT_HOLDS_WHOEVER_IT_HIT = (definition: string): Printed => printed(definition, {
  id: `${definition}-encumber`,
  name: 'Encumber',
  text: 'What it hits, it winds tighter; enough of it and they are open as well as held.',
  kind: 'reaction',
  trigger: 'dealtHit',
  action: false,
  target: { kind: 'none' },
  effects: [
    { kind: 'addToken', ability: `${definition}-encumber`, amount: 1, target: { kind: 'target' } },
    { kind: 'log', text: 'It winds tighter around them.', tone: 'bad' },
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
export const A_STORE_TORN_OFF_BY_A_REAL_WOUND = (definition: string): Printed => printed(definition, {
  id: `${definition}-torn-free`,
  name: 'Torn Free',
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
export const A_SPEND_GATED_ON_WHAT_THEY_CARRY = (definition: string): Printed => printed(definition, {
  id: `${definition}-crush`,
  name: 'Crush',
  text: 'Somebody wound tight enough is worth the effort of closing on.',
  cost: { stress: 1 },
  target: {
    kind: 'creature',
    range: 'melee',
    when: { kind: 'tokens', ability: `${definition}-encumber`, of: { kind: 'target' }, op: '>=', value: 3 },
  },
  inCombatOnly: true,
  effects: [
    { kind: 'log', text: 'It closes, and squeezes.', tone: 'bad' },
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
export const AN_OVERLOAD_THAT_BUYS_ANOTHER_TURN = (definition: string): Printed => printed(definition, {
  id: `${definition}-overload`,
  name: 'Overload',
  text: 'It can drive itself past what it should bear, and keep going afterwards.',
  kind: 'reaction',
  trigger: 'rollingDamage',
  action: false,
  cost: { stress: 1 },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'It overloads, and the blow comes down heavier.', tone: 'bad' },
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
export const A_WATCHER_THAT_ADDS_TO_A_HIT = (definition: string): Printed => printed(definition, {
  id: `${definition}-into-the-same-spot`,
  name: 'Into the Same Spot',
  text: 'It waits for somebody else to open a target up, and puts its own shot through it.',
  kind: 'reaction',
  trigger: 'allyRollingDamage',
  action: false,
  cost: { stress: 1 },
  available: { kind: 'withinRange', range: 'far' },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'It swings around and fires into the same spot.', tone: 'bad' },
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
export const A_HUNGER_DRAWN_TO_A_WOUND = (definition: string): Printed => printed(definition, {
  id: `${definition}-drawn-to-the-wound`,
  name: 'Drawn to the Wound',
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
    { kind: 'log', text: 'Blood in the air, and something turns toward it.', tone: 'bad' },
    { kind: 'move', how: 'toward', of: { kind: 'hit' }, range: 'melee', budget: 'close' },
    { kind: 'attack', target: { kind: 'hit' } },
  ],
});

/**
 * A rain that everyone in reach has to answer for themselves.
 *
 * The damage is rolled ONCE, before anybody rolls to avoid it, and both branches
 * spend that same number -- the successes halving it. That is the shape nearly
 * every area attack is written in, and it is why the halves always match the roll
 * rather than each being halved separately.
 *
 * The difficulty is a literal because it can only be one: `reactionRoll` takes a
 * number or 'roll', and cannot read the acting creature's own Difficulty. Any
 * test claiming otherwise is reading a coincidence.
 */
export const A_RAIN_THAT_EVERYONE_ANSWERS = (definition: string): Printed => printed(definition, {
  id: `${definition}-rain-of-cinders`,
  name: 'Rain of Cinders',
  text: 'It brings something down over everything in reach, and each of them answers for themselves.',
  cost: { bad: 1 },
  target: { kind: 'none', range: 'far' },
  inCombatOnly: true,
  effects: [
    { kind: 'log', text: 'Cinders come down over everything in reach.', tone: 'combat' },
    {
      kind: 'reactionRoll',
      difficulty: 14,
      trait: 'agility',
      targets: { kind: 'allies', range: 'far' },
      damage: { dice: '1d20+3', type: 'magic' },
      onFail: [{ kind: 'damage', dice: 'same' }],
      onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
    },
  ],
});

/**
 * A call for more of them: three more blocks on the map, at range.
 *
 * Two parameters, because what it calls in is not the same as what calls: the
 * summoned definition has to be a block the fight can actually index, and a
 * specimen that guessed would simply never arrive.
 */
export const A_CALL_FOR_MORE_OF_THEM = (definition: string, summons: string): Printed => printed(definition, {
  id: `${definition}-plenty-more`,
  name: 'Plenty More',
  text: 'There were always more of them than anyone counted.',
  cost: { bad: 1 },
  target: { kind: 'none' },
  inCombatOnly: true,
  effects: [{ kind: 'summon', adversary: summons, count: '3', range: 'far' }],
});

/**
 * A rally: its own turn, and a Stress to hand two others a turn as well.
 *
 * The Stress is what makes this interesting. An ordinary second spotlight is
 * bought with the GM's Shadow and would be refused with an empty pool, so what this
 * buys has to be honoured on its own terms -- which is the half a test pins by
 * counting who acted and checking that nothing was billed beyond the first, free
 * spotlight.
 */
export const A_RALLY_THAT_BUYS_TWO_TURNS = (definition: string): Printed => printed(definition, {
  id: `${definition}-press-the-advantage`,
  name: 'Press the Advantage',
  text: 'It spends its own breath putting two others where they will do the most harm.',
  kind: 'reaction',
  trigger: 'spotlighted',
  cost: { stress: 1 },
  target: { kind: 'none', range: 'close' },
  inCombatOnly: true,
  effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'close' }, count: '2' }],
});

/**
 * Roots put down once, and then never again.
 *
 * The gate is the whole specimen: without it a creature that rooted itself would
 * spend every other turn rooting again, because nothing it gains is visible to
 * the thing choosing its next move. `not hasCondition` is how a feature says
 * "there is nothing left here to do".
 *
 * Simplified: it stays where it is by choice rather than by rule. An adversary the
 * engine holds still spends its spotlight tearing free, which would undo the
 * feature every other turn.
 */
export const ROOTS_PUT_DOWN_ONCE = (definition: string): Printed => printed(definition, {
  id: `${definition}-put-down-roots`,
  name: 'Put Down Roots',
  text: 'It sets itself into the ground, and what is rooted is harder to move than to hit.',
  cost: { stress: 1 },
  target: { kind: 'self', range: 'melee' },
  inCombatOnly: true,
  available: { kind: 'not', of: { kind: 'hasCondition', condition: 'rooted', of: { kind: 'actor' } } },
  effects: [
    { kind: 'log', text: 'Roots go down into the stone.', tone: 'combat' },
    { kind: 'applyCondition', condition: 'rooted', duration: 'scene', target: { kind: 'actor' } },
  ],
});

/**
 * A breath that only comes when the dice allow it.
 *
 * Two gates in series, and they are different in kind. The first is a condition on
 * the blow -- two Hit Points marked, which is the number the hit left behind rather
 * than a band anything reads back. The second is a die rolled when the feature
 * fires, so the same wound does not always bring the same answer.
 *
 * The nesting matters to more than the rules: a test drives these effects through
 * the runner directly with rigged dice and reads the journal for a passed dice
 * check and a reaction, so flattening this into one list would break it in a way
 * that looks like a rules bug.
 *
 * The id ends in `-volcanic-breath` because a test asserts it. Normally a
 * specimen's id is mine to choose; this one is pinned.
 *
 * Simplified: it reaches the whole band rather than a flow in front of the
 * creature, the Stress is a flat two rather than a roll, and Vulnerable lasts the
 * scene rather than until a Stress is cleared.
 */
export const A_BREATH_GATED_ON_A_DIE = (definition: string): Printed => printed(definition, {
  id: `${definition}-volcanic-breath`,
  name: 'Volcanic Breath',
  text: 'Hurt it badly and it may answer with what it has been holding in its throat.',
  kind: 'reaction',
  trigger: 'tookDamage',
  action: false,
  available: { kind: 'count', of: 'hitPointsTaken', op: '>=', value: 2 },
  target: { kind: 'none' },
  effects: [
    {
      kind: 'diceCheck',
      dice: '1d10',
      atLeast: 8,
      then: [
        { kind: 'log', text: 'Something molten comes up its throat.', tone: 'bad' },
        {
          kind: 'reactionRoll',
          difficulty: 20,
          trait: 'agility',
          targets: { kind: 'allies', range: 'far' },
          damage: { dice: '2d10+4', type: 'physical' },
          onFail: [
            { kind: 'damage', dice: 'same', target: { kind: 'hit' } },
            { kind: 'markStress', amount: 2, target: { kind: 'hit' } },
            { kind: 'applyCondition', condition: 'vulnerable', duration: 'scene', target: { kind: 'hit' } },
          ],
          onSuccess: [
            { kind: 'damage', dice: 'same', half: true, target: { kind: 'hit' } },
            { kind: 'markStress', amount: 1, target: { kind: 'hit' } },
          ],
        },
      ],
    },
  ],
});

/**
 * A bonus read off the creature's own wounds.
 *
 * The gate is the interesting half. Unhurt, the bonus is nothing, and a Stress
 * spent for nothing is a Stress wasted -- so the feature is unavailable until
 * something has been taken out of it. A test pins exactly that: whole, it says
 * nothing and keeps the Stress it would have paid.
 */
export const A_BONUS_READ_OFF_ITS_OWN_WOUNDS = (definition: string): Printed => printed(definition, {
  id: `${definition}-reaper`,
  name: 'Reaper',
  text: 'What has been taken out of it, it puts back into the next blow.',
  kind: 'reaction',
  trigger: 'rollingDamage',
  action: false,
  cost: { stress: 1 },
  available: { kind: 'pool', pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked', op: '>=', value: 1 },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'Everything it has lost, it puts behind the next swing.', tone: 'bad' },
    { kind: 'boostDamage', amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } },
  ],
});

/**
 * A wound handed straight back to whoever opened it.
 *
 * What it returns is a count the blow carries -- `hitPointsTaken` -- not a number
 * read off a pool, which is the distinction between this and the bonus above. The
 * amount is therefore exact rather than approximate, and needs no gate to stay
 * honest.
 *
 * Simplified: the Shadow is one, rather than one for each Hit Point handed back.
 */
export const A_WOUND_HANDED_BACK = (definition: string): Printed => printed(definition, {
  id: `${definition}-my-turn`,
  name: 'My Turn',
  text: 'It does not intend to be the only one hurt in this fight.',
  kind: 'reaction',
  trigger: 'tookHitPoints',
  action: false,
  cost: { bad: 1 },
  target: { kind: 'none' },
  effects: [
    { kind: 'log', text: 'It will not be the only one bleeding.', tone: 'bad' },
    { kind: 'damage', amount: 'hitPointsTaken', target: { kind: 'target' } },
  ],
});

/**
 * A rally that hands two others at range a turn, out of the GM's pool.
 *
 * Priced in Shadow rather than Stress, which is the interesting half: the turn must
 * honour what the feature bought even when the pool cannot afford a second
 * spotlight of its own. A test pins exactly that -- both of the rallied act, though
 * the first of them could have gone again and the GM could not pay for it.
 *
 * Simplified: "two others of its own kind" is not something a target selector can
 * ask for, so the two nearest allies answer.
 */
export const A_RALLY_OF_TWO_AT_RANGE = (definition: string): Printed => printed(definition, {
  id: `${definition}-push-them-forward`,
  name: 'Push Them Forward',
  text: 'It spends the room\'s dread putting two others in front of itself.',
  cost: { bad: 1 },
  target: { kind: 'none', range: 'far' },
  inCombatOnly: true,
  effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '2' }],
});

/**
 * A call that arrives already swinging.
 *
 * `spotlight: true` on the summon is the whole point: what it calls in acts on the
 * turn it arrived, and the Shadow the feature paid covers that -- so the turn must
 * not bill the GM again for it. A test reads `badSpent` on each arrival and
 * expects nothing.
 *
 * Two parameters, because what arrives is not what called it.
 */
export const A_CALL_THAT_ARRIVES_SWINGING = (definition: string, summons: string): Printed => printed(definition, {
  id: `${definition}-the-hunt`,
  name: 'The Hunt',
  text: 'It calls, and what answers is already moving.',
  cost: { bad: 2 },
  target: { kind: 'none' },
  inCombatOnly: true,
  effects: [{ kind: 'summon', adversary: summons, count: '1d4', range: 'far', spotlight: true }],
});

/**
 * A rally with a rider: what it hands out strikes for half.
 *
 * `halfDamage` rides on the spotlight rather than on the creatures, so it lasts
 * the turn it bought and no longer -- a creature that takes a second spotlight the
 * GM paid for swings at full strength. That distinction is the whole of one test,
 * which counts which of four swings was softened.
 *
 * Simplified: the Shadow that would buy full damage is a choice made after the
 * allies are named, which nothing here asks for; it takes the half.
 */
export const A_RALLY_THAT_STRIKES_FOR_HALF = (definition: string): Printed => printed(definition, {
  id: `${definition}-borrowed-time`,
  name: 'Borrowed Time',
  text: 'The turns it hands out are not really theirs, and they land like it.',
  cost: { stress: 1 },
  target: { kind: 'none', range: 'far' },
  inCombatOnly: true,
  effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: '1d4', halfDamage: true }],
});
