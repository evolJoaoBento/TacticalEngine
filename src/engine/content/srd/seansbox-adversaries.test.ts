import { describe, it, expect } from 'vitest';
import {
  costsFear,
  importSeansboxAdversaries,
  parseExperiences,
  parseFeatureName,
  parseRole,
  type RawAdversary,
} from './seansbox-adversaries';

describe('parseFeatureName', () => {
  it('splits the three plain kinds', () => {
    expect(parseFeatureName('Earth Eruption - Action')).toEqual({
      name: 'Earth Eruption',
      kind: 'action',
    });
    expect(parseFeatureName('Acid Bath - Reaction')).toEqual({
      name: 'Acid Bath',
      kind: 'reaction',
    });
    expect(parseFeatureName('Arcane Form - Passive')?.kind).toBe('passive');
  });

  it('lifts the parenthetical out of the name, verbatim', () => {
    // The SRD gives each of these a different meaning, so none of them is parsed.
    expect(parseFeatureName('Relentless (3) - Passive')).toEqual({
      name: 'Relentless',
      kind: 'passive',
      parameter: '3',
    });
    expect(parseFeatureName('Minion (12) - Passive')).toEqual({
      name: 'Minion',
      kind: 'passive',
      parameter: '12',
    });
    expect(parseFeatureName('Horde (1d4+1) - Passive')).toEqual({
      name: 'Horde',
      kind: 'passive',
      parameter: '1d4+1',
    });
  });

  it('keeps a hyphen that belongs to the name', () => {
    expect(parseFeatureName('All-Consuming Rage - Reaction: Countdown (Decreasing 8)')).toEqual({
      name: 'All-Consuming Rage',
      kind: 'reaction',
      countdown: 'Decreasing 8',
    });
  });

  it('tolerates the missing space in the source data', () => {
    expect(parseFeatureName('Take Off- Action')).toEqual({ name: 'Take Off', kind: 'action' });
  });

  it('reads countdowns, including the long-term one', () => {
    expect(parseFeatureName('Rampage - Reaction: Countdown (Loop 1d6)')).toEqual({
      name: 'Rampage',
      kind: 'reaction',
      countdown: 'Loop 1d6',
    });
    expect(parseFeatureName('Casus Belli - Reaction: Long-Term Countdown (8)')).toEqual({
      name: 'Casus Belli',
      kind: 'reaction',
      countdown: '8',
      longTermCountdown: true,
    });
    expect(parseFeatureName('Apocalyptic Thrashing - Action: Countdown (1d12)')).toEqual({
      name: 'Apocalyptic Thrashing',
      kind: 'action',
      countdown: '1d12',
    });
  });

  it('returns null rather than guessing', () => {
    for (const bad of ['', 'Just A Name', 'Name - Interrupt', '- Action']) {
      expect(parseFeatureName(bad)).toBeNull();
    }
  });
});

describe('parseRole', () => {
  it('reads the plain roles', () => {
    expect(parseRole('Solo')).toEqual({ role: 'solo' });
    expect(parseRole('Minion')).toEqual({ role: 'minion' });
    expect(parseRole(' standard ')).toEqual({ role: 'standard' });
  });

  it('reads a Horde creatures-per-HP figure', () => {
    expect(parseRole('Horde (3/HP)')).toEqual({ role: 'horde', hordeUnitsPerHp: 3 });
  });

  it('accepts the two stat blocks that omit the Horde number', () => {
    expect(parseRole('Horde (/HP)')).toEqual({ role: 'horde' });
  });

  it('returns null for an unknown role', () => {
    expect(parseRole('Kaiju')).toBeNull();
    expect(parseRole('')).toBeNull();
  });
});

describe('parseExperiences', () => {
  it('reads one Experience', () => {
    expect(parseExperiences('Tremor Sense +2')).toEqual({
      experiences: [{ name: 'Tremor Sense', modifier: 2 }],
      unreadable: [],
    });
  });

  it('splits a comma-separated list', () => {
    expect(parseExperiences('Ancient Knowledge +3, High Society +2, Tactics +2').experiences).toEqual([
      { name: 'Ancient Knowledge', modifier: 3 },
      { name: 'High Society', modifier: 2 },
      { name: 'Tactics', modifier: 2 },
    ]);
  });

  it('is empty for missing text', () => {
    expect(parseExperiences(undefined)).toEqual({ experiences: [], unreadable: [] });
    expect(parseExperiences('')).toEqual({ experiences: [], unreadable: [] });
  });

  it('reports an unreadable part instead of dropping it', () => {
    const r = parseExperiences('Tracker +2, Nothing numeric here');
    expect(r.experiences).toEqual([{ name: 'Tracker', modifier: 2 }]);
    expect(r.unreadable).toEqual(['Nothing numeric here']);
  });
});

