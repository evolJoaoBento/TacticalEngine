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
    id: 'share-the-burden',
    name: 'Share the Burden',
    source: card('share-the-burden'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'ally', range: 'melee' },
    // "Transfer any number of their marked Stress to you, then gain a Hope for
    // each Stress transferred." What the number costs is written here rather
    // than in the asking: the Stress comes off them and goes onto whoever is
    // carrying it, and the Hope follows the same number.
    effects: [
      {
        kind: 'howMany',
        most: { pool: 'stress', of: { kind: 'target' }, measure: 'marked' },
        title: 'Share the Burden',
        body: 'How much of it do you take?',
        each: [
          { kind: 'clearStress', amount: 'spent', target: { kind: 'target' } },
          { kind: 'markStress', amount: 'spent', target: { kind: 'actor' } },
          { kind: 'gainHope', amount: 'spent', target: { kind: 'actor' } },
        ],
      },
    ],
  },
  // ---- what the party puts behind its own blow ----------------------------
  // The party's half of the moment a blow stops at. `rollingDamage` is raised
  // on the one swinging after the roll and before the counting, so a card can
  // ask for tokens and put dice behind the hit the way a stat block does.
  {
    id: 'spellcharge-store',
    name: 'Spellcharge',
    source: card('spellcharge'),
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    target: { kind: 'none' },
    // Simplified: any wound charges it, not magic damage alone - nothing here
    // asks what type a blow was - and the store is not capped at the caster's
    // Spellcast trait.
    effects: [
      { kind: 'log', text: 'The wound goes into the card.', tone: 'hope' },
      { kind: 'addToken', ability: 'spellcharge-store', amount: 'hitPointsTaken' },
    ],
  },
  {
    id: 'spellcharge',
    name: 'Spellcharge',
    source: card('spellcharge'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    // "You can spend any number of tokens": a decision, so it is offered
    // rather than taken.
    auto: false,
    action: false,
    available: { kind: 'tokens', ability: 'spellcharge-store', op: '>=', value: 1 },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'howMany',
        most: { tokens: 'spellcharge-store' },
        title: 'Spellcharge',
        body: 'How much of it goes into the blow?',
        each: [
          { kind: 'spendToken', ability: 'spellcharge-store', amount: 'spent' },
          { kind: 'boostDamage', dice: '{n}d6' },
        ],
      },
    ],
  },
  {
    id: 'twilight-toll',
    name: 'Twilight Toll',
    source: card('twilight-toll'),
    target: { kind: 'adversary', range: 'far' },
    // Simplified: the toll is set on one creature and worth one die, where the
    // card grows a die for every success against them that rolled no damage -
    // a roll nothing here raises. Setting it again moves it, as the card says.
    effects: [
      { kind: 'clearCondition', condition: 'tolled', target: { kind: 'adversaries', range: 'veryFar' } },
      { kind: 'spendToken', ability: 'twilight-toll', all: true },
      { kind: 'log', text: 'The toll is set, and it will be paid.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'tolled', duration: 'scene', target: { kind: 'target' } },
      { kind: 'addToken', ability: 'twilight-toll', amount: 1 },
    ],
  },
  {
    id: 'twilight-toll-paid',
    name: 'Twilight Toll',
    source: card('twilight-toll'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    // "You can spend any number of tokens": a decision, so it is offered
    // rather than taken.
    auto: false,
    action: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'tokens', ability: 'twilight-toll', op: '>=', value: 1 },
        { kind: 'hasCondition', condition: 'tolled', of: { kind: 'target' } },
      ],
    },
    target: { kind: 'none' },
    effects: [
      {
        kind: 'howMany',
        most: { tokens: 'twilight-toll' },
        title: 'Twilight Toll',
        body: 'Call it in?',
        each: [
          { kind: 'spendToken', ability: 'twilight-toll', amount: 'spent' },
          { kind: 'boostDamage', dice: '{n}d12' },
        ],
      },
    ],
  },
  // ---- what the defender says in their own words --------------------------
  // The defence step answers a blow with shapes - dice off the total, a slot
  // marked, the severity stepped - and these two answer it with a script:
  // thorns that roll for what they are worth, and a step that is simply not
  // there any more.
  {
    id: 'thorn-skin',
    name: 'Thorn Skin',
    source: card('thorn-skin'),
    cost: { hope: 1 },
    uses: { count: 1, per: 'rest' },
    target: { kind: 'self' },
    action: false,
    effects: [
      { kind: 'log', text: 'Thorns break through the skin.', tone: 'hope' },
      { kind: 'addToken', ability: 'thorn-skin', amount: { trait: 'spellcast' } },
    ],
  },
  {
    id: 'thorn-skin-turn',
    name: 'Thorn Skin',
    source: card('thorn-skin'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    available: { kind: 'tokens', ability: 'thorn-skin', op: '>=', value: 1 },
    target: { kind: 'none' },
    // Simplified: it answers a standard attack, which is the blow the defender
    // is asked about. Damage from a feature's own script is dealt without a
    // question, so the thorns never hear it.
    effects: [
      {
        kind: 'howMany',
        most: { tokens: 'thorn-skin' },
        title: 'Thorn Skin',
        body: 'How many thorns break off in it?',
        each: [
          { kind: 'spendToken', ability: 'thorn-skin', amount: 'spent' },
          { kind: 'softenBlow', dice: '{n}d6' },
          {
            kind: 'branch',
            when: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } },
            then: [{ kind: 'damage', dice: 'same', target: { kind: 'target' } }],
          },
        ],
      },
    ],
  },
  {
    id: 'scramble',
    name: 'Scramble',
    source: card('scramble'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    uses: { count: 1, per: 'rest' },
    // "When a creature within Melee range would deal damage to you."
    available: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } },
    target: { kind: 'none' },
    // Simplified: the blow is avoided and the ground is left, but a creature
    // that follows is the table's to play - the walk is measured away from the
    // one who swung and stops where the map does.
    effects: [
      { kind: 'log', text: 'The blow closes on empty ground.', tone: 'hope' },
      { kind: 'avoidBlow' },
      { kind: 'move', how: 'away', of: { kind: 'target' }, budget: 'close' },
    ],
  },
  // ---- what a card leaves on its holder, and how long it stays ------------
  // A bonus that has to outlive the moment it was bought in lives on a
  // condition, which is where the engine already keeps every other number that
  // hangs on somebody.
  {
    id: 'frenzy',
    name: 'Frenzy',
    source: card('frenzy'),
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'self' },
    inCombatOnly: true,
    // Simplified: it lasts the fight rather than "until there are no more
    // adversaries within sight", which is the same thing said with eyes.
    effects: [
      { kind: 'log', text: 'Something in them lets go of the reins.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'frenzied', duration: 'scene', target: { kind: 'actor' } },
    ],
  },
  {
    id: 'deadly-focus',
    name: 'Deadly Focus',
    source: card('deadly-focus'),
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'far' },
    inCombatOnly: true,
    action: false,
    // Simplified: the focus lasts the fight rather than ending when they swing
    // at somebody else or the one they were watching goes down - nothing tells
    // a condition who it was about.
    effects: [
      { kind: 'log', text: 'Everything else in the room goes quiet.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'focused', duration: 'scene', target: { kind: 'actor' } },
    ],
  },
  {
    id: 'specter-of-the-dark',
    name: 'Specter of the Dark',
    source: card('specter-of-the-dark'),
    cost: { stress: 1 },
    target: { kind: 'self' },
    action: false,
    // The condition ends itself the moment they swing, which is what "until
    // you make an action roll targeting another creature" comes to in a fight.
    effects: [
      { kind: 'log', text: 'They go thin, and the dark comes through them.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'spectral', duration: 'scene', target: { kind: 'actor' } },
    ],
  },
  {
    id: 'battle-cry',
    name: 'Battle Cry',
    source: card('battle-cry'),
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'none', range: 'far' },
    inCombatOnly: true,
    // Simplified: the advantage lasts the fight rather than until somebody
    // rolls a failure with Fear, which is a roll no card is told about.
    effects: [
      { kind: 'log', text: 'The call goes up, and the room answers it.', tone: 'hope' },
      { kind: 'clearStress', amount: 1, target: { kind: 'allies', range: 'far', includeSelf: true } },
      { kind: 'gainHope', amount: 1, target: { kind: 'allies', range: 'far', includeSelf: true } },
      { kind: 'applyCondition', condition: 'inspired', duration: 'scene', target: { kind: 'allies', range: 'far' } },
    ],
  },
  {
    id: 'night-terror',
    name: 'Night Terror',
    source: card('night-terror'),
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'none', range: 'veryClose' },
    inCombatOnly: true,
    // Simplified: Horrified is Vulnerable and nothing else, and it lasts the
    // scene rather than being shaken off.
    effects: [
      { kind: 'log', text: 'What they are looking at is no longer a person.', tone: 'hope' },
      {
        kind: 'reactionRoll',
        difficulty: 16,
        trait: 'presence',
        targets: { kind: 'adversaries', range: 'veryClose' },
        onFail: [
          { kind: 'applyCondition', condition: 'horrified', duration: 'scene', target: { kind: 'hit' } },
          // "Steal a number of Fear from the GM equal to the number of targets
          // that are Horrified", and an empty pool is nothing stolen.
          { kind: 'loseFear', amount: 'targetsHit' },
        ],
      },
    ],
  },
  // ---- the last two things a defender can say to a blow -------------------
  // Simplified: "you can use a different character trait for an equipped
  // weapon" is a choice made when the sheet is written rather than in a fight,
  // and stays text. The half that belongs to a swing is scripted.
  {
    id: 'versatile-fighter',
    name: 'Versatile Fighter',
    source: card('versatile-fighter'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The blow lands exactly where it was meant to.', tone: 'hope' },
      { kind: 'maxOneDie' },
    ],
  },
  // Simplified: "the GM tells you which targets it would succeed against.
  // Choose one of these targets" is one roll read against every Difficulty in
  // reach, and the choice among the ones it beat goes to the nearest - the
  // same rule every other automatic pick here uses.
  {
    id: 'reapers-strike',
    name: "Reaper's Strike",
    source: card('reapers-strike'),
    cost: { hope: 1 },
    uses: { count: 1, per: 'longRest' },
    inCombatOnly: true,
    target: { kind: 'none' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'weapon',
          difficulty: 'target',
          targets: { kind: 'adversaries', range: 'melee', reach: 'weapon' },
          prompt: 'Reap: one roll, against everything the weapon reaches.',
          // Five Hit Points, past thresholds and past armor: the number is the
          // card's, not a blow's.
          always: [{ kind: 'damage', amount: 5, target: { kind: 'hit', nearest: 1 } }],
        },
      },
    ],
  },
  // "Instead of making a death move": the other card that answers the fall, and
  // the cheaper of the two - a Hope rather than the card itself, for one Hit
  // Point rather than a d6 of them.
  {
    id: 'battle-hardened',
    name: 'Battle-Hardened',
    source: card('battle-hardened'),
    kind: 'reaction',
    trigger: 'defeated',
    action: false,
    auto: false,
    cost: { hope: 1 },
    uses: { count: 1, per: 'longRest' },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Not while there is breath left.', tone: 'hope' },
      { kind: 'heal', amount: 1, target: { kind: 'actor' } },
    ],
  },
  // The one card that answers the holder's own miss, and the whole reason
  // `dealtMiss` exists.
  {
    id: 'glancing-blow',
    name: 'Glancing Blow',
    source: card('glancing-blow'),
    kind: 'reaction',
    trigger: 'dealtMiss',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'The swing goes wide, and still finds something.', tone: 'combat' },
      { kind: 'damage', dice: 'weapon', using: 'halfProficiency', target: { kind: 'target' } },
    ],
  },
  // The only card in the SRD that answers a death move, and the only reason
  // the `defeated` trigger means anything on this side of the table.
  {
    id: 'unbreakable',
    name: 'Unbreakable',
    source: card('unbreakable'),
    kind: 'reaction',
    trigger: 'defeated',
    action: false,
    // A decision, not a reflex: "you can", and the two moves it is standing
    // against are ones a player may want.
    auto: false,
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Not today.', tone: 'hope' },
      { kind: 'heal', dice: '1d6', target: { kind: 'actor' } },
      // "Then place this card in your vault", which is the whole cost of it.
      { kind: 'vaultCard' },
    ],
  },
  {
    id: 'unyielding-armor',
    name: 'Unyielding Armor',
    source: card('unyielding-armor'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    target: { kind: 'none' },
    // Simplified: offered against any blow the defender is asked about rather
    // than at the moment they would mark an Armor Slot, which is a decision
    // they have not made yet when the question is put; and the step comes
    // after whatever armor did rather than in place of a slot.
    effects: [
      {
        kind: 'diceCheck',
        dice: '1d6',
        times: { trait: 'proficiency' },
        atLeast: 6,
        then: [
          { kind: 'log', text: 'The plate holds where it had no business holding.', tone: 'hope' },
          { kind: 'stepSeverity', steps: 1 },
        ],
        otherwise: [{ kind: 'log', text: 'The plate gives.', tone: 'system' }],
      },
    ],
  },
  {
    id: 'i-see-it-coming',
    name: 'I See It Coming',
    source: card('i-see-it-coming'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    // "When you're targeted by an attack made from beyond Melee range."
    available: { kind: 'not', of: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } } },
    // Simplified: asked once the swing has landed rather than as it is aimed,
    // because that is where the defender is asked anything at all - so a blow
    // that was going to miss anyway is never worth a Stress, and one that beat
    // the new Difficulty by enough is a Stress spent for nothing, as the card
    // intends.
    effects: [
      { kind: 'dodgeBy', dice: '1d4' },
    ],
  },
  // ---- a handful of dice, and what comes up on them -----------------------
  // "If any roll a 6": three cards ask it, each counting out a different pile
  // of dice, and none of them could be written until something could roll a
  // handful and look at the faces.
  {
    id: 'arcane-reflection',
    name: 'Arcane Reflection',
    source: card('arcane-reflection'),
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    auto: false,
    available: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
    target: { kind: 'none' },
    // Simplified: it answers any blow the defender is asked about rather than
    // magic damage alone - nothing at this moment asks what type a blow is -
    // and the damage sent back is the number that arrived, without the
    // attack's own `direct`, which the blow does not carry this far.
    effects: [
      {
        kind: 'howMany',
        most: { pool: 'hope', measure: 'available' },
        title: 'Arcane Reflection',
        body: 'How much of it goes into the mirror?',
        each: [
          { kind: 'spendHope', amount: 'spent' },
          {
            kind: 'diceCheck',
            dice: '1d6',
            times: 'spent',
            atLeast: 6,
            then: [
              { kind: 'log', text: 'The spell turns in the air and goes home.', tone: 'hope' },
              { kind: 'avoidBlow' },
              { kind: 'damage', dice: 'same', target: { kind: 'target' } },
            ],
            otherwise: [{ kind: 'log', text: 'The mirror holds nothing.', tone: 'system' }],
          },
        ],
      },
    ],
  },
  {
    id: 'redirect',
    name: 'Redirect',
    source: card('redirect'),
    kind: 'reaction',
    trigger: 'attackMissed',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    inCombatOnly: true,
    // "An attack made against you from beyond Melee range": read from the one
    // who swung, who is bound as the target.
    available: { kind: 'not', of: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } } },
    // Simplified: the Stress is spent on the attempt rather than after the
    // dice come up, and the blow goes to the nearest adversary within Very
    // Close rather than one the player picks.
    effects: [
      {
        kind: 'diceCheck',
        dice: '1d6',
        times: { trait: 'proficiency' },
        atLeast: 6,
        then: [
          { kind: 'log', text: 'The shot is caught and sent somewhere else.', tone: 'hope' },
          { kind: 'damage', dice: 'theirs', target: { kind: 'adversaries', range: 'veryClose', nearest: 1 } },
        ],
        otherwise: [{ kind: 'log', text: 'Nothing about it can be caught.', tone: 'system' }],
      },
    ],
  },
  // ---- what the dice said, once the blow has landed -----------------------
  // Four cards answer a critical success, and until the roll reached the cards
  // that answer a hit none of them could ask. The gate is a plain `rolled`,
  // read from the same bindings the blow already carried.
  {
    id: 'gore-and-glory',
    name: 'Gore and Glory',
    source: card('gore-and-glory'),
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    available: { kind: 'rolled', is: 'critical' },
    target: { kind: 'none' },
    // Simplified: the half that answers a critical runs; "when you deal enough
    // damage to defeat an enemy" is text, because nothing tells the one
    // swinging that what they hit has fallen.
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
  {
    id: 'champions-edge',
    name: "Champion's Edge",
    source: card('champions-edge'),
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    // "You can spend up to 3 Hope": spending is a decision, so the card is
    // offered rather than taken.
    auto: false,
    available: {
      kind: 'all',
      of: [
        { kind: 'rolled', is: 'critical' },
        { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
      ],
    },
    target: { kind: 'none' },
    // Simplified: the three are asked in the order the card prints them rather
    // than in any order the player likes. Each is asked once, each costs a
    // Hope, and none can be taken twice - which is what the card's own last
    // line is for.
    effects: [
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'hope', measure: 'available', op: '>=', value: 1 },
        then: [
          {
            kind: 'choice',
            title: "Champion's Edge",
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
            title: "Champion's Edge",
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
            title: "Champion's Edge",
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
  {
    id: 'critical-inspiration',
    name: 'Critical Inspiration',
    source: card('critical-inspiration'),
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    uses: { count: 1, per: 'rest' },
    available: { kind: 'rolled', is: 'critical' },
    target: { kind: 'none' },
    // Simplified: one answer for the whole room rather than each ally choosing
    // for themselves, which is a prompt per person for a card that fires on a
    // critical.
    effects: [
      {
        kind: 'choice',
        title: 'Critical Inspiration',
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
  {
    id: 'rousing-strike',
    name: 'Rousing Strike',
    source: card('rousing-strike'),
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    uses: { count: 1, per: 'rest' },
    available: { kind: 'rolled', is: 'critical' },
    target: { kind: 'none' },
    // Simplified: "all allies who can see or hear you" is read as Far range,
    // which is as far as this engine measures a room; the Stress cleared is
    // two rather than 1d4, because a clear is a number rather than dice; and
    // the choice is made once for everyone.
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
  // ---- what a blow is worth before anything else is said about it ---------
  {
    id: 'rage-up',
    name: 'Rage Up',
    source: card('rage-up'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    // A Stress is a decision, and the card says "you can".
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    // Simplified: once per attack rather than twice, and asked after the swing
    // lands rather than before it is made - which spends the Stress only on a
    // blow that is going to be counted, where the card would have spent it on
    // a miss as well.
    effects: [
      { kind: 'log', text: 'Something gives, and it is not them.', tone: 'hope' },
      { kind: 'boostDamage', amount: { trait: 'strength', times: 2 } },
    ],
  },
  {
    id: 'onslaught',
    name: 'Onslaught',
    source: card('onslaught'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    target: { kind: 'none' },
    // Nothing is asked and nothing is spent: the floor is simply there.
    effects: [{ kind: 'forceSeverity', severity: 'major', least: true }],
  },
  {
    id: 'onslaught-answer',
    name: 'Onslaught',
    source: card('onslaught'),
    kind: 'reaction',
    trigger: 'allyTookDamage',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    inCombatOnly: true,
    // "A creature within your weapon's range": read from the one holding the
    // card to the one who dealt it, at Close - the reach of most of what the
    // party swings, and a band a selector can name where a weapon's own range
    // is not.
    available: { kind: 'withinRange', range: 'close', of: { kind: 'target' } },
    // Simplified: the floor is the Major band rather than the target's own
    // Major threshold read as a number, which is the same two Hit Points the
    // card promises; and an area blow that catches the holder as well as an
    // ally still answers, where the card asks for an attack that did not
    // include them.
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
  // ---- what a blow leaves behind, and what answers one that went wide ------
  {
    id: 'breaking-blow',
    name: 'Breaking Blow',
    source: card('breaking-blow'),
    kind: 'reaction',
    trigger: 'dealtHit',
    action: false,
    // A Stress and a wait is a decision, not a rider.
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none' },
    // Simplified: "the next successful attack against that same target" is the
    // holder's own next one. Nothing raises a party member's blow to the rest
    // of the party, so an ally's hit does not cash the mark.
    effects: [
      { kind: 'log', text: 'Something in their guard gives way.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'broken', duration: 'scene', target: { kind: 'target' } },
    ],
  },
  {
    id: 'breaking-blow-paid',
    name: 'Breaking Blow',
    source: card('breaking-blow'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    // Nothing is asked and nothing is spent: the crack was paid for already.
    available: { kind: 'hasCondition', condition: 'broken', of: { kind: 'target' } },
    target: { kind: 'none' },
    effects: [
      { kind: 'boostDamage', dice: '2d12' },
      { kind: 'clearCondition', condition: 'broken', target: { kind: 'target' } },
    ],
  },
  {
    id: 'rapid-riposte',
    name: 'Rapid Riposte',
    source: card('rapid-riposte'),
    kind: 'reaction',
    trigger: 'attackMissed',
    action: false,
    auto: false,
    cost: { stress: 1 },
    target: { kind: 'none', range: 'melee' },
    inCombatOnly: true,
    // "An attack made against you from within Melee range": read from the one
    // who missed, who is bound as the target for both the gate and the blow.
    available: { kind: 'withinRange', range: 'melee', of: { kind: 'target' } },
    effects: [
      { kind: 'log', text: 'The blade comes back the way it went.', tone: 'hope' },
      { kind: 'damage', dice: 'weapon', using: 'proficiency', target: { kind: 'target' } },
    ],
  },
  // ---- what the party puts behind its own blow, part two -------------------
  // Battle Monster does not add to the roll: it throws it away. Sigil of
  // Retribution adds a die for every blow the marked creature landed on the
  // party, which is why half of it lives on the other side of the fight.
  {
    id: 'battle-monster',
    name: 'Battle Monster',
    source: card('battle-monster'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    // Four Stress and a blow thrown away is a decision, not a rider.
    auto: false,
    cost: { stress: 4 },
    // Nothing marked is nothing forced, and the Stress would be wasted.
    available: { kind: 'pool', pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked', op: '>=', value: 1 },
    target: { kind: 'none' },
    effects: [
      { kind: 'log', text: 'Everything it has done comes back the other way.', tone: 'hope' },
      { kind: 'forceHitPoints', amount: { pool: 'hitPoints', of: { kind: 'actor' }, measure: 'marked' } },
    ],
  },
  {
    id: 'sigil-of-retribution',
    name: 'Sigil of Retribution',
    source: card('sigil-of-retribution'),
    target: { kind: 'adversary', range: 'close' },
    // Simplified: the card holds a d8 for every blow without the cap of the
    // caster's level, and casting it again moves the sigil while leaving the
    // dice already on the card - the card clears them when they are rolled and
    // says nothing about clearing them otherwise.
    effects: [
      { kind: 'clearCondition', condition: 'sigiled', target: { kind: 'adversaries', range: 'veryFar' } },
      { kind: 'log', text: 'The sigil is set, and it will be answered for.', tone: 'hope' },
      { kind: 'applyCondition', condition: 'sigiled', duration: 'scene', target: { kind: 'target' } },
      { kind: 'gainFear', amount: 1 },
    ],
  },
  {
    id: 'sigil-of-retribution-mark',
    name: 'Sigil of Retribution',
    source: card('sigil-of-retribution'),
    kind: 'reaction',
    trigger: 'tookDamage',
    action: false,
    available: { kind: 'hasCondition', condition: 'sigiled', of: { kind: 'target' } },
    target: { kind: 'none' },
    effects: [{ kind: 'addToken', ability: 'sigil-of-retribution', amount: 1 }],
  },
  {
    id: 'sigil-of-retribution-ally',
    name: 'Sigil of Retribution',
    source: card('sigil-of-retribution'),
    kind: 'reaction',
    trigger: 'allyTookDamage',
    action: false,
    available: { kind: 'hasCondition', condition: 'sigiled', of: { kind: 'target' } },
    target: { kind: 'none' },
    effects: [{ kind: 'addToken', ability: 'sigil-of-retribution', amount: 1 }],
  },
  {
    id: 'sigil-of-retribution-paid',
    name: 'Sigil of Retribution',
    source: card('sigil-of-retribution'),
    kind: 'reaction',
    trigger: 'rollingDamage',
    action: false,
    // "Roll the dice on this card and add the total to your damage roll":
    // nothing is asked and nothing is spent, so it simply happens.
    available: {
      kind: 'all',
      of: [
        { kind: 'tokens', ability: 'sigil-of-retribution', op: '>=', value: 1 },
        { kind: 'hasCondition', condition: 'sigiled', of: { kind: 'target' } },
      ],
    },
    target: { kind: 'none' },
    effects: [
      { kind: 'boostDamage', dice: 'd8', times: { tokens: 'sigil-of-retribution' } },
      { kind: 'spendToken', ability: 'sigil-of-retribution', all: true },
    ],
  },
  // ---- a Spellcast Roll against a target, and what it leaves on them ------
  // The shape the SRD prints over and over: a Spellcast Roll against a
  // creature's own Difficulty, and on a success something that stays. Nothing
  // new was needed for these - a `check` at `difficulty: 'target'`, then an
  // `applyCondition` with `duration: 'temporary'`, which on an adversary is
  // exactly the SRD's "temporarily": it spends its next spotlight shaking the
  // condition off rather than swinging.
  {
    id: 'mystic-tether',
    name: 'Mystic Tether',
    source: card('book-of-norai'),
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
  {
    id: 'fireball',
    name: 'Fireball',
    source: card('book-of-norai'),
    target: { kind: 'adversary', range: 'veryFar' },
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          prompt: 'Hurl it?',
          onSuccessWithHope: [
            { kind: 'log', text: 'The sphere goes up on impact.', tone: 'combat' },
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
  {
    id: 'death-grip',
    name: 'Death Grip',
    source: card('death-grip'),
    target: { kind: 'adversary', range: 'close' },
    // Simplified: the third option - vines catching everyone standing between
    // the caster and the target - is a line across the map, and a selector
    // reads bands around a creature rather than the ground between two.
    effects: [
      {
        kind: 'check',
        check: {
          trait: 'spellcast',
          difficulty: 'target',
          prompt: 'Reach for them?',
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: 'restrained', duration: 'temporary', target: { kind: 'hit' } },
            {
              kind: 'choice',
              title: 'Death Grip',
              options: [
                {
                  label: 'Haul yourself into Melee range of them',
                  effects: [{ kind: 'move', how: 'toward', of: { kind: 'hit' }, range: 'melee', budget: 'close' }],
                },
                {
                  label: 'Constrict them: they mark 2 Stress',
                  effects: [{ kind: 'markStress', amount: 2, target: { kind: 'hit' } }],
                },
              ],
            },
          ],
        },
      },
    ],
  },
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
          prompt: 'Hold their attention?',
          onSuccessWithHope: [
            { kind: 'applyCondition', condition: 'enraptured', duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: 'enrapture-hold',
    name: 'Enrapture',
    source: card('enrapture'),
    // "Once per rest on a success, you can mark a Stress to force the
    // Enraptured target to mark a Stress as well." A second use of the same
    // card, and its own entry, because the spell is already on them.
    cost: { stress: 1 },
    uses: { count: 1, per: 'rest' },
    target: { kind: 'adversary', range: 'close', when: { kind: 'hasCondition', condition: 'enraptured' } },
    effects: [
      { kind: 'log', text: 'The song tightens, and it costs them.', tone: 'hope' },
      { kind: 'markStress', amount: 1, target: { kind: 'target' } },
    ],
  },
  {
    id: 'mass-enrapture',
    name: 'Mass Enrapture',
    source: card('mass-enrapture'),
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
            { kind: 'applyCondition', condition: 'enraptured', duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
  },
  {
    id: 'mass-enrapture-hold',
    name: 'Mass Enrapture',
    source: card('mass-enrapture'),
    // "Mark a Stress to force all Enraptured targets to mark a Stress, ending
    // this spell." The spell ends because the condition comes off with it.
    cost: { stress: 1 },
    target: { kind: 'none', range: 'far' },
    effects: [
      { kind: 'log', text: 'The song breaks, and every one of them feels it.', tone: 'hope' },
      { kind: 'markStress', amount: 1, target: { kind: 'adversaries', range: 'far' } },
      { kind: 'clearCondition', condition: 'enraptured', target: { kind: 'adversaries', range: 'far' } },
    ],
  },
  {
    id: 'glyph-of-nightfall',
    name: 'Glyph of Nightfall',
    source: card('glyph-of-nightfall'),
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
            { kind: 'applyCondition', condition: 'glyphed', duration: 'temporary', target: { kind: 'hit' } },
          ],
        },
      },
    ],
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
    // "Spend any number of tokens and roll a number of d10s equal to the
    // tokens spent." This was code once, because the number of options
    // depends on what is on the card; `howMany` asks that question now.
    effects: [
      {
        kind: 'howMany',
        most: { tokens: 'unleash-chaos' },
        title: 'Unleash Chaos',
        body: 'How much of it?',
        each: [
          { kind: 'spendToken', ability: 'unleash-chaos', amount: 'spent' },
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

  // ---- a bonus the card counts out for itself --------------------------------
  // "Increase your Evasion by the number of Hit Points they marked", "a +5
  // bonus to your damage roll for each token on this card": a modifier whose
  // bonus is multiplied by the tokens on the card that carries it, so the
  // number is whatever the fight has put there. The tokens are placed by a
  // count off the blow, which is how the two halves meet.
  {
    id: 'ferocity',
    name: 'Ferocity',
    source: card('ferocity'),
    kind: 'reaction',
    trigger: 'dealtDamage',
    cost: { hope: 2 },
    action: false,
    effects: [
      { kind: 'log', text: 'The kill puts them somewhere else entirely.', tone: 'hope' },
      { kind: 'addToken', ability: 'ferocity', amount: 'hitPointsDealt' },
    ],
  },
  {
    id: 'ferocity-evasion',
    name: 'Ferocity',
    source: card('ferocity'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'evasion', bonus: 1, perToken: 'ferocity' }],
  },
  {
    id: 'ferocity-spent',
    name: 'Ferocity',
    source: card('ferocity'),
    kind: 'reaction',
    // "This bonus lasts until after the next attack made against you": the
    // attack ends it whether it landed or not, which is what `attacked` is.
    trigger: 'attacked',
    action: false,
    effects: [{ kind: 'spendToken', ability: 'ferocity', all: true }],
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
    id: 'never-upstaged',
    name: 'Never Upstaged',
    source: card('never-upstaged'),
    kind: 'reaction',
    trigger: 'tookHitPoints',
    cost: { stress: 1 },
    action: false,
    effects: [
      { kind: 'log', text: 'They will hear about this one.', tone: 'hope' },
      { kind: 'addToken', ability: 'never-upstaged', amount: 'hitPointsTaken' },
    ],
  },
  {
    id: 'never-upstaged-damage',
    name: 'Never Upstaged',
    source: card('never-upstaged'),
    kind: 'passive',
    action: false,
    modifiers: [{ stat: 'damageRoll', bonus: 5, perToken: 'never-upstaged' }],
  },
  {
    id: 'never-upstaged-spent',
    name: 'Never Upstaged',
    source: card('never-upstaged'),
    kind: 'reaction',
    // "On your next successful attack… then clear all tokens." The bonus is
    // read while the swing is rolled; this runs once it has landed.
    trigger: 'dealtHit',
    action: false,
    effects: [{ kind: 'spendToken', ability: 'never-upstaged', all: true }],
  },

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
