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

import {
  FIXTURE_AREA_CARD,
  FIXTURE_BOLD_CARD,
  FIXTURE_BONE_CARD,
  FIXTURE_CODEX_CARD,
  FIXTURE_PROVOKE_CARD,
  FIXTURE_SAGE_CARD,
  FIXTURE_WATCH_CARD,
  FIXTURE_RIFT_CARD,
  FIXTURE_RIFT_MARK,
  FIXTURE_SPOT_CARD,
  FIXTURE_SPOT_MARK,
  FIXTURE_AURA_CARD,
  FIXTURE_BARRAGE_CARD,
  FIXTURE_CARDS,
  FIXTURE_GRIMOIRE,
} from './adversaries';

/** What a successful cast does: ask, if there is a mark; otherwise simply mark. */
const RIFT_ARMS = [
  {
    kind: 'branch',
    when: { kind: 'hasMark', mark: FIXTURE_RIFT_MARK },
    then: [
      {
        kind: 'choice',
        title: 'Rift Step',
        body: 'The marking is still on the ground somewhere behind them.',
        options: [
          {
            label: 'Step through the rift',
            effects: [
              { kind: 'log', text: 'The air splits, and they walk back through it to the mark.', tone: 'hope' },
              { kind: 'move', to: 'mark', mark: FIXTURE_RIFT_MARK, teleport: true },
              { kind: 'forgetSpot', mark: FIXTURE_RIFT_MARK },
            ],
          },
          { label: 'Drop it and mark the ground here instead', effects: [{ kind: 'markSpot', mark: FIXTURE_RIFT_MARK }] },
        ],
      },
    ],
    otherwise: [{ kind: 'markSpot', mark: FIXTURE_RIFT_MARK }],
  },
];

/** A layer up, and as many more as the caster will pay Stress for. */
const AURA_LAYERS = [
  { kind: 'log', text: 'The air over them goes doubtful.', tone: 'hope' },
  { kind: 'addToken', ability: 'fixture-aura', amount: 1 },
  {
    kind: 'howMany',
    most: 3,
    least: 0,
    title: 'Doubtful Air',
    body: 'How many Stress for more layers?',
    each: [
      { kind: 'markStress', amount: 'spent', target: { kind: 'actor' } },
      { kind: 'addToken', ability: 'fixture-aura', amount: 'spent' },
    ],
  },
];

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
/** Cards that put something on a target and leave it there. */
export const TETHER_CARD = 'fixture-card-13';
export const HELD_CARD = 'fixture-card-14';
export const ROOM_HELD_CARD = 'fixture-card-15';
export const BLAST_CARD = 'fixture-card-16';
export const GLYPH_CARD = 'fixture-card-17';
/** Cards that answer a blow already in the air. */
export const CHARGE_CARD = 'fixture-card-18';
export const FORCED_CARD = 'fixture-card-19';
export const BREAK_CARD = 'fixture-card-20';
export const RAGE_CARD = 'fixture-card-21';
export const FLOOR_CARD = 'fixture-card-22';
export const GLORY_CARD = 'fixture-card-23';
export const EDGE_CARD = 'fixture-card-24';
export const ROOM_LIFT_CARD = 'fixture-card-25';
export const ROUSE_CARD = 'fixture-card-26';
export const TOLL_CARD = 'fixture-card-27';

/** Their abilities and stores, by the id a test names them with. */
export const CHARGE_TOKENS = 'fixture-charge-store';
export const CHARGE_ABILITY = 'fixture-charge';
export const FORCED_ABILITY = 'fixture-forced';
export const BREAK_ABILITY = 'fixture-break';
export const BREAK_PAID = 'fixture-break-paid';
export const RAGE_ABILITY = 'fixture-rage';
export const FLOOR_ABILITY = 'fixture-floor';
export const GLORY_ABILITY = 'fixture-glory';
export const EDGE_ABILITY = 'fixture-edge';
export const ROOM_LIFT_ABILITY = 'fixture-room-lift';
export const ROUSE_ABILITY = 'fixture-rouse';
export const TOLL_ABILITY = 'fixture-toll';
export const TOLL_PAID = 'fixture-toll-paid';

/** Two more bare markers: no definition, because they carry no numbers. */
export const BROKEN = 'fixture-broken';
export const TOLLED = 'fixture-tolled';

/** Their abilities, by the id a test names them with. */
export const TETHER_ABILITY = 'fixture-tether';
export const HELD_ABILITY = 'fixture-hold';
export const HELD_TIGHTEN = 'fixture-hold-tighten';
export const ROOM_HELD_ABILITY = 'fixture-room-hold';
export const ROOM_HELD_RELEASE = 'fixture-room-hold-release';
export const BLAST_ABILITY = 'fixture-blast';
export const GLYPH_ABILITY = 'fixture-glyph';

