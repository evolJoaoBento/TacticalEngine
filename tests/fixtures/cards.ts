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

/** A card carrying nothing, for a hand that must have no say in what happens. */
export const SILENT_CARD = 'fixture-card-1';

/** The cards themselves, for a project that has to carry them. */
export { FIXTURE_CARDS };
