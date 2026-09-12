/**
 * Cards for a test to play.
 *
 * Everything a character has is a card — a chosen one, or one their class or
 * ancestry put in play — so a test that needs a mechanism reaches for a card
 * that does it rather than for a source kind that implies it.
 *
 * These are named for **what they do**, not for anything they were read off.
 * Several blocks want the same machinery — a check that stops so somebody else
 * can answer it, a reroll offered to an ally — and naming them by mechanism is
 * what lets one specimen serve all of them without becoming a catalogue.
 *
 * They live outside `src/` with the rest of the fixtures: nothing the app
 * bundles may import them, so a fixture can never become shipped content.
 */

import { FIXTURE_CARDS } from './adversaries';

/** Which of the generic cards each specimen sits on. */
export const WATCHING_CARD = 'fixture-card-3';
export const REASSURANCE_CARD = 'fixture-card-5';
export const SUPPORT_CARD = 'fixture-card-4';
export const TAGGED_CARD = 'fixture-card-7';
export const OWN_REROLL_CARD = 'fixture-card-6';
/** Counts toward its own domain, which is what a card that counts cards reads. */
export const LIFT_CARD = 'fixture-card-8';
/** In the other domain, so holding it never adds to that count. */
export const SPELL_CARD = 'fixture-other-1';
/** A card that keeps a running count against a marked creature. */
export const MARKED_TALLY_CARD = 'fixture-card-9';
/** A card offered when somebody else is hurt. */
export const ANSWERING_CARD = 'fixture-card-10';
/** A card that takes some of what an ally is carrying. */
export const SHARING_CARD = 'fixture-card-11';
/** A card that spends whatever is sitting on it. */
export const CHAOS_CARD = 'fixture-card-12';

/**
 * The two asking cards, by the id a test names them with.
 *
 * The spend's ability id doubles as its token bucket, as the shipped cards do: one
 * card, one store, one name for both.
 */
export const SHARE_ABILITY = 'fixture-share';
export const CHAOS_ABILITY = 'fixture-chaos';

/**
 * The mark a tally counts, and the bucket it counts into.
 *
 * Both are plain names. A marker condition needs no definition -- `hasCondition`
 * reads the entity's own set -- and a token bucket is a label the card and the
 * tests agree on, not an ability id.
 */
export const MARKED = 'fixture-marked';
export const TALLY = 'fixture-tally';

/**
 * A check that stops to have its dice read.
 *
 * `difficulty: 'target'` against a creature, and arms that do almost nothing:
 * what tests want from this is the *pause* — the moment where a roll has been
 * thrown, nothing has been decided, and another card can be put to somebody.
 *
 * Deliberately untagged. A card gated on a tag must stay quiet on this roll,
 * which is a thing at least one test asserts.
 */
export const WATCHING_CHECK = [
  {
    id: 'fixture-watching',
    name: 'Watching',
    source: { kind: 'domainCard', card: WATCHING_CARD },
    text: 'Watch something a while and see what gives.',
    target: { kind: 'adversary', range: 'far' },
    action: false,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'instinct',
          difficulty: 'target',
          prompt: 'Watch them, and see what shows.',
          onCriticalSuccess: [{ kind: 'log', text: 'Something about it gives.', tone: 'hope' }],
          onSuccessWithHope: [{ kind: 'log', text: 'Something about it gives.', tone: 'hope' }],
          onSuccessWithFear: [{ kind: 'log', text: 'Something about it gives.', tone: 'hope' }],
        },
      },
    ],
  },
];

/**
 * A reroll its holder is offered on somebody *else's* roll.
 *
 * `not self` is the whole of it: the holder answers an ally's dice and never
 * their own. Free, so it has to be offered rather than taken — a card that
 * fired itself would spend its one use on the first throw of the fight.
 */
export const REASSURANCE = [
  {
    id: 'fixture-reassurance',
    name: 'Reassurance',
    source: { kind: 'domainCard', card: REASSURANCE_CARD },
    text: "A word at the right moment, and an ally's dice go back in the cup.",
    kind: 'reaction',
    trigger: 'partyRolling',
    uses: { count: 1, per: 'rest' },
    action: false,
    auto: false,
    available: { kind: 'not', of: { kind: 'self' } },
    effects: [
      { kind: 'log', text: 'A steady word, at exactly the right moment.', tone: 'hope' },
      { kind: 'rerollDuality', which: 'both' },
    ],
  },
];

/**
 * The same moment, narrower and repeatable: only a failure, only an ally
 * standing Close, and paid for every time. One die goes back rather than two.
 */
export const SUPPORT_TANK = [
  {
    id: 'fixture-support-tank',
    name: 'Support Tank',
    source: { kind: 'domainCard', card: SUPPORT_CARD },
    text: 'A shoulder in the way of a roll that went wrong, at a price.',
    kind: 'reaction',
    trigger: 'partyRolling',
    cost: { hope: 2 },
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'not', of: { kind: 'self' } },
        { kind: 'withinRange', range: 'close' },
        { kind: 'rolled', is: 'failure' },
      ],
    },
    effects: [
      { kind: 'log', text: 'A shoulder in the way, and room to try it again.', tone: 'hope' },
      { kind: 'rerollDuality', which: 'fear' },
    ],
  },
];