/**
 * Two conditions that carry a real number, and therefore need defining.
 *
 * A bare marker needs no definition -- `hasCondition` reads the entity's own set --
 * but a test asserting a held creature is two easier to hit is reading a modifier
 * off the definition, not off the card that applied it.
 */
export const HELD = 'fixture-held-fast';
export const GLYPHED = 'fixture-glyphed';

export const HELD_CONDITION = {
  id: HELD,
  name: 'Held Fast',
  text: 'Your attention is fixed on the one holding it, and nothing else reaches you.',
  modifiers: [{ stat: 'evasion', bonus: -2 }],
};

export const GLYPHED_CONDITION = {
  id: GLYPHED,
  name: 'Glyphed',
  text: 'A mark on your body says where you are weakest.',
  modifiers: [{ stat: 'evasion', bonus: -2 }],
};

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

/**
 * A tether: bound where they stand, and it costs them something.
 *
 * `restrained` is deliberately the engine's own condition rather than a fixture
 * one. What a test wants from this is the engine's handling of `temporary` on an
 * adversary -- it spends its spotlight tearing free -- and a fixture condition
 * would be testing my definition instead of that.
 */
export const A_TETHER_THAT_BINDS = [
  {
    id: TETHER_ABILITY,
    name: 'Tether',
    source: { kind: 'domainCard', card: TETHER_CARD },
    text: 'Put a line on something at range and hold it where it stands.',
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

/**
 * A hold on one creature, and a second ability that tightens it.
 *
 * The gate on the follow-up sits on `target.when`, so until somebody is actually
 * under the hold it offers no targets at all -- which is a different thing from
 * being refused, and is what one test reads.
 */
export const A_HOLD_ON_ONE_OF_THEM = [
  {
    id: HELD_ABILITY,
    name: 'Hold',
    source: { kind: 'domainCard', card: HELD_CARD },
    text: 'Take hold of what something is paying attention to.',
    target: { kind: 'adversary', range: 'close' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          prompt: 'Hold their attention?',
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: HELD, duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: HELD_TIGHTEN,
    name: 'Hold',
    source: { kind: 'domainCard', card: HELD_CARD },
    text: 'Tighten what is already held, and make them feel it.',
    cost: { stress: 1 },
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'close', when: { kind: 'hasCondition', condition: HELD } },
    effects: [
      { kind: 'log', text: 'The hold tightens, and it costs them.', tone: 'hope' },
      { kind: 'markStress', amount: 1, target: { kind: 'target' } },
    ],
  },
];

/**
 * The same hold across a whole band, and a release that ends it for all of them.
 *
 * The release marks everybody and clears the condition in one move, because the
 * hold ending IS the condition coming off -- there is nothing else holding it.
 */
export const A_HOLD_ON_THE_WHOLE_ROOM = [
  {
    id: ROOM_HELD_ABILITY,
    name: 'Hold the Room',
    source: { kind: 'domainCard', card: ROOM_HELD_CARD },
    text: 'Take hold of everything in the room at once.',
    target: { kind: 'none', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'far' },
          prompt: 'Hold the whole room?',
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: HELD, duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: ROOM_HELD_RELEASE,
    name: 'Hold the Room',
    source: { kind: 'domainCard', card: ROOM_HELD_CARD },
    text: 'Let go of all of them at once, and let it cost them on the way out.',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    effects: [
      { kind: 'log', text: 'The hold breaks, and every one of them feels it.', tone: 'hope' },
      { kind: 'markStress', amount: 1, target: { kind: 'adversaries', range: 'far' } },
      { kind: 'clearCondition', condition: HELD, target: { kind: 'adversaries', range: 'far' } },
    ],
  },
];

/**
 * A blast whose ring is read around the one it hit.
 *
 * `around: 'target'` is the whole specimen. A ring read from the caster's chair
 * would catch whoever is standing near HER, which in the test that reads this is
 * nobody at all -- both creatures are across the room, together.
 */
export const A_BLAST_AROUND_WHAT_IT_HIT = [
  {
    id: BLAST_ABILITY,
    name: 'Burst',
    source: { kind: 'domainCard', card: BLAST_CARD },
    text: 'Throw something that comes apart where it lands.',
    target: { kind: 'adversary', range: 'veryFar' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          prompt: 'Throw it?',
          onSuccessWithHope: [
            { kind: 'log', text: 'It comes apart where it lands.', tone: 'combat' },
            {
              kind: 'reactionRoll',
              difficulty: 13,
              trait: 'agility',
              targets: { kind: 'adversaries', range: 'veryClose', around: 'target' },
              onFail: [{ kind: 'damage', dice: 'd20+5', type: 'magic', using: 'proficiency', target: { kind: 'hit' } }],
              onSuccess: [
                { kind: 'damage', dice: 'd20+5', type: 'magic', using: 'proficiency', half: true, target: { kind: 'hit' } },
              ],
            },
          ],
        },
      },
    ],
  },
];

