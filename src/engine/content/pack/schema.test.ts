import { describe, expect, it } from 'vitest';
import {
  adversaryDefSchema,
  adversaryFeatureSchema,
  armorDefSchema,
  classDefSchema,
  contentPackSchema,
  cardDefSchema,
  weaponDefSchema,
} from './schema';

describe('weapons', () => {
  it('accepts a weapon and keeps its damage expression', () => {
    const parsed = weaponDefSchema.parse({
      id: 'broadsword',
      name: 'Broadsword',
      tier: 1,
      slot: 'primaryPhysical',
      trait: 'agility',
      range: 'melee',
      damage: { count: 1, sides: 8, modifier: 3, types: ['physical'] },
      burden: 'oneHanded',
    });
    expect(parsed.damage.sides).toBe(8);
    expect(parsed.features).toEqual([]);
  });

  it('refuses a range band it does not know', () => {
    const bad = weaponDefSchema.safeParse({
      id: 'x',
      name: 'X',
      tier: 1,
      slot: 'secondary',
      trait: 'agility',
      range: 'adjacent',
      damage: { count: 1, sides: 6, modifier: 0 },
      burden: 'oneHanded',
    });
    expect(bad.success).toBe(false);
  });
});

describe('armors', () => {
  it('refuses a threshold that cannot survive a save', () => {
    // JSON.stringify(Infinity) is null: an infinite threshold is not storable.
    const bad = armorDefSchema.safeParse({
      id: 'chain',
      name: 'Chainmail',
      tier: 1,
      baseScore: 4,
      baseThresholds: { major: Infinity, severe: Infinity },
    });
    expect(bad.success).toBe(false);
  });

  it('takes finite thresholds', () => {
    const parsed = armorDefSchema.parse({
      id: 'chain',
      name: 'Chainmail',
      tier: 1,
      baseScore: 4,
      baseThresholds: { major: 7, severe: 15 },
    });
    expect(parsed.baseThresholds.severe).toBe(15);
  });
});

describe('classes', () => {
  it('carries its numbers and domains, and prints nothing of its own', () => {
    // What a class prints is cards that name it. A feature written the old way is dropped rather
    // than kept beside the cards, which would be two places to read the same words from.
    const parsed = classDefSchema.parse({
      id: 'sentinel',
      name: 'Sentinel',
      domains: ['bulwark'],
      startingEvasion: 9,
      startingHitPoints: 7,
      signatureFeature: { name: 'Hold the Line', text: 'Stand your ground.' },
    });
    expect(parsed).toEqual({ id: 'sentinel', name: 'Sentinel', domains: ['bulwark'], startingEvasion: 9, startingHitPoints: 7 });
  });
});

describe('cards', () => {
  it('takes a chosen card and defaults its grant and features', () => {
    const parsed = cardDefSchema.parse({
      id: 'power-slash',
      name: 'Power Slash',
      domain: 'blade',
      type: 'ability',
      level: 1,
      recallCost: 1,
      text: 'Strike hard.',
    });
    expect(parsed.grant).toEqual({ kind: 'chosen' });
    expect(parsed.features).toEqual([]);
  });

  it('asks a chosen card for what a loadout reads, and a granted one for none of it', () => {
    const chosen = cardDefSchema.safeParse({ id: 'loose', name: 'Loose' });
    expect(chosen.success).toBe(false);
    expect(chosen.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['domain', 'type', 'level', 'recallCost']);

    const granted = cardDefSchema.parse({ id: 'drilled', name: 'Drilled', grant: { kind: 'class', classId: 'sentinel' } });
    expect(granted.grant).toEqual({ kind: 'class', classId: 'sentinel' });
    expect(granted.domain).toBeUndefined();
  });

  it('refuses a grant that does not say what grants it', () => {
    expect(cardDefSchema.safeParse({ id: 'x', name: 'X', grant: { kind: 'class' } }).success).toBe(false);
    expect(
      cardDefSchema.safeParse({ id: 'x', name: 'X', grant: { kind: 'subclass', subclassId: 'y', stage: 'apprentice' } }).success,
    ).toBe(false);
  });
});

describe('adversaries', () => {
  const lurker = {
    id: 'fen-lurker',
    name: 'Fen Lurker',
    tier: 1,
    role: 'skulk',
    description: 'A long-limbed thing that waits under the water.',
    motivesAndTactics: 'Drag away the straggler, drown what it takes.',
    difficulty: 11,
    thresholds: { major: 6, severe: 12 },
    hitPoints: 4,
    stress: 3,
    attackName: 'Grasping Arms',
    attackModifier: { count: 0, sides: 0, modifier: 2 },
    attackRange: 'melee',
    attackDamage: { count: 1, sides: 6, modifier: 1, types: ['physical'] },
  };

  it('accepts a stat block and defaults its lists', () => {
    const parsed = adversaryDefSchema.parse({ ...lurker });
    expect(parsed.features).toEqual([]);
    expect(parsed.experiences).toEqual([]);
    expect(parsed.attackDamage.sides).toBe(6);
  });

  it('refuses a role it does not know', () => {
    expect(adversaryDefSchema.safeParse({ ...lurker, role: 'boss' }).success).toBe(false);
  });

  it('refuses a tier off the end of the scale', () => {
    expect(adversaryDefSchema.safeParse({ ...lurker, tier: 5 }).success).toBe(false);
  });

  it('names a feature for what it spends, not for the resource', () => {
    const parsed = adversaryFeatureSchema.parse({
      name: 'Undertow',
      kind: 'action',
      text: 'Pull a target into the water.',
      costsGmResource: true,
    });
    expect(parsed.costsGmResource).toBe(true);
    expect('costsFear' in parsed).toBe(false);
  });

  it('assumes a feature costs nothing unless it says so', () => {
    const parsed = adversaryFeatureSchema.parse({ name: 'Sodden', kind: 'passive', text: 'Slow on dry land.' });
    expect(parsed.costsGmResource).toBe(false);
  });
});

describe('the pack', () => {
  it('is empty by default, so a project that declares none still parses', () => {
    const parsed = contentPackSchema.parse({});
    expect(parsed.classes).toEqual([]);
    expect(parsed.weapons).toEqual([]);
    expect(parsed.adversaries).toEqual([]);
  });
});
