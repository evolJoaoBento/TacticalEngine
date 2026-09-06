import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adversaryTraits, attackDamageOf, isFeatureImplemented } from './adversary-features';
import { importSeansboxAdversaries } from '../content/srd/seansbox-adversaries';
import type { AdversaryFeature } from '../content/types';

/**
 * The features the engine runs are read off the printed stat block, so the
 * numbers in brackets have to survive the trip: Relentless (3) is three
 * spotlights, Horde (1d4+1) is a second damage line, Minion (3) is three
 * damage per extra minion.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const adversaries = importSeansboxAdversaries(
  JSON.parse(readFileSync(`${repoRoot}tools/srd-sources/seansbox/adversaries.json`, 'utf8')),
).defs;

const feature = (name: string, parameter?: string): AdversaryFeature => ({
  name,
  kind: 'passive',
  text: '',
  costsFear: false,
  ...(parameter === undefined ? {} : { parameter }),
});

describe('reading a stat block', () => {
  it('counts the spotlights Relentless allows, and one for everything else', () => {
    expect(adversaryTraits({ features: [] }).spotlights).toBe(1);
    expect(adversaryTraits({ features: [feature('Relentless', '3')] }).spotlights).toBe(3);
    // The importer keeps the parenthetical; a block that lost it still gets two.
    expect(adversaryTraits({ features: [feature('Relentless')] }).spotlights).toBe(2);
  });

  it('reads Momentum, Terrifying and Minion', () => {
    const traits = adversaryTraits({ features: [feature('Momentum'), feature('Terrifying'), feature('Minion', '3')] });
    expect(traits.momentum).toBe(true);
    expect(traits.terrifying).toBe(true);
    expect(traits.minion).toBe(3);
  });

  it("switches a Horde's damage once half its Hit Points are marked", () => {
    const def = { features: [feature('Horde', '1d4+1')], attackDamage: { count: 1, sides: 6, modifier: 2 } };
    expect(attackDamageOf(def, { max: 4, marked: 1 })).toEqual(def.attackDamage);
    expect(attackDamageOf(def, { max: 4, marked: 2 })).toMatchObject({ count: 1, sides: 4, modifier: 1 });
  });

  it('says which of a real adversary\'s features it runs', () => {
    const burrower = adversaries.find((a) => a.id === 'acid-burrower')!;
    expect(adversaryTraits(burrower).spotlights).toBe(3);
    const names = burrower.features.filter(isFeatureImplemented).map((f) => f.name);
    expect(names.some((n) => n.startsWith('Relentless'))).toBe(true);
    // Earth Eruption is a script, not a rule read off the block, so not here.
    expect(names.some((n) => n.startsWith('Earth Eruption'))).toBe(false);
  });
});