/** A glyph that says where somebody is weakest, bought with Hope. */
export const A_GLYPH_THAT_OPENS_THEM_UP = [
  {
    id: GLYPH_ABILITY,
    name: 'Glyph',
    source: { kind: 'domainCard', card: GLYPH_CARD },
    text: 'Write something on them that says where they are weakest.',
    cost: { hope: 1 },
    target: { kind: 'adversary', range: 'veryClose' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          prompt: 'Mark their weak points?',
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: GLYPHED, duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
];

/**
 * A charge that banks wounds and spends them as dice.
 *
 * Two abilities: one banks what the holder took, the other spends it. The spend is
 * `auto: false`, which is what makes the blow WAIT -- a test reads the swing
 * stopping with nothing marked and the question up, and another reads the same
 * swing landing when the card is let pass.
 */
export const A_CHARGE_THAT_BANKS_A_WOUND = [
  {
    id: 'fixture-charge-store-ability',
    name: 'Charge',
    source: { kind: 'domainCard', card: CHARGE_CARD },
    text: 'What wounds you goes into the card instead of being wasted.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The wound goes into the card.', tone: 'hope' },
      { kind: 'addToken', ability: CHARGE_TOKENS, amount: 'hitPointsTaken' },
    ],
  },
  {
    id: CHARGE_ABILITY,
    name: 'Charge',
    source: { kind: 'domainCard', card: CHARGE_CARD },
    text: 'Put as much of what the card is holding behind the blow as you like.',
    kind: 'reaction',
    trigger: 'rollingDamage',
    // Spending is a decision, so the blow waits to be answered.
    auto: false,
    action: false,
    available: { kind: 'tokens', ability: CHARGE_TOKENS, op: '>=', value: 1 },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'howMany',
        most: { tokens: CHARGE_TOKENS },
        title: 'Charge',
        body: 'How much of it goes into the blow?',
        each: [
          { kind: 'spendToken', ability: CHARGE_TOKENS, amount: 'spent' },
          { kind: 'boostDamage', dice: '{n}d6' },
        ],
      },
    ],
  },
];

/**
 * A blow forced from the caster's own wounds, whatever the dice said.
 *
 * The gate earns its place twice over: nothing marked is nothing forced, so the
 * four Stress would be wasted -- and a test reads the card not being OFFERED to an
 * unmarked caster, which is a different thing from being refused.
 */
export const A_BLOW_FORCED_FROM_ITS_OWN_WOUNDS = [
  {
    id: FORCED_ABILITY,
    name: 'Answer in Kind',
    source: { kind: 'domainCard', card: FORCED_CARD },
    text: 'Everything done to you can be handed back exactly, if you will pay for it.',
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    auto: false,
    cost: { stress: 4 },
    available: { kind: 'pool', pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked', op: '>=', value: 1 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Everything it has done comes back the other way.', tone: 'hope' },
      { kind: 'forceHitPoints', amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } },
    ],
  },
];

/**
 * A crack opened on one blow and gone through with the next.
 *
 * One card, two moments. The first costs a Stress and leaves a marker; the second
 * asks nothing and spends nothing, because the crack was paid for already -- and it
 * clears the marker, so the next blow after that finds nothing.
 */
export const A_CRACK_PAID_FOR_IN_ADVANCE = [
  {
    id: BREAK_ABILITY,
    name: 'Breaking Blow',
    source: { kind: 'domainCard', card: BREAK_CARD },
    text: 'Open something up now and come back through it.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Something in their guard gives way.', tone: 'hope' },
      { kind: 'applyCondition', condition: BROKEN, duration: 'scene', target: { kind: 'target' } },
    ],
  },
  {
    id: BREAK_PAID,
    name: 'Breaking Blow',
    source: { kind: 'domainCard', card: BREAK_CARD },
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    available: { kind: 'hasCondition', condition: BROKEN, of: { kind: 'target' } },
    target: { kind: 'none' },
    effects: [
      { kind: 'boostDamage', dice: '2d12' },
      { kind: 'clearCondition', condition: BROKEN, target: { kind: 'target' } },
    ],
  },
];

