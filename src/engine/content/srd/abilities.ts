/**
 * The SRD's cards and features, scripted.
 *
 * Each entry names a card (or a class's Hope feature, or a subclass card) by
 * the id the vendored SRD content uses, and says what using it does in the
 * one effect vocabulary. The text is not repeated here: the card's own text
 * comes from the content at display time, so the words on the button are the
 * SRD's and only the mechanics are the engine's.
 *
 * Not every card is here. A card without an entry is still held and shown —
 * it is text the table adjudicates, as at a real one — and `docs/CARDS.md`
 * lists which are which. Conventions for what is here:
 *
 * - "Make a Spellcast Roll against a target within X range" is a `check` with
 *   `trait: 'spellcast'` and `difficulty: 'target'`; what happens "on a
 *   success" goes in `onSuccessWithHope` (which `onSuccessWithFear` falls back
 *   to), aimed at `hit`.
 * - "deal d8+2 magic damage using your Proficiency" is `damage` with `dice`,
 *   `type` and `using: 'proficiency'`.
 * - "Spend a Hope to …" is a `cost`, paid before the script runs; "mark a
 *   Stress to …" likewise. A cost the actor cannot pay refuses the use.
 * - "Once per rest" is `uses: { count: 1, per: 'rest' }`.
 * - "When you take damage, …" is a `reaction` to `incomingDamage`, used
 *   automatically when it lowers the Hit Points marked.
 * - "Gain a +1 bonus to …" is a `modifier`, folded into the sheet.
 * - A Hope feature costs 3 Hope and is not the character's action unless it
 *   rolls something.
 */

import { z } from 'zod';
import { abilitySchema, type AbilityDef } from '../abilities';

type Input = z.input<typeof abilitySchema>;

const card = (id: string): Input['source'] => ({ kind: 'domainCard', card: id });
const hope = (classId: string): Input['source'] => ({ kind: 'classHope', classId });
const subclass = (subclassId: string, stage: 'foundation' | 'specialization' | 'mastery'): Input['source'] => ({
  kind: 'subclass',
  subclassId,
  stage,
});

