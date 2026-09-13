import { describe, it, expect } from 'vitest';
import { FIXTURE_CONTENT } from '../../../tests/fixtures/characters';
import { blankSheet, deriveCharacter, type CharacterSheet } from './sheet';
import {
  availableAdvancements,
  cardAllowed,
  domainsOf,
  levelUp,
  markedTraits,
  subclassStage,
  tierOf,
  type LevelUpPlan,
} from './progression';

/**
 * Levelling up. What these check is that the level-up sheet is transcribed right — which
 * boxes each tier has, what the previous tier still offers, what crosses what out — that
 * the rule "a plan is legal or nothing happens" holds, and that a level taken shows up in
 * the numbers the rest of the engine reads.
 *
 * The content is a fixture, not a pack: see `tests/fixtures/characters.ts` for why. What the
 * vendored catalogue itself contains is `progression-catalogue.test.ts`, which leaves when
 * the catalogue does.
 */

// Content shaped for the rules rather than for play: two domains on one class, a third
// to multiclass into, and cards at the levels the tier tables ask about. The shipped pack
// stops at level 2, which is a fact about the pack and not about advancement.
const content = FIXTURE_CONTENT;

const kara = (overrides: Partial<CharacterSheet> = {}): CharacterSheet =>
  blankSheet('kara', 'fixture-warden', {
    name: 'Kara',
    traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: -1 },
    armorId: 'fixture-coat',
    primaryWeaponId: 'fixture-blade',
    subclassId: 'fixture-bulwark',
    domainCards: ['fixture-guard-1', 'fixture-edge-1'],
    experiences: [{ name: 'Held the line', modifier: 2 }],
    ...overrides,
  });

/** A legal level 2: two cheap picks, a card, and the Experience level 2 grants. */
const toTwo: LevelUpPlan = {
  advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }],
  domainCard: 'fixture-guard-2',
  experience: { name: 'Vault-born', modifier: 2 },
};

function climb(sheet: CharacterSheet, plans: LevelUpPlan[]): CharacterSheet {
  let current = sheet;
  for (const plan of plans) {
    const result = levelUp(current, content, plan);
    expect(result.issues).toEqual([]);
    current = result.sheet;
  }
  return current;
}

/** Levels 2, 3 and 4 with cheap picks, leaving the tier 2 sheet with boxes to spare. */
const toFour = (sheet: CharacterSheet): CharacterSheet =>
  climb(sheet, [
    toTwo,
    { advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }], domainCard: 'fixture-guard-3' },
    { advancements: [{ kind: 'evasion' }, { kind: 'traits', traits: ['agility', 'finesse'] }], domainCard: 'fixture-edge-2' },
  ]);

/** A legal level 5 with the given picks. */
const toFive = (advancements: LevelUpPlan['advancements'], domainCard = 'fixture-guard-5'): LevelUpPlan => ({
  advancements,
  domainCard,
  experience: { name: 'Read the runes', modifier: 2 },
});

