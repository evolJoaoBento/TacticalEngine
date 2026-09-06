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
    // Taking an ally's hit is a redirection the defence step does not do yet;
    // text for the table.
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
  // ---- Codex -----------------------------------------------------------------
  {
    id: 'book-of-ava-power-push',
    name: 'Power Push',
    source: card('book-of-ava'),
    text: 'Make a Spellcast Roll against a target within Melee range. On a success, they’re knocked back to Far range and take d10+2 magic damage using your Proficiency.',
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
    text: 'Spend a Hope to give a target you can touch a +1 bonus to their Armor Score until their next rest or you cast Tava’s Armor again.',
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
    text: 'Make a Spellcast Roll (12) to summon a large ice spike within Far range. If you use it as a weapon, make the Spellcast Roll against the target’s Difficulty instead. On a success, deal d6 physical damage using your Proficiency.',
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
            // "On a success, spend a Hope to send a bolt…": the Hope is spent on the hit.
            { kind: 'spendHope' },
            { kind: 'damage', dice: 'd8+2', type: 'magic', using: 'proficiency' },
            { kind: 'applyCondition', condition: 'vulnerable', target: { kind: 'hit' } },
          ],
        },
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
  // ---- Grace -----------------------------------------------------------------
  {
    id: 'enrapture',
    name: 'Enrapture',
    source: card('enrapture'),
    target: { kind: 'adversary', range: 'close' },
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
    // Forcing a reroll is an interrupt the attack flow does not offer yet.
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
