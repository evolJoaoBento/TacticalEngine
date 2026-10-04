import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { deriveCharacter } from '../engine/character/sheet';
import { abilitySchema } from '../engine/content/abilities';
import { conditionDefSchema } from '../engine/content/conditions';
import { runScript } from '../engine/script/runner';
import { buildDemoScene, refreshWorld, type DemoScene } from './demo-scene';
import { characterContentFor } from './room';
import { FIXTURE_CARDS, FIXTURE_DOMAIN_FOUR } from '../../tests/fixtures/adversaries';
import { handedTo } from '../../tests/fixtures/cards';
import { FIXTURE_CONDITIONS } from '../../tests/fixtures/conditions';

/**
 * Passives and reactions in play: what a held card changes on the sheet,
 * what a condition changes while it lasts, and what fires when a hit lands.
 */

/** The demo, knowing the catalogue conditions these tests play: the engine ships only the rules' three. */
const scene = (seed = 'defense'): DemoScene => {
  const demo = buildDemoScene(hollowVaultMap(), seed);
  demo.project.conditionDefs.push(...FIXTURE_CONDITIONS);
  refreshWorld(demo);
  return demo;
};

describe('passives on the sheet', () => {
  /**
   * Two passives that are read off the sheet rather than run: one rewrites the
   * base the thresholds are built from, the other adds a trait to a roll and
   * only while the right weapon is in hand.
   *
   * The first is a base rewrite rather than a bonus. The derive consults it only
   * when no armour is worn, and then swaps the whole threshold table and takes
   * the Armor Score from Strength instead of from armour -- which is why it
   * sits on the sheet under its own stat rather than as a number.
   */
  const BARE_BONES_CARD = 'fixture-card-40';
  const BASHER_CARD = 'fixture-card-41';
  /** A card with nothing on it, for the derive with no passive in play. */
  const INERT_CARD = 'fixture-card-42';

  const PASSIVES = [
    {
      id: 'fixture-bare-bones',
      name: 'Bare Bones',
      source: { kind: 'domainCard', card: BARE_BONES_CARD },
      text: 'With nothing on, your own hide is the armour.',
      kind: 'passive',
      action: false,
      modifiers: [{ stat: 'bareBones', requires: 'unarmored' }],
    },
    {
      id: 'fixture-body-basher',
      name: 'Body Basher',
      source: { kind: 'domainCard', card: BASHER_CARD },
      text: 'You put your shoulder into it: more damage with a weapon in reach.',
      kind: 'passive',
      action: false,
      modifiers: [{ stat: 'damageRoll', plusTrait: 'strength', requires: 'meleeWeapon' }],
    },
  ];

  const carry = (demo: DemoScene): void => {
    demo.project.cards.push(...FIXTURE_CARDS);
    for (const ability of PASSIVES) demo.project.abilities.push(abilitySchema.parse(ability));
  };

  it('a subclass passive lifts the thresholds, and a card rewrites them when the mail comes off', () => {
    const demo = scene();
    carry(demo);
    const content = characterContentFor(demo.project);
    const seeded = demo.sheets.get('kara')!;

    // Armoured, and holding the card: ringmail's 7/15 at level 1 is 8/16, and
    // the subclass passive makes it 9/17.
    const armoured = deriveCharacter(
      { ...seeded, domainCards: [BARE_BONES_CARD], loadout: [BARE_BONES_CARD] },
      content,
      demo.project.abilities,
    ).character;
    expect(armoured.thresholds).toEqual({ major: 9, severe: 17 });
    expect(armoured.modifiers.map((m) => m.stat)).toContain('thresholds');
    // The card is in her hand, and counts only unarmoured: what keeps it off
    // the sheet is the requirement rather than the card being absent.
    expect(armoured.modifiers.some((m) => m.stat === 'bareBones')).toBe(false);

    const { armorId: _off, ...unarmored } = seeded;
    const bare = deriveCharacter(
      { ...unarmored, domainCards: [BARE_BONES_CARD], loadout: [BARE_BONES_CARD] },
      content,
      demo.project.abilities,
    ).character;
    // Tier 1 is 9/19, plus the level, plus the subclass passive.
    expect(bare.thresholds).toEqual({ major: 11, severe: 21 });
    // And now it is on the sheet, which is the other half of the same claim.
    expect(bare.modifiers.some((m) => m.stat === 'bareBones')).toBe(true);
    // Three and her Strength, and the class passive is worth a slot on top.
    expect(bare.armorScore).toBe(6);

    // Without the card it is level and twice level, and no armour but the slot
    // the class passive is worth.
    const plain = deriveCharacter(
      { ...unarmored, domainCards: [INERT_CARD], loadout: [INERT_CARD] },
      content,
      demo.project.abilities,
    ).character;
    expect(plain.thresholds).toEqual({ major: 2, severe: 3 });
    expect(plain.armorScore).toBe(1);
  });

  it('reads a roll bonus with a trait and a weapon requirement at roll time', () => {
    const demo = scene();
    const sheet = demo.sheets.get('kara')!;
    carry(demo);
    const grown = {
      ...sheet,
      domainCards: [BARE_BONES_CARD, BASHER_CARD],
      loadout: [BARE_BONES_CARD, BASHER_CARD],
    };
    demo.sheets.set('kara', grown);
    demo.characters.set('kara', deriveCharacter(grown, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
    // Body Basher: Strength (+2) to damage with a Melee weapon, and nothing at range.
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: true })).toBe(2);
    expect(demo.world.rollBonus('kara', 'damageRoll', { melee: false })).toBe(0);
    expect(demo.world.rollBonus('kara', 'attackRoll', { melee: true })).toBe(0);
  });
});