/** A bonus read off the sheet rather than printed: twice a trait. */
export const A_BONUS_OFF_THE_SHEET = [
  {
    id: RAGE_ABILITY,
    name: 'Rage Up',
    source: { kind: 'domainCard', card: RAGE_CARD },
    text: 'Put your shoulder into it, and pay for it afterwards.',
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Something gives, and it is not them.', tone: 'hope' },
      { kind: 'boostDamage', amount: { trait: 'strength', times: 2 } },
    ],
  },
];

/**
 * A floor under every blow, and the one card here that is not a decision.
 *
 * No cost and no `auto: false`, so nothing is asked: a test reads the blow being
 * lifted to the band with `pending` still null, which is how the absence of a
 * question is pinned.
 */
export const A_FLOOR_UNDER_EVERY_BLOW = [
  {
    id: FLOOR_ABILITY,
    name: 'Onslaught',
    source: { kind: 'domainCard', card: FLOOR_CARD },
    text: 'Nothing you land comes in under its weight.',
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    target: { kind: 'none' },
    effects: [{ kind: 'forceSeverity', severity: 'major', least: true }],
  },
];

/** A critical worth a Hope or a Stress, asked once. */
export const A_CRITICAL_WORTH_SOMETHING = [
  {
    id: GLORY_ABILITY,
    name: 'Gore and Glory',
    source: { kind: 'domainCard', card: GLORY_CARD },
    text: 'A blow that tells is worth something beyond the wound.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    available: { kind: 'rolled', is: 'critical' },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'choice',
        title: 'Gore and Glory',
        body: 'The blow tells.',
        options: [
          { label: 'Gain a Hope', effects: [{ kind: 'gainHope', amount: 1, target: { kind: 'actor' } }] },
          { label: 'Clear a Stress', effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }] },
        ],
      },
    ],
  },
];

/**
 * An edge asked three times, each for a Hope.
 *
 * Three separate questions in the order they are written, each gated on there still
 * being a Hope to spend, and each offering a plain "No". That is what lets a test
 * answer yes, no, yes and find exactly two Hope gone.
 */
export const AN_EDGE_ASKED_THREE_TIMES = [
  {
    id: EDGE_ABILITY,
    name: 'Champion\'s Edge',
    source: { kind: 'domainCard', card: EDGE_CARD },
    text: 'A blow that tells buys as much as you are willing to spend on it.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    auto: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'rolled', is: 'critical' },
        { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
      ],
    },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
        then: [
          {
            kind: 'choice',
            title: 'Edge',
            body: 'Spend a Hope to clear a Hit Point?',
            options: [
              {
                label: 'Clear a Hit Point (1 Hope)',
                effects: [
                  { kind: 'spendHope', amount: 1 },
                  { kind: 'heal', amount: 1, target: { kind: 'actor' } },
                ],
              },
              { label: 'No' },
            ],
          },
        ],
      },
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
        then: [
          {
            kind: 'choice',
            title: 'Edge',
            body: 'Spend a Hope to clear an Armor Slot?',
            options: [
              {
                label: 'Clear an Armor Slot (1 Hope)',
                effects: [
                  { kind: 'spendHope', amount: 1 },
                  { kind: 'clearArmor', amount: 1, target: { kind: 'actor' } },
                ],
              },
              { label: 'No' },
            ],
          },
        ],
      },
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
        then: [
          {
            kind: 'choice',
            title: 'Edge',
            body: 'Spend a Hope to make them mark another Hit Point?',
            options: [
              {
                label: 'They mark a Hit Point (1 Hope)',
                effects: [
                  { kind: 'spendHope', amount: 1 },
                  { kind: 'damage', amount: 1, direct: true, target: { kind: 'target' } },
                ],
              },
              { label: 'No' },
            ],
          },
        ],
      },
    ],
  },
];

/** What the sight of a critical is worth to everyone standing nearby. */
export const A_LIFT_FOR_EVERYONE_NEARBY = [
  {
    id: ROOM_LIFT_ABILITY,
    name: 'Inspiration',
    source: { kind: 'domainCard', card: ROOM_LIFT_CARD },
    text: 'What they just saw is worth something to all of them.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    uses: { count: 1, per: 'rest' },
    available: { kind: 'rolled', is: 'critical' },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'choice',
        title: 'Inspiration',
        body: 'What the sight of it is worth.',
        options: [
          {
            label: 'Everyone nearby clears a Stress',
            effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'allies', range: 'veryClose' } }],
          },
          {
            label: 'Everyone nearby gains a Hope',
            effects: [{ kind: 'gainHope', amount: 1, target: { kind: 'allies', range: 'veryClose' } }],
          },
        ],
      },
    ],
  },
];