const RAW: Input[] = [
  // ---- Blade -----------------------------------------------------------------
  {
    id: 'get-back-up',
    name: 'Get Back Up',
    source: card('get-back-up'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { stress: 1 },
    action: false,
    reaction: { kind: 'reduceSeverity', steps: 1, only: 'severe' },
  },
  {
    id: 'not-good-enough',
    name: 'Not Good Enough',
    source: card('not-good-enough'),
    kind: 'passive',
    action: false,
    // "You can reroll any 1s or 2s" on damage dice: text for the table until
    // the damage roll learns rerolls.
  },
  {
    id: 'whirlwind',
    name: 'Whirlwind',
    source: card('whirlwind'),
    cost: { hope: 1 },
    target: { kind: 'adversary', range: 'veryClose' },
    effects: [
      {
        kind: 'attack',
        onHit: [
          // The same attack roll against everyone *else* in reach: no second
          // roll, the weapon's own dice halved for the ones it reaches.
          {
            kind: 'check',
            check: {
              trait: 'weapon',
              difficulty: 'target',
              roll: 'last',
              targets: { kind: 'adversaries', range: 'veryClose', except: 'target' },
              // Half of the damage the swing itself dealt, not a second roll.
              onSuccessWithHope: [{ kind: 'damage', dice: 'same', half: true }],
            },
          },
        ],
      },
    ],
  },
  {
    id: 'reckless',
    name: 'Reckless',
    source: card('reckless'),
    cost: { stress: 1 },
    target: { kind: 'adversary', range: 'far' },
    effects: [{ kind: 'attack', advantage: 1 }],
  },
  {
    id: 'fortified-armor',
    name: 'Fortified Armor',
    source: card('fortified-armor'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'thresholds', bonus: 2, requires: 'armored' }],
  },
  {
    id: 'a-soldiers-bond',
    name: "A Soldier's Bond",
    source: card('a-soldiers-bond'),
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'ally', range: 'close' },
    available: { kind: 'not', of: { kind: 'inCombat' } },
    action: false,
    effects: [
      { kind: 'log', text: 'A word of respect, and it lands.', tone: 'hope' },
      { kind: 'gainHope', amount: 3 },
      { kind: 'gainHope', amount: 3, target: { kind: 'target' } },
    ],
  },
  // ---- Valor -----------------------------------------------------------------
  {
    id: 'bare-bones',
    name: 'Bare Bones',
    source: card('bare-bones'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'bareBones', requires: 'unarmored' }],
  },
  {
    id: 'forceful-push',
    name: 'Forceful Push',
    source: card('forceful-push'),
    target: { kind: 'adversary', range: 'melee' },
    effects: [
      {
        kind: 'attack',
        weapon: 'primary',
        onHit: [
          { kind: 'push', to: 'close' },
          {
            kind: 'choice',
            title: 'Forceful Push',
            options: [
              {
                label: 'Spend a Hope: they are left Vulnerable',
                available: { kind: 'pool', pool: 'hope', op: '>=', value: 1 },
                effects: [{ kind: 'spendHope' }, { kind: 'applyCondition', condition: 'vulnerable', target: { kind: 'hit' } }],
              },
              { label: 'Leave it there', effects: [] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'i-am-your-shield',
    name: 'I Am Your Shield',
    source: card('i-am-your-shield'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { stress: 1 },
    target: { kind: 'ally', range: 'veryClose' },
    action: false,
    // Offered to the ally being hit, never taken automatically: standing in
    // the way is the holder's decision, and it costs them.
    reaction: { kind: 'redirect' },
    auto: false,
  },
  {
    id: 'body-basher',
    name: 'Body Basher',
    source: card('body-basher'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'damageRoll', plusTrait: 'strength', requires: 'meleeWeapon' }],
  },
  // ---- Bone ------------------------------------------------------------------
  {
    id: 'untouchable',
    name: 'Untouchable',
    source: card('untouchable'),
    kind: 'passive',
    action: false,
    // "Half your Agility": a modifier adds a whole trait, so this stays text.
  },
  // ---- Midnight --------------------------------------------------------------
  {
    id: 'vanishing-dodge',
    name: 'Vanishing Dodge',
    source: card('vanishing-dodge'),
    kind: 'reaction',
    trigger: 'attackMissed',
    cost: { hope: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    action: false,
    auto: false,
    // The shadow, not the step: the teleport within Close range of the
    // attacker is the table's to describe, and `docs/CARDS.md` says so.
    effects: [
      { kind: 'log', text: 'Shadow closes over the space where they stood.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'hidden', duration: 'scene', target: { kind: 'actor' } },
    ],
  },
  {
    id: 'pick-and-pull',
    name: 'Pick and Pull',
    source: card('pick-and-pull'),
    kind: 'passive',
    action: false,
    // Advantage on lock, trap and theft rolls: the check editor tags a roll;
    // the advantage is the next step. Text for the table.
  },
  {
    id: 'rain-of-blades',
    name: 'Rain of Blades',
    source: card('rain-of-blades'),
    cost: { hope: 1 },
    target: { kind: 'none', range: 'veryClose' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'veryClose' },
          prompt: 'Conjure blades against everything within Very Close range?',
          onSuccessWithHope: [
            { kind: 'damage', dice: 'd8+2', type: 'magic', using: 'proficiency' },
            // "If a target you hit is Vulnerable, they take an extra 1d8 damage."
            { kind: 'damage', dice: '1d8', type: 'magic', target: { kind: 'hit', having: 'vulnerable' } },
          ],
        },
      },
    ],
  },
  {
    id: 'shadowbind',
    name: 'Shadowbind',
    source: card('shadowbind'),
    target: { kind: 'none', range: 'veryClose' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'veryClose' },
          onSuccessWithHope: [{ kind: 'applyCondition', condition: 'restrained', target: { kind: 'hit' } }],
        },
      },
    ],
  },
  {
    id: 'midnight-spirit',
    name: 'Midnight Spirit',
    source: card('midnight-spirit'),
    cost: { hope: 1 },
    target: { kind: 'adversary', range: 'veryFar' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [{ kind: 'damage', dice: 'd6', type: 'magic', using: 'spellcast' }],
        },
      },
    ],
  },
  // ---- Arcana ----------------------------------------------------------------
  {
    id: 'unleash-chaos',
    name: 'Unleash Chaos',
    source: card('unleash-chaos'),
    target: { kind: 'adversary', range: 'far' },
    // "At the beginning of a session, place a number of tokens equal to your
    // Spellcast trait on this card": a session refills on a long rest.
    tokens: { amount: 'spellcast', refill: 'session' },
    available: { kind: 'tokens', ability: 'unleash-chaos', op: '>=', value: 1 },
    effects: [{ kind: 'run', hook: 'unleash-chaos' }],
  },
  // ---- Codex -----------------------------------------------------------------
  {
    id: 'book-of-illiat-slumber',
    name: 'Slumber',
    source: card('book-of-illiat'),
    target: { kind: 'adversary', range: 'veryClose' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          // Not "temporary": it does not shake off, it ends on damage or a Fear.
          onSuccessWithHope: [{ kind: 'applyCondition', condition: 'asleep', duration: 'scene', target: { kind: 'hit' } }],
        },
      },
    ],
  },
  {
    id: 'book-of-illiat-arcane-barrage',
    name: 'Arcane Barrage',
    source: card('book-of-illiat'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'close' },
    available: { kind: 'pool', pool: 'hope', op: '>=', value: 1 },
    // "Any number of Hope" is a count only code can build: `srd/hooks.ts`.
    effects: [{ kind: 'run', hook: 'arcane-barrage' }],
  },
  {
    id: 'book-of-tyfar-wild-flame',
    name: 'Wild Flame',
    source: card('book-of-tyfar'),
    target: { kind: 'none', range: 'melee' },
    // "Up to three adversaries": the cap is a hook's, the roll is the vocabulary's.
    effects: [{ kind: 'run', hook: 'wild-flame' }],
  },
  {
    id: 'book-of-ava-power-push',
    name: 'Power Push',
    source: card('book-of-ava'),
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
    id: 'book-of-ava-tavas-armor',
    name: "Tava's Armor",
    source: card('book-of-ava'),
    cost: { hope: 1 },
    target: { kind: 'ally', range: 'melee' },
    effects: [
      { kind: 'clearCondition', condition: 'tavas-armor', target: { kind: 'party' } },
      { kind: 'applyCondition', condition: 'tavas-armor', duration: 'rest', target: { kind: 'target' } },
    ],
  },
  {
    id: 'book-of-ava-ice-spike',
    name: 'Ice Spike',
    source: card('book-of-ava'),
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
  // ---- Arcana ----------------------------------------------------------------
  {
    id: 'rune-ward',
    name: 'Rune Ward',
    source: card('rune-ward'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { hope: 1 },
    action: false,
    // "If the Ward Die result is 8, the ward's power ends" until the next rest:
    // the ward here never breaks; noted in docs/CARDS.md.
    reaction: { kind: 'reduceDamage', dice: '1d8' },
  },
  // ---- Splendor --------------------------------------------------------------
  {
    id: 'bolt-beacon',
    name: 'Bolt Beacon',
    source: card('bolt-beacon'),
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [
            // "On a success, spend a Hope to send a bolt…": the Hope is spent on
            // the hit, and with none to spend there is no bolt.
            {
              kind: 'branch',
              when: { kind: 'pool', pool: 'hope', op: '>=', value: 1 },
              then: [
                { kind: 'spendHope' },
                { kind: 'damage', dice: 'd8+2', type: 'magic', using: 'proficiency' },
                { kind: 'applyCondition', condition: 'vulnerable', target: { kind: 'hit' } },
              ],
              otherwise: [{ kind: 'log', text: 'No Hope to spend: the bolt never forms.', tone: 'system' }],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'mending-touch',
    name: 'Mending Touch',
    source: card('mending-touch'),
    cost: { hope: 2 },
    target: { kind: 'ally', range: 'melee' },
    available: { kind: 'not', of: { kind: 'inCombat' } },
    action: false,
    effects: [
      {
        kind: 'choice',
        title: 'Mending Touch',
        options: [
          { label: 'Clear a Hit Point', effects: [{ kind: 'heal', amount: 1, target: { kind: 'target' } }] },
          { label: 'Clear a Stress', effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'target' } }] },
        ],
      },
    ],
  },
  {
    id: 'healing-hands',
    name: 'Healing Hands',
    source: card('healing-hands'),
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'ally', range: 'melee' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 13,
          onSuccessWithHope: [
            { kind: 'markStress' },
            {
              kind: 'choice',
              title: 'Healing Hands',
              options: [
                { label: 'Clear 2 Hit Points', effects: [{ kind: 'heal', amount: 2, target: { kind: 'target' } }] },
                { label: 'Clear 2 Stress', effects: [{ kind: 'clearStress', amount: 2, target: { kind: 'target' } }] },
              ],
            },
          ],
          onFailureWithHope: [
            { kind: 'markStress' },
            {
              kind: 'choice',
              title: 'Healing Hands',
              options: [
                { label: 'Clear a Hit Point', effects: [{ kind: 'heal', amount: 1, target: { kind: 'target' } }] },
                { label: 'Clear a Stress', effects: [{ kind: 'clearStress', amount: 1, target: { kind: 'target' } }] },
              ],
            },
          ],
        },
      },
    ],
  },
  // Enrapture is text: "their attention is fixed on you" is the table's to play.
  // ---- A second pass over the decks ------------------------------------------
  // Everything the vocabulary can carry, domain by domain. A card here whose
  // text says more than the entry does has the difference written in
  // `docs/CARDS.md`, so the table knows what it is still adjudicating.

  // ---- Arcana ----------------------------------------------------------------
  {
    id: 'cinder-grasp',
    name: 'Cinder Grasp',
    source: card('cinder-grasp'),
    target: { kind: 'adversary', range: 'melee' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          // The burn that follows — extra damage when they act while alight —
          // is the condition's text and the table's to apply.
          onSuccessWithHope: [
            { kind: 'damage', dice: '1d20+3', type: 'magic' },
            { kind: 'applyCondition', condition: 'on-fire', duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: 'preservation-blast',
    name: 'Preservation Blast',
    source: card('preservation-blast'),
    target: { kind: 'none', range: 'melee' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'melee' },
          onSuccessWithHope: [
            { kind: 'damage', dice: 'd8+3', type: 'magic', using: 'spellcast' },
            { kind: 'push', to: 'far', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: 'chain-lightning',
    name: 'Chain Lightning',
    source: card('chain-lightning'),
    cost: { stress: 2 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'close' },
          onSuccessWithHope: [
            {
              kind: 'reactionRoll',
              // "A Difficulty equal to the result of your Spellcast Roll."
              difficulty: 'roll',
              targets: { kind: 'hit' },
              onFail: [{ kind: 'damage', dice: '2d8+4', type: 'magic' }],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'earthquake',
    name: 'Earthquake',
    source: card('earthquake'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'none', range: 'veryFar' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 16,
          onSuccessWithHope: [
            { kind: 'log', text: 'The ground bucks and splits for as far as anyone can see.', tone: 'combat' },
            {
              kind: 'reactionRoll',
              difficulty: 18,
              targets: { kind: 'adversaries', range: 'veryFar' },
              // Rolled once, up front: those who kept their feet take half of
              // the number that hit the ones who did not.
              damage: { dice: '3d10+8', type: 'physical' },
              onFail: [
                { kind: 'damage', dice: 'same' },
                { kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'hit' } },
              ],
              onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'falling-sky',
    name: 'Falling Sky',
    source: card('falling-sky'),
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    effects: [{ kind: 'run', hook: 'falling-sky' }],
  },
  {
    id: 'arcana-touched',
    name: 'Arcana-Touched',
    source: card('arcana-touched'),
    kind: 'passive',
    action: false,
    // The second half — switching the Hope and Fear dice once per rest — is
    // text; the bonus is a modifier that reads the loadout it is written about.
    modifiers: [
      { stat: 'spellcastRoll', bonus: 1, when: { kind: 'loadout', domain: 'arcana', op: '>=', value: 4 } },
    ],
  },

  // ---- Blade -----------------------------------------------------------------
  {
    id: 'blade-touched',
    name: 'Blade-Touched',
    source: card('blade-touched'),
    kind: 'passive',
    action: false,
    modifiers: [
      { stat: 'attackRoll', bonus: 2, when: { kind: 'loadout', domain: 'blade', op: '>=', value: 4 } },
      { stat: 'severeThreshold', bonus: 4, when: { kind: 'loadout', domain: 'blade', op: '>=', value: 4 } },
    ],
  },

  // ---- Bone ------------------------------------------------------------------
  {
    id: 'brace',
    name: 'Brace',
    source: card('brace'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { stress: 1 },
    action: false,
    reaction: { kind: 'extraArmor', slots: 1 },
  },
  {
    id: 'on-the-brink',
    name: 'On the Brink',
    source: card('on-the-brink'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    // "When you have 2 or fewer Hit Points unmarked": the reaction is only
    // offered while that holds, which is what `available` says.
    available: { kind: 'pool', pool: 'hitPoints', measure: 'available', op: '<=', value: 2 },
    reaction: { kind: 'reduceSeverity', steps: 1, only: 'minor' },
  },
  {
    id: 'swift-step',
    name: 'Swift Step',
    source: card('swift-step'),
    kind: 'reaction',
    trigger: 'attackMissed',
    action: false,
    effects: [
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'stress', measure: 'marked', op: '>=', value: 1 },
        then: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }],
        otherwise: [{ kind: 'gainHope', amount: 1, target: { kind: 'actor' } }],
      },
    ],
  },
  {
    id: 'cruel-precision',
    name: 'Cruel Precision',
    source: card('cruel-precision'),
    kind: 'passive',
    action: false,
    // "Equal to either your Finesse or Agility": the sheet takes Finesse, which
    // is the trait the card's own domain rolls with.
    modifiers: [{ stat: 'damageRoll', bonus: 0, plusTrait: 'finesse' }],
  },

  // ---- Grace -----------------------------------------------------------------
  {
    id: 'inspirational-words',
    name: 'Inspirational Words',
    source: card('inspirational-words'),
    target: { kind: 'ally', range: 'close' },
    action: false,
    tokens: { amount: 'presence', refill: 'longRest' },
    available: { kind: 'tokens', ability: 'inspirational-words', op: '>=', value: 1 },
    effects: [
      {
        kind: 'choice',
        title: 'What do they take from it?',
        options: [
          {
            label: 'They clear a Stress',
            effects: [
              { kind: 'spendToken', ability: 'inspirational-words', amount: 1 },
              { kind: 'clearStress', amount: 1, target: { kind: 'target' } },
            ],
          },
          {
            label: 'They clear a Hit Point',
            effects: [
              { kind: 'spendToken', ability: 'inspirational-words', amount: 1 },
              { kind: 'heal', amount: 1, target: { kind: 'target' } },
            ],
          },
          {
            label: 'They gain a Hope',
            effects: [
              { kind: 'spendToken', ability: 'inspirational-words', amount: 1 },
              { kind: 'gainHope', amount: 1, target: { kind: 'target' } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'hypnotic-shimmer',
    name: 'Hypnotic Shimmer',
    source: card('hypnotic-shimmer'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          // "In front of you" is the table's line; the engine does not model facing.
          targets: { kind: 'adversaries', range: 'close' },
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: 'stunned', duration: 'temporary', target: { kind: 'hit' } },
            { kind: 'markStress', amount: 1, target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },

  // ---- Midnight --------------------------------------------------------------
  {
    id: 'chokehold',
    name: 'Chokehold',
    source: card('chokehold'),
    cost: { stress: 1 },
    target: { kind: 'adversary', range: 'melee' },
    action: false,
    // The extra 2d6 an attacker deals to someone held this way is text: the
    // engine's Vulnerable is the SRD's, and this card's is a stronger one.
    effects: [{ kind: 'applyCondition', condition: 'vulnerable', duration: 'temporary', target: { kind: 'target' } }],
  },

  // ---- Sage ------------------------------------------------------------------
  {
    id: 'vicious-entangle',
    name: 'Vicious Entangle',
    source: card('vicious-entangle'),
    target: { kind: 'adversary', range: 'far' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [
            { kind: 'damage', dice: '1d8+1', type: 'physical' },
            { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: 'conjure-swarm-fire-flies',
    name: 'Fire Flies',
    source: card('conjure-swarm'),
    cost: { hope: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    // The card's other swarm, the beetles that soak a blow, is text.
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'close' },
          onSuccessWithHope: [{ kind: 'damage', dice: '2d8+3', type: 'magic' }],
        },
      },
    ],
  },
  {
    id: 'corrosive-projectile',
    name: 'Corrosive Projectile',
    source: card('corrosive-projectile'),
    target: { kind: 'adversary', range: 'far' },
    // Corroded — a standing penalty to a creature's Difficulty — is text.
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [{ kind: 'damage', dice: 'd6+4', type: 'magic', using: 'proficiency' }],
        },
      },
    ],
  },
  {
    id: 'towering-stalk',
    name: 'Towering Stalk',
    source: card('towering-stalk'),
    uses: { count: 1, per: 'rest' },
    cost: { stress: 1 },
    target: { kind: 'none', range: 'close' },
    inCombatOnly: true,
    // The stalk itself — something to climb, up to Far range — is the table's.
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'close' },
          onSuccessWithHope: [{ kind: 'damage', dice: 'd8', type: 'physical', using: 'proficiency' }],
        },
      },
    ],
  },
  {
    id: 'healing-field',
    name: 'Healing Field',
    source: card('healing-field'),
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'none', range: 'close' },
    effects: [
      {
        kind: 'choice',
        title: 'How deep does it run?',
        options: [
          {
            label: 'Everyone clears a Hit Point',
            effects: [{ kind: 'heal', amount: 1, target: { kind: 'allies', range: 'close', includeSelf: true } }],
          },
          {
            label: 'Spend 2 Hope: everyone clears 2',
            effects: [
              { kind: 'spendHope', amount: 2 },
              { kind: 'heal', amount: 2, target: { kind: 'allies', range: 'close', includeSelf: true } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'rejuvenation-barrier',
    name: 'Rejuvenation Barrier',
    source: card('rejuvenation-barrier'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'none', range: 'veryClose' },
    // The barrier that stands afterwards, and the resistance inside it, is text.
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 15,
          onSuccessWithHope: [
            { kind: 'heal', dice: '1d4', target: { kind: 'allies', range: 'veryClose', includeSelf: true } },
          ],
        },
      },
    ],
  },

  // ---- Splendor --------------------------------------------------------------
  {
    id: 'healing-strike',
    name: 'Healing Strike',
    source: card('healing-strike'),
    kind: 'reaction',
    trigger: 'dealtDamage',
    cost: { hope: 2 },
    action: false,
    target: { kind: 'ally', range: 'close' },
    // Simplified: the nearest ally rather than a chosen one. The card is
    // played in answer to a swing that has already landed, and the question
    // put to the player is whether to spend the Hope, not who to aim it at.
    effects: [{ kind: 'heal', amount: 1, target: { kind: 'allies', range: 'close', nearest: 1 } }],
  },
  {
    id: 'second-wind',
    name: 'Second Wind',
    source: card('second-wind'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'melee' },
    inCombatOnly: true,
    // "On a success with Hope, an ally clears too": the attack does not branch
    // on Hope, so the ally's share is text.
    effects: [
      {
        kind: 'attack',
        onHit: [
          {
            kind: 'choice',
            title: 'What does the opening buy you?',
            options: [
              { label: 'Clear 3 Stress', effects: [{ kind: 'clearStress', amount: 3, target: { kind: 'actor' } }] },
              { label: 'Clear a Hit Point', effects: [{ kind: 'heal', amount: 1, target: { kind: 'actor' } }] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'restoration',
    name: 'Restoration',
    source: card('restoration'),
    target: { kind: 'ally', range: 'melee' },
    action: false,
    tokens: { amount: 'spellcast', refill: 'longRest' },
    available: { kind: 'tokens', ability: 'restoration', op: '>=', value: 1 },
    // One token at a time: "spend any number" is the same choice made twice.
    effects: [
      {
        kind: 'choice',
        title: 'What does the touch mend?',
        options: [
          {
            label: 'Clear 2 Hit Points',
            effects: [
              { kind: 'spendToken', ability: 'restoration', amount: 1 },
              { kind: 'heal', amount: 2, target: { kind: 'target' } },
            ],
          },
          {
            label: 'Clear 2 Stress',
            effects: [
              { kind: 'spendToken', ability: 'restoration', amount: 1 },
              { kind: 'clearStress', amount: 2, target: { kind: 'target' } },
            ],
          },
          {
            label: 'Clear Vulnerable',
            effects: [
              { kind: 'spendToken', ability: 'restoration', amount: 1 },
              { kind: 'clearCondition', condition: 'vulnerable', target: { kind: 'target' } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'stunning-sunlight',
    name: 'Stunning Sunlight',
    source: card('stunning-sunlight'),
    cost: { hope: 1 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // One Hope, everyone it beat: "spend any number of Hope and force that
    // many targets" is a count the prompt does not ask for yet.
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'far' },
          onSuccessWithHope: [
            {
              kind: 'reactionRoll',
              difficulty: 14,
              targets: { kind: 'hit' },
              onFail: [
                { kind: 'damage', dice: '4d20+5', type: 'magic' },
                { kind: 'applyCondition', condition: 'stunned', duration: 'temporary', target: { kind: 'hit' } },
              ],
              onSuccess: [{ kind: 'damage', dice: '3d20+3', type: 'magic' }],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'voice-of-reason',
    name: 'Voice of Reason',
    source: card('voice-of-reason'),
    kind: 'passive',
    action: false,
    // "When all of your Stress slots are marked": the bonus is to damage rolls,
    // and Proficiency is what a damage roll multiplies, so it is written there.
    modifiers: [
      {
        stat: 'proficiency',
        bonus: 1,
        when: { kind: 'pool', pool: 'stress', measure: 'available', op: '<=', value: 0 },
      },
    ],
  },
  {
    id: 'splendor-touched',
    name: 'Splendor-Touched',
    source: card('splendor-touched'),
    kind: 'passive',
    action: false,
    modifiers: [
      { stat: 'severeThreshold', bonus: 3, when: { kind: 'loadout', domain: 'splendor', op: '>=', value: 4 } },
    ],
  },

  // ---- Valor -----------------------------------------------------------------
  // A card that answers something which has already happened, rather than
  // damage on its way in. The fight raises `tookHitPoints` and `dealtDamage`
  // for the party the way it does for a stat block; a card that costs
  // something is offered to the player, and a free one that asks nothing runs
  // on its own.
  {
    id: 'rise-up-guard',
    name: 'Rise Up',
    source: card('rise-up'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'severeThreshold', plusProficiency: true }],
  },
  {
    id: 'rise-up',
    name: 'Rise Up',
    source: card('rise-up'),
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    effects: [{ kind: 'clearStress', target: { kind: 'actor' } }],
  },
  {
    id: 'armorer',
    name: 'Armorer',
    source: card('armorer'),
    kind: 'passive',
    action: false,
    // The downtime half — allies clearing an Armor Slot when you repair yours —
    // is a rest move, not a number on the sheet.
    modifiers: [{ stat: 'armorScore', bonus: 1, requires: 'armored' }],
  },
  {
    id: 'shrug-it-off',
    name: 'Shrug It Off',
    source: card('shrug-it-off'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { stress: 1 },
    action: false,
    // The d6 that sends the card to the vault afterwards is text.
    reaction: { kind: 'reduceSeverity', steps: 1 },
  },
  {
    id: 'ground-pound',
    name: 'Ground Pound',
    source: card('ground-pound'),
    cost: { hope: 2 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'strength',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'veryClose' },
          onSuccessWithHope: [
            { kind: 'push', to: 'far', target: { kind: 'hit' } },
            {
              kind: 'reactionRoll',
              difficulty: 17,
              targets: { kind: 'hit' },
              damage: { dice: '4d10+8', type: 'physical' },
              onFail: [{ kind: 'damage', dice: 'same' }],
              onSuccess: [{ kind: 'damage', dice: 'same', half: true }],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'valor-touched',
    name: 'Valor-Touched',
    source: card('valor-touched'),
    kind: 'passive',
    action: false,
    modifiers: [
      { stat: 'armorScore', bonus: 1, when: { kind: 'loadout', domain: 'valor', op: '>=', value: 4 } },
    ],
  },

  // ---- Class Hope features ----------------------------------------------------
  {
    id: 'guardian-frontline-tank',
    name: 'Frontline Tank',
    source: hope('guardian'),
    cost: { hope: 3 },
    available: { kind: 'pool', pool: 'armorSlots', measure: 'marked', op: '>=', value: 1 },
    action: false,
    effects: [{ kind: 'clearArmor', amount: 2 }],
  },
  {
    id: 'rogue-rogues-dodge',
    name: "Rogue's Dodge",
    source: hope('rogue'),
    cost: { hope: 3 },
    available: { kind: 'not', of: { kind: 'hasCondition', condition: 'dodging', of: { kind: 'actor' } } },
    action: false,
    effects: [{ kind: 'applyCondition', condition: 'dodging', duration: 'rest', target: { kind: 'actor' } }],
  },
  {
    id: 'wizard-not-this-time',
    name: 'Not This Time',
    source: hope('wizard'),
    kind: 'reaction',
    trigger: 'attackHit',
    cost: { hope: 3 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    action: false,
    // "Force an adversary within Far range to reroll an attack or damage
    // roll": offered when the attack lands, and paid for only if taken.
    reaction: { kind: 'reroll', what: 'either' },
    auto: false,
  },
  // ---- Subclass cards ---------------------------------------------------------
  {
    id: 'stalwart-unwavering',
    name: 'Unwavering',
    source: subclass('stalwart', 'foundation'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'thresholds', bonus: 1 }],
  },
  {
    id: 'stalwart-iron-will',
    name: 'Iron Will',
    source: subclass('stalwart', 'foundation'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    reaction: { kind: 'extraArmor', slots: 1, only: 'physical' },
  },
  {
    id: 'stalwart-unrelenting',
    name: 'Unrelenting',
    source: subclass('stalwart', 'specialization'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'thresholds', bonus: 2 }],
  },
  {
    id: 'stalwart-undaunted',
    name: 'Undaunted',
    source: subclass('stalwart', 'mastery'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'thresholds', bonus: 3 }],
  },
  {
    id: 'nightwalker-fleeting-shadow',
    name: 'Fleeting Shadow',
    source: subclass('nightwalker', 'mastery'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'evasion', bonus: 1 }],
  },
];

/**
 * Every SRD ability the engine can run. Ids are the card's id, or the card's
 * id and the spell's name for a grimoire's several spells.
 */
export const SRD_ABILITIES: readonly AbilityDef[] = RAW.map((raw) => abilitySchema.parse(raw));

/** The library by id. */
export const SRD_ABILITY_MAP: ReadonlyMap<string, AbilityDef> = new Map(SRD_ABILITIES.map((a) => [a.id, a]));