describe('costsFear', () => {
  it('spots the GM paying Fear', () => {
    expect(costsFear('Spend a Fear to make the Burrower attack again.')).toBe(true);
    expect(costsFear('Spend 2 Fear to summon reinforcements.')).toBe(true);
  });

  it('does not count the ordinary spotlight cost as a feature cost', () => {
    // Relentless prints this on every adversary that has it.
    expect(
      costsFear('The Legion can be spotlighted up to two times per GM turn. Spend Fear as usual to spotlight them.'),
    ).toBe(false);
  });

  it('does not fire on Fear that is merely mentioned', () => {
    expect(costsFear('The party gains a Fear when this fails.')).toBe(false);
    expect(costsFear('Targets are struck with fear and flee.')).toBe(false);
  });
});

describe('importSeansboxAdversaries', () => {
  const acidBurrower: RawAdversary = {
    name: 'Acid Burrower',
    type: 'Solo',
    tier: '1',
    description: 'A horse-sized insect with digging claws and acidic blood.',
    motives_and_tactics: 'Burrow, drag away, feed, reposition',
    difficulty: '14',
    thresholds: '8/15',
    hp: '8',
    stress: '3',
    atk: '+3',
    attack: 'Claws',
    range: 'Very Close',
    damage: '1d12+2 phy',
    experience: 'Tremor Sense +2',
    feature: [
      {
        name: 'Relentless (3) - Passive',
        text: 'Can be spotlighted up to three times per GM turn. Spend a Fear to enrage it.',
      },
    ],
  };

  it('normalizes a stat block into numbers, dice and enums', () => {
    const { defs, issues } = importSeansboxAdversaries([acidBurrower]);
    expect(issues).toEqual([]);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      id: 'acid-burrower',
      name: 'Acid Burrower',
      tier: 1,
      role: 'solo',
      description: 'A horse-sized insect with digging claws and acidic blood.',
      motivesAndTactics: 'Burrow, drag away, feed, reposition',
      difficulty: 14,
      thresholds: { major: 8, severe: 15 },
      hitPoints: 8,
      stress: 3,
      attackName: 'Claws',
      attackModifier: { count: 0, sides: 0, modifier: 3 },
      attackRange: 'veryClose',
      attackDamage: { count: 1, sides: 12, modifier: 2, types: ['physical'] },
      experiences: [{ name: 'Tremor Sense', modifier: 2 }],
      features: [
        {
          name: 'Relentless',
          kind: 'passive',
          parameter: '3',
          text: 'Can be spotlighted up to three times per GM turn. Spend a Fear to enrage it.',
          costsFear: true,
        },
      ],
    });
  });

  it('reports a broken entry instead of throwing, and keeps the good ones', () => {
    const broken: RawAdversary = { ...acidBurrower, name: 'Broken One', thresholds: 'ouch' };
    const { defs, issues } = importSeansboxAdversaries([acidBurrower, broken, acidBurrower]);
    expect(defs.map((d) => d.id)).toEqual(['acid-burrower']); // the third is a duplicate id
    expect(issues).toEqual([
      {
        source: 'seansbox/adversaries.json',
        entry: 'Broken One',
        field: 'thresholds',
        message: 'unreadable "ouch"',
      },
      {
        source: 'seansbox/adversaries.json',
        entry: 'Acid Burrower',
        field: 'name',
        message: 'duplicate id "acid-burrower"',
      },
    ]);
  });

  it('skips a single unreadable feature without losing the adversary', () => {
    const entry: RawAdversary = {
      ...acidBurrower,
      feature: [{ name: 'Nonsense', text: 'x' }, ...(acidBurrower.feature as unknown[])],
    };
    const { defs, issues } = importSeansboxAdversaries([entry]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.features.map((f) => f.name)).toEqual(['Relentless']);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('feature');
  });

  it('labels an entry with no usable name by its index', () => {
    const { defs, issues } = importSeansboxAdversaries([{ type: 'Solo' }]);
    expect(defs).toEqual([]);
    expect(issues[0]).toMatchObject({ entry: '#0', field: 'name' });
  });
});