/** The same moment, counting its holder in -- which is the difference. */
export const A_ROUSING_BLOW = [
  {
    id: ROUSE_ABILITY,
    name: 'Rousing Strike',
    source: { kind: 'domainCard', card: ROUSE_CARD },
    text: 'A blow the whole room takes something from, yourself included.',
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    uses: { count: 1, per: 'rest' },
    available: { kind: 'rolled', is: 'critical' },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'choice',
        title: 'Rousing Strike',
        body: 'What the room takes from it.',
        options: [
          {
            label: 'Everyone clears a Hit Point',
            effects: [{ kind: 'heal', amount: 1, target: { kind: 'allies', range: 'far', includeSelf: true } }],
          },
          {
            label: 'Everyone clears 2 Stress',
            effects: [{ kind: 'clearStress', amount: 2, target: { kind: 'allies', range: 'far', includeSelf: true } }],
          },
        ],
      },
    ],
  },
];

/**
 * A toll set on one creature and called in later.
 *
 * Setting it moves it: the mark comes off everybody else and the store is emptied
 * first, so the card holds one creature at a time. Calling it in is gated on BOTH
 * the tokens and the mark, which is what a test reads by adding the mark and taking
 * it away again.
 */
export const A_TOLL_CALLED_IN = [
  {
    id: TOLL_ABILITY,
    name: 'Toll',
    source: { kind: 'domainCard', card: TOLL_CARD },
    text: 'Name what something owes you, and collect it when you choose.',
    target: { kind: 'adversary', range: 'far' },
    effects: [
      { kind: 'clearCondition', condition: TOLLED, target: { kind: 'adversaries', range: 'veryFar' } },
      { kind: 'spendToken', ability: TOLL_ABILITY, all: true },
      { kind: 'log', text: 'The toll is set, and it will be paid.', tone: 'hope' },
      { kind: 'applyCondition', condition: TOLLED, duration: 'scene', target: { kind: 'target' } },
      { kind: 'addToken', ability: TOLL_ABILITY, amount: 1 },
    ],
  },
  {
    id: TOLL_PAID,
    name: 'Toll',
    source: { kind: 'domainCard', card: TOLL_CARD },
    kind: 'reaction',
    trigger: 'rollingDamage',
    auto: false,
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'tokens', ability: TOLL_ABILITY, op: '>=', value: 1 },
        { kind: 'hasCondition', condition: TOLLED, of: { kind: 'target' } },
      ],
    },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'howMany',
        most: { tokens: TOLL_ABILITY },
        title: 'Toll',
        body: 'Call it in?',
        each: [
          { kind: 'spendToken', ability: TOLL_ABILITY, amount: 'spent' },
          { kind: 'boostDamage', dice: '{n}d12' },
        ],
      },
    ],
  },
];

/**
 * Two spells in one book, which is what a grimoire is.
 *
 * Each ability is named for the feature it is: `abilityText` looks the ABILITY's
 * name up among the card's features and falls back to the card's own text, so a
 * book whose name matched one of its spells would shadow the lookup a test is
 * about. One reaches Melee and shoves; the other reaches Far, and exists so that
 * asking for the first never answers with the second.
 */
export const A_BOOK_OF_TWO_SPELLS = [
  {
    id: 'fixture-grimoire-shove',
    name: 'Shove',
    source: { kind: 'domainCard', card: FIXTURE_GRIMOIRE },
    target: { kind: 'adversary', range: 'melee' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [
            { kind: 'damage', dice: 'd10+2', type: 'magic', using: 'proficiency' },
            { kind: 'push', to: 'far', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: 'fixture-grimoire-splinter',
    name: 'Splinter',
    source: { kind: 'domainCard', card: FIXTURE_GRIMOIRE },
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [{ kind: 'damage', dice: 'd6', type: 'physical', using: 'proficiency' }],
        },
      },
    ],
  },
];

/**
 * One roll, a whole band, and a Hope paid up front.
 *
 * What the tests reading this pin is the ENGINE's bookkeeping rather than the card's:
 * the prompt carries the caster's Spellcast trait and modifier, the Hope leaves
 * before the dice are thrown, the turn is not spent until they are, and putting the
 * card back down returns what it cost. The only thing of mine they read is the name,
 * because the step-back line is built out of it.
 */
export const A_SPELL_FOR_A_WHOLE_BAND = [
  {
    id: 'fixture-bladefall',
    name: 'Bladefall',
    source: { kind: 'domainCard', card: FIXTURE_AREA_CARD },
    text: 'Fill the air around you with edges, and let everything near answer for it.',
    cost: { hope: 1 },
    target: { kind: 'none', range: 'veryClose' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'veryClose' },
          prompt: 'Fill the air with edges?',
          onSuccessWithHope: [{ kind: 'damage', dice: 'd8+2', type: 'magic', using: 'proficiency' }],
        },
      },
    ],
  },
];

