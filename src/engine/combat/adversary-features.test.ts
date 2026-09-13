import { describe, it, expect } from 'vitest';
import { adversaryTraits, attackDamageOf, isFeatureImplemented } from './adversary-features';
import type { AdversaryFeature } from '../content/types';

/**
 * The features the engine runs are read off the printed stat block, so the
 * numbers in brackets have to survive the trip: Relentless (3) is three
 * spotlights, Horde (1d4+1) is a second damage line, Minion (3) is three
 * damage per extra minion.
 */

const feature = (name: string, parameter?: string): AdversaryFeature => ({
  name,
  kind: 'passive',
  text: '',
  costsGmResource: false,
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

  /**
   * A block as it arrives off a printed stat line, with the parenthetical still
   * in the name. `parameterOf` reads `feature.parameter` when the importer has
   * split one out and falls back to a regex over the name when it has not, and
   * this is the only test of that second path -- the `feature()` helper above
   * always sets `parameter`, so using it here would quietly stop covering the
   * branch this case exists for.
   */
  it('reads a block whose parameter is still in the printed name', () => {
    const printed = {
      features: [
        { name: 'Relentless (3)', kind: 'passive', text: '', costsGmResource: false },
        { name: 'Earth Eruption - Action', kind: 'action', text: '', costsGmResource: true },
      ] satisfies AdversaryFeature[],
    };
    expect(adversaryTraits(printed).spotlights).toBe(3);
    const names = printed.features.filter(isFeatureImplemented).map((f) => f.name);
    expect(names.some((n) => n.startsWith('Relentless'))).toBe(true);
    // Earth Eruption is a script, not a rule read off the block, so not here.
    expect(names.some((n) => n.startsWith('Earth Eruption'))).toBe(false);
  });
});