/**
 * The same stopping check, with a tag on the roll.
 *
 * A card can be gated on what a roll was *for* rather than on what it rolled,
 * and the only way to test that is to have one roll carry a tag and another
 * carry none. This is the tagged half; `WATCHING_CHECK` is the untagged one.
 */
export const TAGGED_CHECK = [
  {
    id: 'fixture-tagged-check',
    name: 'Getting Under It',
    source: { kind: 'domainCard', card: TAGGED_CARD },
    text: 'Say the thing that gets under it, and see what that costs them.',
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'presence',
          difficulty: 'target',
          tags: ['social'],
          prompt: 'Say the thing that gets under it.',
          onCriticalSuccess: [{ kind: 'markStress', target: { kind: 'hit' } }],
          onSuccessWithHope: [{ kind: 'markStress', target: { kind: 'hit' } }],
          onSuccessWithFear: [{ kind: 'markStress', target: { kind: 'hit' } }],
        },
      },
    ],
  },
];

/**
 * A reroll its holder takes on their *own* roll, and only a tagged one.
 *
 * The mirror of `REASSURANCE`: `self` where that one is `not self`, and gated
 * on the tag rather than offered on anybody's dice. Between them they say which
 * chair a card reads from.
 */
export const OWN_TAGGED_REROLL = [
  {
    id: 'fixture-own-tagged-reroll',
    name: 'Endless Charisma',
    source: { kind: 'domainCard', card: OWN_REROLL_CARD },
    text: 'They talk straight past the thing they just said.',
    kind: 'reaction',
    trigger: 'partyRolling',
    cost: { hope: 1 },
    action: false,
    auto: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'self' },
        { kind: 'rollTagged', tag: 'social' },
      ],
    },
    effects: [
      { kind: 'log', text: 'They talk straight past the thing they just said.', tone: 'hope' },
      { kind: 'rerollDuality', which: 'fear' },
    ],
  },
];

/**
 * A Spellcast Roll against a creature's own Difficulty.
 *
 * The plainest version of the shape the engine uses everywhere: a check that
 * stops, resolves against the target, and leaves something behind on a success.
 * Anything that answers or rescues a spellcast roll needs one of these to
 * answer, which is why it is here rather than in a block.
 */
export const SPELLCAST_CHECK = [
  {
    id: 'fixture-spellcast',
    name: 'Binding Word',
    source: { kind: 'domainCard', card: SPELL_CARD },
    text: 'Bind something where it stands.',
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          prompt: 'Bind them where they stand?',
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } },
            { kind: 'markStress', amount: 1, target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
];

/** A card carrying nothing, for a hand that must have no say in what happens. */
export const SILENT_CARD = 'fixture-card-1';

/** The cards themselves, for a project that has to carry them. */
export { FIXTURE_CARDS };

/**
 * A tally that counts what a marked creature does, and spends it on one blow.
 *
 * Four abilities on one card, which is how a card that watches, counts and then
 * pays out is written: the mark is set by an action, two reactions count -- one
 * for a wound the holder takes and one for a wound an ally takes -- and the
 * payout puts a die per token behind the next blow and clears the card.
 *
 * The counting reactions are the interesting half. They are gated on the mark
 * being on the creature that dealt the damage, so an unmarked attacker adds
 * nothing; and the ally one fires on a wound the holder never took, from across
 * the room. Both bank into the same bucket, because it is one card's count.
 */
export const A_TALLY_THAT_COUNTS_A_MARK = [
  {
    id: 'fixture-tally-set',
    name: 'Set the Mark',
    source: { kind: 'domainCard', card: MARKED_TALLY_CARD },
    text: 'Put a mark on something and begin keeping count of what it does.',
    target: { kind: 'adversary', range: 'close' },
    effects: [
      // One at a time: setting it again moves it rather than adding a second.
      { kind: 'clearCondition', condition: MARKED, target: { kind: 'adversaries', range: 'veryFar' } },
      { kind: 'log', text: 'The mark is set, and it will be answered for.', tone: 'hope' },
      { kind: 'applyCondition', condition: MARKED, duration: 'scene', target: { kind: 'target' } },
    ],
  },
  {
    id: 'fixture-tally-own',
    name: 'Set the Mark',
    source: { kind: 'domainCard', card: MARKED_TALLY_CARD },
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: { kind: 'hasCondition', condition: MARKED, of: { kind: 'target' } },
    target: { kind: 'none' },
    effects: [{ kind: 'addToken', ability: TALLY, amount: 1 }],
  },
  {
    id: 'fixture-tally-ally',
    name: 'Set the Mark',
    source: { kind: 'domainCard', card: MARKED_TALLY_CARD },
    kind: 'reaction',
    trigger: 'allyTookDamage',
    action: false,
    available: { kind: 'hasCondition', condition: MARKED, of: { kind: 'target' } },
    target: { kind: 'none' },
    effects: [{ kind: 'addToken', ability: TALLY, amount: 1 }],
  },
  {
    id: 'fixture-tally-paid',
    name: 'Set the Mark',
    source: { kind: 'domainCard', card: MARKED_TALLY_CARD },
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    // Nothing is asked and nothing is spent, so it simply happens -- and what it
    // rolled has to reach the blow being held rather than the log alone.
    available: {
      kind: 'all',
      of: [
        { kind: 'tokens', ability: TALLY, op: '>=', value: 1 },
        { kind: 'hasCondition', condition: MARKED, of: { kind: 'target' } },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'boostDamage', dice: 'd8', times: { tokens: TALLY } },
      { kind: 'spendToken', ability: TALLY, all: true },
    ],
  },
];

