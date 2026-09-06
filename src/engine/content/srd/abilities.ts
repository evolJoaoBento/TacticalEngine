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
 * - A Hope feature costs 3 Hope and is not the character's action unless it
 *   rolls something.
 */

import type { AbilityDef } from '../abilities';

const card = (id: string): AbilityDef['source'] => ({ kind: 'domainCard', card: id });
const hope = (classId: string): AbilityDef['source'] => ({ kind: 'classHope', classId });

/**
 * Every SRD ability the engine can run. Ids are the card's id, or the card's
 * id plus the spell's name for a grimoire's several spells.
 */
export const SRD_ABILITIES: readonly AbilityDef[] = [
  // ---- Blade -----------------------------------------------------------------
  {
    id: 'get-back-up',
    name: 'Get Back Up',
    source: card('get-back-up'),
    text: '',
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { stress: 1 },
    target: { kind: 'none', range: 'melee' },
    inCombatOnly: false,
    action: false,
    effects: [],
    modifiers: [],
  },
  {
    id: 'whirlwind',
    name: 'Whirlwind',
    source: card('whirlwind'),
    text: '',
    kind: 'action',
    cost: { hope: 1 },
    target: { kind: 'adversary', range: 'veryClose' },
    inCombatOnly: false,
    action: true,
    effects: [
      {
        kind: 'attack',
        onHit: [
          // The same swing at everyone else in reach; the extra targets take half.
          {
            kind: 'check',
            check: {
              trait: 'weapon',
              difficulty: 'target',
              targets: { kind: 'adversaries', range: 'veryClose' },
              onSuccessWithHope: [{ kind: 'damage', dice: 'd8', using: 'proficiency', half: true, type: 'physical' }],
            },
          },
        ],
      },
    ],
    modifiers: [],
  },
  {
    id: 'reckless',
    name: 'Reckless',
    source: card('reckless'),
    text: '',
    kind: 'action',
    cost: { stress: 1 },
    target: { kind: 'adversary', range: 'far' },
    inCombatOnly: false,
    action: true,
    effects: [{ kind: 'attack', advantage: 1 }],
    modifiers: [],
  },
  // ---- Valor -----------------------------------------------------------------
  {
    id: 'bare-bones',
    name: 'Bare Bones',
    source: card('bare-bones'),
    text: '',
    kind: 'passive',
    cost: {},
    target: { kind: 'none', range: 'melee' },
    inCombatOnly: false,
    action: false,
    effects: [],
    modifiers: [],
  },
  {
    id: 'forceful-push',
    name: 'Forceful Push',
    source: card('forceful-push'),
    text: '',
    kind: 'action',
    cost: {},
    target: { kind: 'adversary', range: 'melee' },
    inCombatOnly: false,
    action: true,
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
    modifiers: [],
  },
  {
    id: 'i-am-your-shield',
    name: 'I Am Your Shield',
    source: card('i-am-your-shield'),
    text: '',
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { stress: 1 },
    target: { kind: 'ally', range: 'veryClose' },
    inCombatOnly: false,
    action: false,
    effects: [],
    modifiers: [],
  },
  {
    id: 'body-basher',
    name: 'Body Basher',
    source: card('body-basher'),
    text: '',
    kind: 'passive',
    cost: {},
    target: { kind: 'none', range: 'melee' },
    inCombatOnly: false,
    action: false,
    effects: [],
    modifiers: [{ stat: 'damageRoll', bonus: 0 }],
  },
  // ---- Midnight --------------------------------------------------------------
  {
    id: 'pick-and-pull',
    name: 'Pick and Pull',
    source: card('pick-and-pull'),
    text: '',
    kind: 'passive',
    cost: {},
    target: { kind: 'none', range: 'melee' },
    inCombatOnly: false,
    action: false,
    effects: [],
    modifiers: [],
  },
  {
    id: 'rain-of-blades',
    name: 'Rain of Blades',
    source: card('rain-of-blades'),
    text: '',
    kind: 'action',
    cost: { hope: 1 },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: false,
    action: true,
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
    modifiers: [],
  },
  {
    id: 'shadowbind',
    name: 'Shadowbind',
    source: card('shadowbind'),
    text: '',
    kind: 'action',
    cost: {},
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: false,
    action: true,
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
    modifiers: [],
  },
  // ---- Codex -----------------------------------------------------------------
  {
    id: 'book-of-ava-power-push',
    name: 'Power Push',
    source: card('book-of-ava'),
    text: 'Make a Spellcast Roll against a target within Melee range. On a success, they’re knocked back to Far range and take d10+2 magic damage using your Proficiency.',
    kind: 'action',
    cost: {},
    target: { kind: 'adversary', range: 'melee' },
    inCombatOnly: false,
    action: true,
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
    modifiers: [],
  },
  {
    id: 'book-of-ava-tavas-armor',
    name: "Tava's Armor",
    source: card('book-of-ava'),
    text: 'Spend a Hope to give a target you can touch a +1 bonus to their Armor Score until their next rest or you cast Tava’s Armor again.',
    kind: 'action',
    cost: { hope: 1 },
    target: { kind: 'ally', range: 'melee' },
    inCombatOnly: false,
    action: true,
    effects: [
      { kind: 'clearCondition', condition: 'tavas-armor', target: { kind: 'party' } },
      { kind: 'applyCondition', condition: 'tavas-armor', duration: 'rest', target: { kind: 'target' } },
    ],
    modifiers: [],
  },
  {
    id: 'book-of-ava-ice-spike',
    name: 'Ice Spike',
    source: card('book-of-ava'),
    text: 'Make a Spellcast Roll (12) to summon a large ice spike within Far range. If you use it as a weapon, make the Spellcast Roll against the target’s Difficulty instead. On a success, deal d6 physical damage using your Proficiency.',
    kind: 'action',
    cost: {},
    target: { kind: 'adversary', range: 'far' },
    inCombatOnly: false,
    action: true,
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
    modifiers: [],
  },
  // ---- Arcana ----------------------------------------------------------------
  {
    id: 'rune-ward',
    name: 'Rune Ward',
    source: card('rune-ward'),
    text: '',
    kind: 'reaction',
    trigger: 'incomingDamage',
    cost: { hope: 1 },
    target: { kind: 'none', range: 'melee' },
    inCombatOnly: false,
    action: false,
    effects: [],
    modifiers: [],
  },
  // ---- Splendor --------------------------------------------------------------
  {
    id: 'bolt-beacon',
    name: 'Bolt Beacon',
    source: card('bolt-beacon'),
    text: '',
    kind: 'action',
    cost: {},
    target: { kind: 'adversary', range: 'far' },
    inCombatOnly: false,
    action: true,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [
            // "On a success, spend a Hope to send a bolt…": the Hope is spent on the hit.
            { kind: 'spendHope' },
            { kind: 'damage', dice: 'd8+2', type: 'magic', using: 'proficiency' },
            { kind: 'applyCondition', condition: 'vulnerable', target: { kind: 'hit' } },
          ],
        },
      },
    ],
    modifiers: [],
  },
  {
    id: 'healing-hands',
    name: 'Healing Hands',
    source: card('healing-hands'),
    text: '',
    kind: 'action',
    cost: {},
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'ally', range: 'melee' },
    inCombatOnly: false,
    action: true,
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
    modifiers: [],
  },
  // ---- Grace -----------------------------------------------------------------
  {
    id: 'enrapture',
    name: 'Enrapture',
    source: card('enrapture'),
    text: '',
    kind: 'action',
    cost: {},
    target: { kind: 'adversary', range: 'close' },
    inCombatOnly: false,
    action: true,
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          onSuccessWithHope: [{ kind: 'applyCondition', condition: 'enraptured', target: { kind: 'hit' } }],
        },
      },
    ],
    modifiers: [],
  },
  // ---- Class Hope features ----------------------------------------------------
  {
    id: 'guardian-frontline-tank',
    name: 'Frontline Tank',
    source: hope('guardian'),
    text: '',
    kind: 'action',
    cost: { hope: 3 },
    target: { kind: 'none', range: 'melee' },
    available: { kind: 'pool', pool: 'armorSlots', measure: 'marked', op: '>=', value: 1 },
    inCombatOnly: false,
    action: false,
    effects: [{ kind: 'clearArmor', amount: 2 }],
    modifiers: [],
  },
  {
    id: 'rogue-rogues-dodge',
    name: "Rogue's Dodge",
    source: hope('rogue'),
    text: '',
    kind: 'action',
    cost: { hope: 3 },
    target: { kind: 'none', range: 'melee' },
    available: { kind: 'not', of: { kind: 'hasCondition', condition: 'dodging', of: { kind: 'actor' } } },
    inCombatOnly: false,
    action: false,
    effects: [{ kind: 'applyCondition', condition: 'dodging', duration: 'rest', target: { kind: 'actor' } }],
    modifiers: [],
  },
  {
    id: 'wizard-not-this-time',
    name: 'Not This Time',
    source: hope('wizard'),
    text: '',
    kind: 'reaction',
    trigger: 'attackHit',
    cost: { hope: 3 },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    action: false,
    effects: [],
    modifiers: [],
  },
];

/** The library by id. */
export const SRD_ABILITY_MAP: ReadonlyMap<string, AbilityDef> = new Map(SRD_ABILITIES.map((a) => [a.id, a]));