/**
 * A barrage whose size the player chooses, which only code can build.
 *
 * "Any number of Hope" is not a count an effect can express: the options depend on
 * what the caster holds at the moment of asking. So the card runs a hook, and the
 * hook is the project's own.
 *
 * Its `uses` is what a test is about: the use is banked when the card is played and
 * handed back when the choice it opened with is cancelled.
 */
export const A_BARRAGE_THAT_ASKS = [
  {
    id: 'fixture-barrage',
    name: 'Barrage',
    source: { kind: 'domainCard', card: FIXTURE_BARRAGE_CARD },
    text: 'Throw as much of what you are holding as you care to spend.',
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'close' },
    available: { kind: 'pool', pool: 'hope', op: '>=', value: 1 },
    effects: [{ kind: 'run', hook: 'fixture-barrage' }],
  },
];

/**
 * The project code behind it, shaped as a project carries code.
 *
 * `compileHooks` gives this the same context the engine's own hooks get, so it reads
 * the pool, builds one option per point, and queues the choice.
 */
export const A_BARRAGE_HOOK = {
  id: 'fixture-barrage',
  name: 'Barrage',
  notes: 'One option per Hope the caster holds, each throwing that many dice.',
  source: `var actor = ctx.actor;
var target = ctx.targets[0];
if (actor === null || target === undefined) return;
var hope = ctx.pool(actor, 'hope') || 0;
if (hope < 1) {
  ctx.log('Nothing to throw: the barrage never forms.', 'system');
  return;
}
var options = [];
for (var spent = 1; spent <= hope; spent++) {
  options.push({
    label: spent + ' Hope: ' + spent + 'd6 magic',
    effects: [
      { kind: 'spendHope', amount: spent },
      { kind: 'damage', dice: spent + 'd6', type: 'magic', target: { kind: 'target' } },
    ],
  });
}
ctx.queue([{ kind: 'choice', title: 'Barrage', body: 'How much of it goes into this?', options: options }]);`,
};

/**
 * An aura of layers, once per long rest, and a throw that answers a blow.
 *
 * `per: 'longRest'` is load-bearing beyond this card. A rest test reads a use key off
 * the project's abilities and needs one a short rest keeps and a long rest clears; a
 * `per: 'rest'` ability would be cleared by both.
 */
export const AN_AURA_OF_LAYERS = [
  {
    id: 'fixture-aura',
    name: 'Doubtful Air',
    source: { kind: 'domainCard', card: FIXTURE_AURA_CARD },
    text: 'Put a layer of doubt over where you stand, and more if you can bear it.',
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'self' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 14,
          prompt: 'Put a layer of doubt over where you stand?',
          onCriticalSuccess: AURA_LAYERS,
          onSuccessWithHope: AURA_LAYERS,
          onSuccessWithFear: AURA_LAYERS,
        },
      },
    ],
  },
  {
    id: 'fixture-aura-layers',
    name: 'Doubtful Air',
    source: { kind: 'domainCard', card: FIXTURE_AURA_CARD },
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    available: { kind: 'tokens', ability: 'fixture-aura', op: '>=', value: 1 },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'branch',
        // A die per layer, all at once.
        when: { kind: 'chance', dice: '1d6', atLeast: 5, times: { tokens: 'fixture-aura' } },
        then: [
          { kind: 'log', text: 'The blow goes through a layer that was never there.', tone: 'hope' },
          { kind: 'spendToken', ability: 'fixture-aura', amount: 1 },
          { kind: 'avoidBlow' },
        ],
        otherwise: [
          { kind: 'log', text: 'Every layer holds still, and the blow finds the real one. The air clears.', tone: 'fear' },
          { kind: 'spendToken', ability: 'fixture-aura', all: true },
        ],
      },
    ],
  },
];

/**
 * A mark on the ground, and a way back to it.
 *
 * One ability, two behaviours, decided by whether the mark is already down: the first
 * cast marks where the caster stands, the second takes them back to it and forgets it.
 * So the card ends when they reappear, and casting again marks afresh.
 *
 * The mark is a tile kept under the caster's name, which is why a rest forgets it and
 * why leaving the room does: a tile means nothing in another one.
 */
export const A_STEP_BACK_TO_A_MARK = [
  {
    id: 'fixture-phantom-step',
    name: 'Phantom Step',
    source: { kind: 'domainCard', card: FIXTURE_SPOT_CARD },
    text: 'Leave a mark where you are standing, and come back to it when it suits you.',
    cost: { hope: 1 },
    target: { kind: 'self' },
    action: false,
    effects: [
      {
        kind: 'branch',
        when: { kind: 'hasMark', mark: FIXTURE_SPOT_MARK },
        then: [
          { kind: 'log', text: 'They are not there any more; they are where they were.', tone: 'hope' },
          { kind: 'move', to: 'mark', mark: FIXTURE_SPOT_MARK, teleport: true },
          { kind: 'forgetSpot', mark: FIXTURE_SPOT_MARK },
        ],
        otherwise: [{ kind: 'markSpot', mark: FIXTURE_SPOT_MARK }],
      },
    ],
  },
];