describe('tiers', () => {
  it('follows the SRD bands', () => {
    expect([1, 2, 4, 5, 7, 8, 10].map(tierOf)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it('offers the whole sheet at first, and only what is left after', () => {
    const fresh = availableAdvancements(kara(), 2).map((o) => o.kind);
    expect(fresh).toContain('traits');
    expect(fresh).not.toContain('multiclass');
    expect(availableAdvancements(kara(), 5).map((o) => o.kind)).toContain('multiclass');

    const grown = climb(kara(), [
      { ...toTwo, advancements: [{ kind: 'evasion' }, { kind: 'hitPoint' }] },
    ]);
    const left = availableAdvancements(grown, 3);
    expect(left.find((o) => o.kind === 'evasion')).toBeUndefined();
    expect(left.find((o) => o.kind === 'hitPoint')?.limit).toBe(1);
  });

  it('has the boxes the printed sheet has', () => {
    // Tier 2 has no subclass, Proficiency or multiclass box; tiers 3 and 4 do.
    const two = availableAdvancements(kara(), 2);
    expect(two.map((o) => o.kind).sort()).toEqual(['domainCard', 'evasion', 'experiences', 'hitPoint', 'stress', 'traits']);
    expect(two.every((o) => o.tier === 2)).toBe(true);
    expect(two.find((o) => o.kind === 'domainCard')?.cardCap).toBe(4);
    const three = availableAdvancements(toFour(kara()), 5);
    const tierThree = three.filter((o) => o.tier === 3).map((o) => o.kind).sort();
    expect(tierThree).toEqual(['domainCard', 'evasion', 'experiences', 'hitPoint', 'multiclass', 'proficiency', 'stress', 'subclass', 'traits']);
    expect(three.find((o) => o.tier === 3 && o.kind === 'domainCard')?.cardCap).toBe(7);
    expect(three.filter((o) => o.cost === 2).map((o) => o.kind).sort()).toEqual(['multiclass', 'proficiency']);
  });

  it('lets tier 3 spend what tier 2 left unmarked, at tier 2\'s card cap', () => {
    const four = toFour(kara());
    const leftovers = availableAdvancements(four, 5).filter((o) => o.tier === 2);
    // Hit Points, Stress and Evasion are used up; two trait boxes, the Experiences box and the card box remain.
    expect(leftovers.map((o) => [o.kind, o.limit]).sort()).toEqual([['domainCard', 1], ['experiences', 1], ['traits', 2]]);
    expect(leftovers.find((o) => o.kind === 'subclass')).toBeUndefined();

    // Spend the tier 2 card box at level 5: a level 5 card is over its cap of 4.
    const overCap = levelUp(four, content, toFive([{ kind: 'domainCard', card: 'fixture-edge-5', fromTier: 2 }, { kind: 'hitPoint' }]));
    expect(overCap.issues.map((i) => i.message)).toContainEqual(expect.stringContaining('is level 5'));
    // A tier 2 Hit Point box is gone even though the tier 3 one is open.
    expect(
      levelUp(four, content, toFive([{ kind: 'hitPoint', fromTier: 2 }, { kind: 'stress' }])).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('no boxes left in tier 2'));
    const five = climb(four, [toFive([{ kind: 'domainCard', card: 'fixture-guard-4', fromTier: 2 }, { kind: 'hitPoint' }])]);
    expect(five.level).toBe(5);
    // The tier 2 card box is ticked; the tier 3 sheet has its own, and one Hit Point box left.
    const after = availableAdvancements(five, 6);
    expect(after.find((o) => o.tier === 2 && o.kind === 'domainCard')).toBeUndefined();
    expect(after.find((o) => o.tier === 3 && o.kind === 'domainCard')?.limit).toBe(1);
    expect(after.find((o) => o.tier === 3 && o.kind === 'hitPoint')?.limit).toBe(1);
  });

  it('only reaches back one tier, and not from tier 2', () => {
    const four = toFour(kara());
    expect(
      levelUp(four, content, toFive([{ kind: 'hitPoint', fromTier: 1 }, { kind: 'stress' }])).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('cannot spend a box on the tier 1 sheet'));
    expect(
      levelUp(kara(), content, { ...toTwo, advancements: [{ kind: 'hitPoint', fromTier: 1 }, { kind: 'stress' }] }).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('cannot spend a box on the tier 1 sheet'));
  });
});

describe('a legal level', () => {
  it('records itself and moves the numbers', () => {
    const before = deriveCharacter(kara(), content).character;
    const after = deriveCharacter(climb(kara(), [toTwo]), content).character;
    expect(after.sheet.level).toBe(2);
    expect(after.hitPoints).toBe(before.hitPoints + 1);
    expect(after.stress).toBe(before.stress + 1);
    // Thresholds rise with level regardless of the picks.
    expect(after.thresholds.major).toBe(before.thresholds.major + 1);
    // Level 2 is a tier achievement: Proficiency and a new Experience.
    expect(after.sheet.proficiency).toBe(2);
    expect(after.experiences.map((e) => e.name)).toContain('Vault-born');
    expect(after.sheet.levels).toHaveLength(1);
  });

  it('does not touch the sheet it was given', () => {
    const sheet = kara();
    levelUp(sheet, content, toTwo);
    expect(sheet.level).toBe(1);
    expect(sheet.levels).toBeUndefined();
  });

  it('raises two traits, marks them, and the swing reads the raise', () => {
    const grown = climb(kara(), [
      { ...toTwo, advancements: [{ kind: 'traits', traits: ['strength', 'agility'] }, { kind: 'stress' }] },
    ]);
    const derived = deriveCharacter(grown, content).character;
    expect(derived.traits.strength).toBe(3);
    expect(derived.traits.agility).toBe(1);
    expect(grown.traits.strength).toBe(2); // the sheet's own number is untouched
    expect([...markedTraits(grown)].sort()).toEqual(['agility', 'strength']);
  });

  it('bumps two Experiences', () => {
    const sheet = kara({
      experiences: [
        { name: 'Held the line', modifier: 2 },
        { name: 'Knows the vault', modifier: 2 },
      ],
    });
    const grown = climb(sheet, [
      {
        ...toTwo,
        advancements: [{ kind: 'experiences', names: ['Held the line', 'Knows the vault'] }, { kind: 'stress' }],
      },
    ]);
    const derived = deriveCharacter(grown, content).character;
    expect(derived.experiences.find((e) => e.name === 'Held the line')?.modifier).toBe(3);
  });

  it('upgrades the subclass one stage at a time, from tier 3', () => {
    expect(subclassStage(kara())).toBe('foundation');
    expect(
      levelUp(kara(), content, { ...toTwo, advancements: [{ kind: 'subclass' }, { kind: 'stress' }] }).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('not on the tier 2 sheet'));
    const grown = climb(toFour(kara()), [toFive([{ kind: 'subclass' }, { kind: 'stress' }])]);
    expect(subclassStage(grown)).toBe('specialization');
    // The tier 3 box is used; mastery waits for the tier 4 sheet.
    expect(availableAdvancements(grown, 6).find((o) => o.kind === 'subclass')).toBeUndefined();
    expect(availableAdvancements(grown, 8).find((o) => o.kind === 'subclass')?.tier).toBe(4);
  });
});

describe('an illegal plan', () => {
  const issuesOf = (sheet: CharacterSheet, plan: LevelUpPlan): string[] =>
    levelUp(sheet, content, plan).issues.map((i) => i.message);

  it('applies nothing', () => {
    const sheet = kara();
    const result = levelUp(sheet, content, { ...toTwo, advancements: [{ kind: 'hitPoint' }] });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.sheet).toBe(sheet);
  });

  it('must spend exactly two picks', () => {
    expect(issuesOf(kara(), { ...toTwo, advancements: [{ kind: 'hitPoint' }] })).toContainEqual(
      expect.stringContaining('exactly 2 picks'),
    );
    expect(
      issuesOf(kara(), { ...toTwo, advancements: [{ kind: 'hitPoint' }, { kind: 'stress' }, { kind: 'evasion' }] }),
    ).toContainEqual(expect.stringContaining('exactly 2 picks'));
  });

  it('cannot tick a box the tier has run out of', () => {
    const grown = climb(kara(), [{ ...toTwo, advancements: [{ kind: 'evasion' }, { kind: 'stress' }] }]);
    expect(
      issuesOf(grown, { advancements: [{ kind: 'evasion' }, { kind: 'stress' }], domainCard: 'fixture-guard-3' }),
    ).toContainEqual(expect.stringContaining('no boxes left'));
  });

  it('cannot raise a marked trait again until the tier clears it', () => {
    const grown = climb(kara(), [
      { ...toTwo, advancements: [{ kind: 'traits', traits: ['strength', 'agility'] }, { kind: 'stress' }] },
    ]);
    expect(
      issuesOf(grown, {
        advancements: [{ kind: 'traits', traits: ['strength', 'finesse'] }, { kind: 'hitPoint' }],
        domainCard: 'fixture-guard-3',
      }),
    ).toContainEqual(expect.stringContaining('strength is already marked'));
  });

  it('keeps the big options for tier 3', () => {
    expect(issuesOf(kara(), { ...toTwo, advancements: [{ kind: 'proficiency' }] })).toContainEqual(
      expect.stringContaining('not on the tier 2 sheet'),
    );
  });

  it('checks the card: domain, level, and not already held', () => {
    expect(cardAllowed(kara(), content, 'fixture-guard-1', 2)).toEqual({ ok: false, reason: expect.stringContaining('already held') });
    expect(cardAllowed(kara(), content, 'fixture-guard-2', 1).ok).toBe(false);
    expect(cardAllowed(kara(), content, 'fixture-guard-2', 2).ok).toBe(true);
    // A Codex card is a Wizard's, not a Guardian's.
    const codex = [...content.domainCards.values()].find((c) => c.domain === 'codex' && c.level === 1)!;
    expect(cardAllowed(kara(), content, codex.id, 2)).toEqual({ ok: false, reason: expect.stringContaining('outside') });
    expect(cardAllowed(kara(), content, 'no-such-card', 2).ok).toBe(false);
  });

  it('wants the Experience at 2, 5 and 8, and refuses it elsewhere', () => {
    const { experience: _dropped, ...noExperience } = toTwo;
    expect(issuesOf(kara(), noExperience)).toContainEqual(expect.stringContaining('grants a new Experience'));
    const two = climb(kara(), [toTwo]);
    expect(
      issuesOf(two, { ...toTwo, domainCard: 'fixture-guard-3', experience: { name: 'Extra', modifier: 2 } }),
    ).toContainEqual(expect.stringContaining('does not grant'));
  });

  it('stops at level 10', () => {
    expect(issuesOf(kara({ level: 10 }), toTwo)).toContainEqual(expect.stringContaining('already at level 10'));
  });
});

describe('multiclassing', () => {
  const wizard: LevelUpPlan['advancements'] = [{ kind: 'multiclass', classId: 'fixture-adept', domain: 'codex' }];

  it('is a two-pick choice from tier 3 that opens a new domain', () => {
    const four = toFour(kara());
    expect(four.level).toBe(4);
    const five = climb(four, [toFive(wizard)]);
    expect(five.level).toBe(5);
    expect(domainsOf(five, content)).toEqual(['guard', 'edge', 'codex']);
    const codex = [...content.domainCards.values()].find((c) => c.domain === 'codex' && c.level === 1)!;
    expect(cardAllowed(five, content, codex.id, 5).ok).toBe(true);
  });

  it('refuses a domain the class does not have, and a second multiclass', () => {
    const four = toFour(kara());
    const wrong = levelUp(four, content, toFive([{ kind: 'multiclass', classId: 'fixture-adept', domain: 'guard' }]));
    expect(wrong.issues.map((i) => i.message)).toContainEqual(expect.stringContaining('does not have the guard domain'));
    const five = climb(four, [toFive(wizard)]);
    expect(availableAdvancements(five, 8).find((o) => o.kind === 'multiclass')).toBeUndefined();
    expect(
      levelUp(five, content, { advancements: wizard, domainCard: 'fixture-guard-4' }).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('already multiclassed'));
  });

  it('crosses out the mastery card, and is crossed out by a subclass card on the same sheet', () => {
    // Multiclass first: one subclass upgrade is still there, the second is crossed out.
    const five = climb(toFour(kara()), [toFive(wizard)]);
    const six = climb(five, [{ advancements: [{ kind: 'subclass' }, { kind: 'stress' }], domainCard: 'fixture-guard-4' }]);
    expect(subclassStage(six)).toBe('specialization');
    expect(availableAdvancements(six, 8).find((o) => o.kind === 'subclass')).toBeUndefined();
    expect(
      levelUp(six, content, { advancements: [{ kind: 'subclass' }, { kind: 'stress' }], domainCard: 'fixture-guard-6' }).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('crossed out the mastery card'));

    // Subclass card first: this tier's multiclass box is crossed out, the next tier's is not.
    const upgraded = climb(toFour(kara()), [toFive([{ kind: 'subclass' }, { kind: 'stress' }])]);
    expect(availableAdvancements(upgraded, 6).find((o) => o.kind === 'multiclass')).toBeUndefined();
    expect(
      levelUp(upgraded, content, { advancements: wizard, domainCard: 'fixture-guard-4' }).issues.map((i) => i.message),
    ).toContainEqual(expect.stringContaining('crossed out by the tier 3 subclass card'));
    expect(availableAdvancements(upgraded, 8).find((o) => o.kind === 'multiclass')?.tier).toBe(4);
  });
});