/**
 * Three of the new cards read something about their holder — how many Hit
 * Points are unmarked, how much Stress is marked, how many cards of a domain
 * are in the loadout — from inside a reaction or a modifier, where the actor
 * is whoever is swinging rather than whoever holds the card. Each of the three
 * paths that answers that question gets a test here.
 */
describe('a card that reads its own holder', () => {
  const holding = (demo: DemoScene, cards: string[]): void => {
    const sheet = { ...demo.sheets.get('kara')!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set('kara', sheet);
    demo.characters.set('kara', deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  /**
   * A reaction offered only while its holder is nearly out. `available` reads
   * a pool, and the pool it reads is the *holder's* — which is the whole point
   * when somebody else is the one swinging.
   */
  const ON_THE_BRINK = {
    id: 'fixture-on-the-brink',
    name: 'On the Brink',
    source: { card: 'fixture-on-the-brink' },
    text: 'Nearly out, and the smallest blows stop telling.',
    kind: 'reaction',
    trigger: 'incomingDamage',
    action: false,
    available: { kind: 'pool', pool: 'hitPoints', measure: 'available', op: '<=', value: 2 },
    reaction: { kind: 'reduceSeverity', steps: 1, only: 'minor' },
  };

  /** A reaction whose effects are read from the holder's chair, not the attacker's. */
  const SWIFT_STEP = {
    id: 'fixture-swift-step',
    name: 'Swift Step',
    source: { card: 'fixture-swift-step' },
    text: 'A blow that misses leaves them better off than it found them.',
    kind: 'reaction',
    trigger: 'attackMissed',
    action: false,
    effects: [
      {
        kind: 'branch',
        when: { kind: 'pool', pool: 'stress', measure: 'marked', op: '>=', value: 1 },
        then: [{ kind: 'clearStress', amount: 1, target: { kind: 'actor' } }],
        otherwise: [{ kind: 'gainGood', amount: 1, target: { kind: 'actor' } }],
      },
    ],
  };

  /**
   * The one kind of card a `granted` source cannot stand in for: its bonus is
   * gated on what else is in the loadout, so there has to be a loadout to
   * count. The card it sits on and the four it counts are the project's own.
   */
  const WELL_ARMED = {
    id: 'fixture-well-armed',
    name: 'Well Armed',
    source: { kind: 'domainCard', card: 'fixture-card-5' },
    text: 'Carrying enough of a kind, its holder is harder to put down.',
    kind: 'passive',
    action: false,
    modifiers: [
      { stat: 'attackRoll', bonus: 2, when: { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 } },
      { stat: 'severeThreshold', bonus: 4, when: { kind: 'loadout', domain: 'fixture', op: '>=', value: 4 } },
    ],
  };

  it('is offered only while its holder is nearly out, whoever is attacking', () => {
    const demo = scene();
    demo.project.cards.push(handedTo(ON_THE_BRINK, 'kara'));
    demo.project.abilities.push(abilitySchema.parse(ON_THE_BRINK));
    holding(demo, []);
    const kara = demo.state.entity('kara')!;
    // The GM's turn is on, so the actor is an adversary: the card still has to
    // read Quim's Hit Points and not the husk's.
    demo.scenario.actorId = demo.state.entitiesOf('adversary')[0]!.id;

    // Her own subclass features are read here too; this is about the one card.
    const offered = (): string[] =>
      demo.world.reactionsFor('kara', 'incomingDamage').map((a) => a.id).filter((id) => id === 'fixture-on-the-brink');

    kara.hitPoints = { max: 6, marked: 3 };
    expect(offered()).toEqual([]);
    kara.hitPoints = { max: 6, marked: 4 };
    expect(offered()).toEqual(['fixture-on-the-brink']);

    // And it does what it says: with no Armor Slots left to hide behind,
    // Minor damage marks nothing at all.
    kara.armorSlots = { max: kara.armorSlots.max, marked: kara.armorSlots.max };
    expect(demo.world.dealDamage('kara', { amount: 1, types: ['physical'] }, demo.rng).hpMarked).toBe(0);
    kara.hitPoints = { max: 6, marked: 3 };
    expect(demo.world.dealDamage('kara', { amount: 1, types: ['physical'] }, demo.rng).hpMarked).toBe(1);
  });

  it("clears its holder's Stress, not the attacker's", () => {
    const demo = scene();
    demo.project.cards.push(handedTo(SWIFT_STEP, 'kara'));
    demo.project.abilities.push(abilitySchema.parse(SWIFT_STEP));
    holding(demo, []);
    const kara = demo.state.entity('kara')!;
    kara.stress = { max: 6, marked: 2 };
    const husk = demo.state.entitiesOf('adversary')[0]!;
    husk.stress = { max: 3, marked: 3 };
    demo.scenario.actorId = husk.id;

    const card = demo.world.reactionsFor('kara', 'attackMissed')[0]!;
    // The react path stands the holder up as the actor before running it.
    const was = demo.scenario.actorId;
    demo.scenario.actorId = 'kara';
    runScript(card.effects, demo.world, demo.rng, { targets: [husk.id] });
    demo.scenario.actorId = was;

    expect(demo.state.entity('kara')!.stress.marked).toBe(1);
    expect(demo.state.entity(husk.id)!.stress.marked).toBe(3);
  });

  it("raises its holder's Severe threshold while an adversary is the one acting", () => {
    const demo = scene();
    // The cards are the project's: what is under test is a bonus counted off
    // the loadout, so the loadout has to have something in it to count.
    demo.project.cards.push(...FIXTURE_CARDS);
    demo.project.abilities.push(abilitySchema.parse(WELL_ARMED));

    holding(demo, ['fixture-card-5']);
    const alone = demo.world.defenderOf(demo.state.entity('kara')!).thresholds.severe;

    holding(demo, [...FIXTURE_DOMAIN_FOUR, 'fixture-card-5']);
    demo.scenario.actorId = demo.state.entitiesOf('adversary')[0]!.id;
    // Four of a kind in the loadout beside it: the bonus holds when it is
    // read, which is while somebody else is swinging.
    expect(demo.world.defenderOf(demo.state.entity('kara')!).thresholds.severe).toBe(alone + 4);
  });
});

describe('reactions when a hit lands', () => {
  /**
   * Defence reactions: cards that carry a `reaction` rather than an effect
   * list, and are read inside the defence rather than run afterwards.
   *
   * The order the first test asserts is the resolver's, not these cards'. Every
   * armour reaction is applied, then the damage is resolved, then every
   * severity reaction -- so the armour one is always journalled first whatever
   * order they were written in.
   *
   * None of them says `auto: false`: the test's word is automatically, and an
   * offered reaction is never taken by a script.
   */
  const SLOT_CARD = 'fixture-card-43';
  const SHRUG_CARD = 'fixture-card-44';
  const WARD_CARD = 'fixture-card-45';

  const DEFENCES = [
    {
      id: 'fixture-second-slot',
      name: 'Second Slot',
      source: { kind: 'domainCard', card: SLOT_CARD },
      text: 'Long practice in armour: a physical blow can cost you one slot more.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      action: false,
      reaction: { kind: 'extraArmor', slots: 1, only: 'physical' },
    },
    {
      id: 'fixture-shrug-off',
      name: 'Shrug It Off',
      source: { kind: 'domainCard', card: SHRUG_CARD },
      text: 'Mark a Stress to take the worst of a bad wound off it.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      cost: { stress: 1 },
      action: false,
      reaction: { kind: 'reduceSeverity', steps: 1, only: 'severe' },
    },
    {
      id: 'fixture-warding-die',
      name: 'Warding Die',
      source: { kind: 'domainCard', card: WARD_CARD },
      text: 'Spend a Light to put a die between you and the blow.',
      kind: 'reaction',
      trigger: 'incomingDamage',
      cost: { good: 1 },
      action: false,
      reaction: { kind: 'reduceDamage', dice: '1d8' },
    },
  ];

  const carry = (demo: DemoScene, who: string, cards: string[]): void => {
    demo.project.cards.push(...FIXTURE_CARDS);
    for (const ability of DEFENCES) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('two carried reactions answer a Severe hit on Quim, automatically', () => {
    const demo = scene();
    const kara = demo.state.entity('kara')!;
    carry(demo, 'kara', [SLOT_CARD, SHRUG_CARD]);
    // 20 physical against 9/17 is Severe: the slot, the card's second slot,
    // and the one that steps the band bring it to nothing.
    demo.scenario.actorId = 'mira';
    const journal = runScript([{ kind: 'damage', dice: '20 phy', target: { kind: 'entity', id: 'kara' } }], demo.world, demo.rng);
    expect(journal.filter((e) => e.kind === 'defended').map((e) => (e.kind === 'defended' ? e.ability : ''))).toEqual(['Second Slot', 'Shrug It Off']);
    expect(kara.hitPoints.marked).toBe(0);
    expect(kara.armorSlots.marked).toBe(2);
    expect(kara.stress.marked).toBe(1);
  });

  it('a carried ward spends a Light on Scarlet when its die helps', () => {
    const demo = scene();
    const mira = demo.state.entity('mira')!;
    mira.good = { max: 6, value: 2 };
    // The padded coat is 5/11 at level 1, 6/12: 13 is Severe. Try seeds until the d8
    // takes it under 12, which is any roll of 2 or more.
    for (let seed = 1; seed < 20; seed++) {
      const demo2 = scene(`ward-${seed}`);
      const m = demo2.state.entity('mira')!;
      carry(demo2, 'mira', [WARD_CARD]);
      m.good = { max: 6, value: 2 };
      demo2.scenario.actorId = 'kara';
      const journal = runScript([{ kind: 'damage', dice: '13 mag', target: { kind: 'entity', id: 'mira' } }], demo2.world, demo2.rng);
      const ward = journal.find((e) => e.kind === 'defended');
      if (ward === undefined) continue;
      expect(ward).toMatchObject({ ability: 'Warding Die', goodSpent: 1 });
      expect(m.good!.value).toBe(1);
      expect(m.hitPoints.marked).toBeLessThan(3);
      return;
    }
    throw new Error('the ward never helped in twenty seeds');
  });
});

describe("the party's own answer to a blow", () => {

  /**
   * Two halves on one card, and the reason it has to be a card rather than
   * something granted: the standing bonus is read off the loadout the card
   * sits in, while the Stress it clears is automatic — nothing about it is a
   * decision, so nobody is asked.
   */
  const RISE_UP = {
    id: 'fixture-rise-up',
    name: 'Rise Up',
    source: { kind: 'domainCard', card: 'fixture-card-5' },
    text: 'Harder to put down, and shaking off what the blow cost as it comes.',
    kind: 'reaction',
    trigger: 'tookHitPoints',
    action: false,
    modifiers: [{ stat: 'severeThreshold', plusProficiency: true }],
    effects: [{ kind: 'clearStress', target: { kind: 'actor' } }],
  };

  /** Both fixtures, and the card the second one sits on. */
  const carry = (demo: DemoScene, ability: Record<string, unknown>): void => {
    demo.project.cards.push(...FIXTURE_CARDS);
    demo.project.abilities.push(abilitySchema.parse(ability));
  };

  it('reads the Severe threshold the card raises', () => {
    // The same sheet twice, the second holding the card: the only difference
    // between them is "a bonus to your Severe threshold equal to your
    // Proficiency".
    const demo = scene('sheet');
    carry(demo, RISE_UP);
    const cards = demo.project.abilities;
    const sheet = { ...demo.sheets.get('kara')!, domainCards: [], loadout: [] };
    const plain = deriveCharacter(sheet, characterContentFor(demo.project), cards).character;
    const risen = deriveCharacter(
      { ...sheet, domainCards: ['fixture-card-5'], loadout: ['fixture-card-5'] },
      characterContentFor(demo.project),
      cards,
    ).character;
    expect(risen.proficiency).toBeGreaterThan(0);
    expect(risen.thresholds.severe).toBe(plain.thresholds.severe + risen.proficiency);
    expect(risen.thresholds.major).toBe(plain.thresholds.major);
  });
});

describe('a wound marked outright', () => {
  it('is heard the same way a rolled one is', () => {
    // "Force them to mark 5 Hit Points", the vines that squeeze, a trap: the
    // number is the card's rather than a roll's, and until now nothing that
    // answers being hurt heard it at all.
    const demo = scene('flat-heard');
    demo.scenario.actorId = 'mira';
    runScript([{ kind: 'damage', amount: 2, target: { kind: 'entity', id: 'kara' } }], demo.world, demo.rng);

    const notes = demo.world.drainDamage();
    const heard = notes.find((n) => n.id === 'kara');
    expect(heard, 'the wound was noted').toBeDefined();
    expect(heard!.hitPoints).toBe(2);
    // Nobody swung it, so nothing that hits back has anybody to hit.
    expect(heard!.attacker).toBe(null);
    expect(heard!.severe).toBe(false);

    // Three Hit Points is what a Severe blow marks, whoever counted them.
    runScript([{ kind: 'damage', amount: 3, target: { kind: 'entity', id: 'mira' } }], demo.world, demo.rng);
    expect(demo.world.drainDamage().find((n) => n.id === 'mira')!.severe).toBe(true);
  });
});

describe('a swing that missed', () => {

  it('rolls the weapon at half Proficiency, rounded up and never under one die', () => {
    const demo = scene('half-prof');
    const sheet = demo.sheets.get('kara')!;
    // Proficiency 1 halves to 1: a die is a die.
    expect(demo.world.proficiencyOf('kara')).toBe(1);
    const one = deriveCharacter({ ...sheet, proficiency: 5 }, characterContentFor(demo.project), demo.project.abilities).character;
    demo.characters.set('kara', one);
    demo.sheets.set('kara', one.sheet);
    refreshWorld(demo);
    expect(demo.world.proficiencyOf('kara')).toBe(5);

    // Five halves to three, so three of the weapon's dice rather than five.
    const husk = demo.state.entitiesOf('adversary').find((e) => e.alive)!;
    demo.scenario.actorId = 'kara';
    const journal = runScript(
      [{ kind: 'damage', dice: 'weapon', using: 'halfProficiency', target: { kind: 'entity', id: husk.id } }],
      demo.world,
      demo.rng,
    );
    const dealt = journal.find((e) => e.kind === 'damage') as { dice: string } | undefined;
    expect(dealt).toBeDefined();
    expect(dealt!.dice.startsWith('3d')).toBe(true);
  });
});

/**
 * A bonus that reads on every action roll rather than on a kind of one, and
 * the card it was added for: a die that sits on the sheet, grows with every
 * roll it helped, and drops off past six.
 */
describe('a bonus on every action roll', () => {
  /**
   * A card whose bonus is a pile of tokens rather than a number. The condition
   * says `perToken`, so what it is worth is read off the pile at the moment the
   * roll is made -- which is why one test can stack tokens by hand and another
   * can show the same pile is worth nothing once the form is gone.
   *
   * Two abilities: one puts the form on, the other grows it on every roll and
   * drops it when the pile would pass six. Neither is a decision.
   */
  const SURGE_CARD = 'fixture-card-60';

  /** Worth whatever the pile says, and only while the form holds. */
  const SURGING_CONDITION = {
    id: 'fixture-surging',
    name: 'Surging',
    text: 'The die is up: its value is added to every action roll you make.',
    modifiers: [{ stat: 'actionRoll', bonus: 1, perToken: 'fixture-surge' }],
  };

  const SURGE = [
    {
      id: 'fixture-surge',
      name: 'Something Older',
      source: { kind: 'domainCard', card: SURGE_CARD },
      text: 'Once between long rests, mark a Stress to let something older than you wear you.',
      uses: { count: 1, per: 'longRest' },
      cost: { stress: 1 },
      target: { kind: 'self' },
      action: false,
      effects: [
        { kind: 'log', text: 'Something older than them comes up through the ground and wears them.', tone: 'good' },
        // Emptied first, so a second turn of it starts at one rather than
        // wherever the last one stopped.
        { kind: 'spendToken', ability: 'fixture-surge', all: true },
        { kind: 'addToken', ability: 'fixture-surge', amount: 1 },
        { kind: 'applyCondition', condition: 'fixture-surging', duration: 'scene', target: { kind: 'actor' } },
      ],
    },
    {
      id: 'fixture-surge-grows',
      name: 'Something Older',
      source: { kind: 'domainCard', card: SURGE_CARD },
      text: 'It climbs with every roll, and when it will not hold it drops all at once.',
      kind: 'reaction',
      trigger: 'partyRolled',
      action: false,
      // Not a decision: it grows on its own and drops on its own.
      available: {
        kind: 'all',
        of: [
          { kind: 'self' },
          { kind: 'hasCondition', condition: 'fixture-surging' },
        ],
      },
      effects: [
        { kind: 'addToken', ability: 'fixture-surge', amount: 1 },
        {
          kind: 'branch',
          // Seven is the value that would exceed six: the die was on six, the
          // roll took its six, and the next turn of it has nowhere to go.
          when: { kind: 'tokens', ability: 'fixture-surge', op: '>=', value: 7 },
          then: [
            { kind: 'log', text: 'The shape will not hold any longer, and drops off them all at once.', tone: 'bad' },
            { kind: 'spendToken', ability: 'fixture-surge', all: true },
            { kind: 'clearCondition', condition: 'fixture-surging', target: { kind: 'actor' } },
            { kind: 'markStress', amount: 1, target: { kind: 'actor' } },
          ],
        },
      ],
    },
  ];

  const hold = (demo: DemoScene, who: string, cards: string[]): void => {
    demo.project.cards.push(...FIXTURE_CARDS);
    demo.project.conditionDefs.push(conditionDefSchema.parse(SURGING_CONDITION));
    for (const ability of SURGE) demo.project.abilities.push(abilitySchema.parse(ability));
    const sheet = { ...demo.sheets.get(who)!, domainCards: cards, loadout: cards.slice(0, 5) };
    demo.sheets.set(who, sheet);
    demo.characters.set(who, deriveCharacter(sheet, characterContentFor(demo.project), demo.project.abilities).character);
    refreshWorld(demo);
  };

  it('is worth nothing with the condition gone, however many tokens are on the card', () => {
    const demo = scene('action-roll-off');
    hold(demo, 'mira', [SURGE_CARD]);
    demo.scenario.actorId = 'mira';
    const plain = demo.world.checkModifier('agility', 'actor')!;
    demo.world.addTokens('mira', 'fixture-surge', 5);
    // The die is on the card; what reads it is the form, and there is none.
    expect(demo.world.checkModifier('agility', 'actor')).toBe(plain);
  });
});