/**
 * The same idea behind a roll, and a choice on the way back.
 *
 * The difficulty is a flat number rather than a target's, because nothing is being cast
 * at anybody. A success with the mark already down asks which the caster wants: step
 * through to it, or drop it and mark here instead -- which is the whole of one test,
 * answered at each index in turn.
 */
export const A_RIFT_THAT_OPENS = [
  {
    id: 'fixture-rift-step',
    name: 'Rift Step',
    source: { kind: 'domainCard', card: FIXTURE_RIFT_CARD },
    text: 'Open a way back to somewhere you have already been standing.',
    target: { kind: 'self' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 15,
          prompt: 'A marking on the ground, or the way back to one?',
          onCriticalSuccess: RIFT_ARMS,
          onSuccessWithHope: RIFT_ARMS,
          onSuccessWithFear: RIFT_ARMS,
        },
      },
    ],
  },
];

/**
 * Boldness offered after the dice, on a roll that failed.
 *
 * Offered rather than taken (`auto: false`), because it costs a Light: a card that fired
 * itself would spend on the first throw of the fight. The gate has three parts and each
 * earns its place — the holder's own roll, made with one named trait, and only a failure.
 * A test proves the middle one by rolling a different trait and finding nothing offered.
 *
 * `raiseRoll` moves the number behind the dice without touching the dice: a test asserts
 * the Hope and Fear faces are unchanged and only the total moved.
 */
export const A_BOLDNESS_ON_A_FAILED_ROLL = [
  {
    id: 'fixture-bold-front',
    name: 'Bold Front',
    source: { kind: 'domainCard', card: FIXTURE_BOLD_CARD },
    text: 'When a word of yours falls short, put your weight behind it instead.',
    kind: 'reaction',
    trigger: 'partyRolling',
    cost: { hope: 1 },
    action: false,
    auto: false,
    available: {
      kind: 'all',
      of: [{ kind: 'self' }, { kind: 'rolledWith', trait: 'presence' }, { kind: 'rolled', is: 'failure' }],
    },
    effects: [
      { kind: 'log', text: 'They put their shoulders into it.', tone: 'hope' },
      { kind: 'raiseRoll', amount: { trait: 'strength' } },
    ],
  },
];

/**
 * A Presence roll to fail, so the card above has something to answer.
 *
 * `difficulty: 'target'` against a creature, which fails often enough to find in a seed
 * hunt and succeeds often enough to be a real roll. What the success does is incidental
 * — the point is that a Presence roll happened.
 */
export const A_PROVOCATION = [
  {
    id: 'fixture-needle-them',
    name: 'Needle Them',
    source: { kind: 'domainCard', card: FIXTURE_PROVOKE_CARD },
    text: 'Say the thing that gets under it.',
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'presence',
          difficulty: 'target',
          tags: ['social'],
          prompt: 'Say the thing that gets under it?',
          onCriticalSuccess: [{ kind: 'markStress', amount: 1, target: { kind: 'hit' } }],
          onSuccessWithHope: [{ kind: 'markStress', amount: 1, target: { kind: 'hit' } }],
          onSuccessWithFear: [{ kind: 'markStress', amount: 1, target: { kind: 'hit' } }],
        },
      },
    ],
  },
];

/**
 * An Instinct roll, in the OTHER domain.
 *
 * Two jobs, and the domain is the second one. It gives a roll made with a trait the
 * boldness above does not answer, proving that gate; and because it sits outside the
 * gated domain, a hand of five holding it leaves exactly four in-domain cards — which is
 * what makes a four-of-one-domain gate testable at all.
 */
export const A_WATCHFUL_READ = [
  {
    id: 'fixture-read-them',
    name: 'Read Them',
    source: { kind: 'domainCard', card: FIXTURE_WATCH_CARD },
    text: 'Watch something a while and see what it gives away.',
    action: false,
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'instinct',
          difficulty: 'target',
          prompt: 'Watch them, and see what shows?',
          onCriticalSuccess: [{ kind: 'log', text: 'Something about it gives.', tone: 'hope' }],
          onSuccessWithHope: [{ kind: 'log', text: 'Something about it gives.', tone: 'hope' }],
          onSuccessWithFear: [{ kind: 'log', text: 'Something about it gives.', tone: 'hope' }],
        },
      },
    ],
  },
];