/**
 * An answer offered when a blow lands on somebody else.
 *
 * `auto: false` is what makes it a question rather than a rule: it costs a Stress,
 * so it has to be put to the player instead of firing itself. The range is read
 * from the holder to the one who dealt the damage -- a reach a selector can name,
 * where a weapon's own range is not.
 *
 * What it buys is a Reaction Roll the attacker has to make, and a Hit Point if
 * they fail it. Either way they were made to answer, which is the half a test
 * pins.
 */
export const AN_ANSWER_TO_A_BLOW_ON_AN_ALLY = [
  {
    id: 'fixture-answer',
    name: 'Not Finished',
    source: { kind: 'domainCard', card: ANSWERING_CARD },
    text: 'Hurt somebody standing near enough and you will be asked to account for it.',
    kind: 'reaction',
    trigger: 'allyTookDamage',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    inCombatOnly: true,
    available: { kind: 'withinRange', range: 'close', of: { kind: 'target' } },
    effects: [
      { kind: 'log', text: 'They are not finished with you.', tone: 'hope' },
      {
        kind: 'reactionRoll',
        difficulty: 15,
        targets: { kind: 'target' },
        onFail: [{ kind: 'damage', amount: 1, target: { kind: 'hit' } }],
      },
    ],
  },
];

/**
 * A share of what an ally is carrying, as much of it as the player says.
 *
 * `howMany` reads its ceiling off a pool on the TARGET -- how much marked Stress is
 * there to take -- so the buttons offered are one per point and no more. What each
 * one costs is written in `each` rather than in the asking: it comes off them, goes
 * onto whoever is carrying it, and the Hope follows the same number.
 *
 * Once per rest, because a card that could be asked twice in a fight would make
 * the ceiling meaningless.
 */
export const A_SHARE_OF_WHAT_THEY_CARRY = [
  {
    id: SHARE_ABILITY,
    name: 'Share the Weight',
    source: { kind: 'domainCard', card: SHARING_CARD },
    text: 'Take as much of what they are carrying as you are willing to carry yourself.',
    uses: { count: 1, per: 'rest' },
    target: { kind: 'ally', range: 'melee' },
    effects: [
      {
        kind: 'howMany',
        most: { pool: 'stress', of: { kind: 'target' }, measure: 'marked' },
        title: 'Share the Weight',
        body: 'How much of it do you take?',
        each: [
          { kind: 'clearStress', amount: 'spent', target: { kind: 'target' } },
          { kind: 'markStress', amount: 'spent', target: { kind: 'actor' } },
          { kind: 'gainHope', amount: 'spent', target: { kind: 'actor' } },
        ],
      },
    ],
  },
];

/**
 * A spend of whatever is sitting on the card, and dice to match.
 *
 * Here `howMany` reads its ceiling off the card's own TOKENS, which is the other
 * place a number can come from -- and `{n}d10` interpolates what was let go of, so
 * the dice follow the spend rather than being printed.
 *
 * The tokens go whether the roll lands or not: they pay for the attempt, which is
 * what putting them inside `each` ahead of the check says.
 */
export const A_SPEND_OF_WHATEVER_IS_ON_THE_CARD = [
  {
    id: CHAOS_ABILITY,
    name: 'Let It Out',
    source: { kind: 'domainCard', card: CHAOS_CARD },
    text: 'Whatever has been gathering on this card, let as much of it go as you like.',
    target: { kind: 'adversary', range: 'far' },
    // Refilled at a session's start, which a long rest counts as.
    tokens: { amount: 'spellcast', refill: 'session' },
    available: { kind: 'tokens', ability: CHAOS_ABILITY, op: '>=', value: 1 },
    effects: [
      {
        kind: 'howMany',
        most: { tokens: CHAOS_ABILITY },
        title: 'Let It Out',
        body: 'How much of it?',
        each: [
          { kind: 'spendToken', ability: CHAOS_ABILITY, amount: 'spent' },
          {
            kind: 'check',
            check: {
              trait: 'spellcast',
              difficulty: 'target',
              onSuccessWithHope: [{ kind: 'damage', dice: '{n}d10', type: 'magic' }],
            },
          },
        ],
      },
    ],
  },
];