/**
 * Proficiency behind a failed Spellcast roll, for a Stress, with four of the domain held.
 *
 * The domain gate counts cards in the LOADOUT — `loadoutDomain` filters the derived
 * character's own cards, so project content counts exactly as shipped content does. Which
 * is why a test can satisfy this by carrying four fixture cards.
 */
export const CODEX_BOUND = [
  {
    id: 'fixture-codex-bound',
    name: 'Codex-Bound',
    source: { kind: 'domainCard', card: FIXTURE_CODEX_CARD },
    text: 'What the books taught you is there when the words come out wrong — at a price.',
    kind: 'reaction',
    trigger: 'partyRolling',
    cost: { stress: 1 },
    action: false,
    auto: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'self' },
        { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 },
        { kind: 'rolledWith', trait: 'spellcast' },
        { kind: 'rolled', is: 'failure' },
      ],
    },
    effects: [
      { kind: 'log', text: 'They reach for what the books taught them, and it costs them.', tone: 'hope' },
      { kind: 'raiseRoll', amount: { trait: 'proficiency' } },
    ],
  },
];

/**
 * The rolled trait again, on a failure, once per rest.
 *
 * Two traits answer it, and which one it raises is read off which was rolled — so the
 * branch is not decoration: a test drives it through an Instinct roll from a card and
 * through an Agility roll from a weapon swing, and expects the matching trait both times.
 */
export const WILD_BOUND = [
  {
    id: 'fixture-wild-bound',
    name: 'Wild-Bound',
    source: { kind: 'domainCard', card: FIXTURE_SAGE_CARD },
    text: 'The wild in you answers what you already were.',
    kind: 'reaction',
    trigger: 'partyRolling',
    uses: { count: 1, per: 'rest' },
    action: false,
    auto: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'self' },
        { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 },
        { kind: 'rolled', is: 'failure' },
        {
          kind: 'any',
          of: [
            { kind: 'rolledWith', trait: 'agility' },
            { kind: 'rolledWith', trait: 'instinct' },
            // A weapon swing is a roll with the WEAPON's trait, and the bow's is
            // Finesse. Without this the card answers no weapon in the starter pack.
            { kind: 'rolledWith', trait: 'finesse' },
          ],
        },
      ],
    },
    effects: [
      { kind: 'log', text: 'The wild in them answers, and the roll is twice what it was.', tone: 'hope' },
      {
        kind: 'branch',
        when: { kind: 'rolledWith', trait: 'agility' },
        then: [{ kind: 'raiseRoll', amount: { trait: 'agility' } }],
        otherwise: [
          {
            kind: 'branch',
            when: { kind: 'rolledWith', trait: 'finesse' },
            then: [{ kind: 'raiseRoll', amount: { trait: 'finesse' } }],
            otherwise: [{ kind: 'raiseRoll', amount: { trait: 'instinct' } }],
          },
        ],
      },
    ],
  },
];

/**
 * A blow that landed, made to miss, for three Light and once per rest.
 *
 * A script defence: offered beside the ordinary answers when a swing lands, and its label
 * is the card's own name, which a test finds by looking for it among the choices.
 */
export const BONE_BOUND = [
  {
    id: 'fixture-bone-bound',
    name: 'Bone-Bound',
    source: { kind: 'domainCard', card: FIXTURE_BONE_CARD },
    text: 'You were simply never where the blow was going.',
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    cost: { hope: 3 },
    uses: { count: 1, per: 'rest' },
    available: { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'They are simply not where the blow was going.', tone: 'hope' },
      { kind: 'avoidBlow' },
    ],
  },
];

/**
 * A reaction that answers a blow, with nothing in front of it.
 *
 * `reactionsOf` asks for the reactions a creature holds against `incomingDamage`, and a test
 * about THAT should not also be a test of a gate. The two fixture reactions already on this
 * trigger are deliberately gated -- one on tokens held, one on a four-card loadout and 3 Hope --
 * and both are what other suites use to prove a gate refuses. This one is held by a named
 * character and asks nothing, so what it proves is that the offer arrives at all.
 *
 * `granted` rather than a card: no card to hold, no loadout to arrange, nothing to get wrong in
 * the setup of a test that is about something else.
 */
export const A_GUARD_THAT_ANSWERS = [
  {
    id: 'fixture-guard-that-answers',
    name: 'Guard',
    source: { kind: 'granted', characters: ['kara'] },
    text: 'A blade already on the way to where the blow was going.',
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    target: { kind: 'none' },
    effects: [{ kind: 'log', text: 'The guard comes up in time.', tone: 'hope' }],
  },
];
