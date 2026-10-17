/**
 * The three who were added to play the rules against: what their cards do that nothing else does.
 *
 * Each of the six abilities here is the only one in the demo that reaches for its mechanic -
 * knockback, a magazine of tokens, a reroll of the duality dice, a place kept on the floor, and
 * Shadow handed to the GM by the party's own choice - so this is where those mechanics are held to
 * what they say they do.
 */

import { describe, expect, it } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';

const build = (seed = 'party'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('the party as it stands', () => {
  it('is six, each with the body their sheet names', () => {
    const demo = build();
    expect(demo.party.members()).toEqual(['kara', 'finn', 'mira', 'arty', 'pint', 'ganja']);
    expect([...demo.sheets.values()].map((s) => s.name)).toEqual(['Quim', 'Violet', 'Scarlet', 'Arty', 'Pint', 'Ganja']);
    // The three who were here are named for the models they are drawn with.
    for (const id of ['kara', 'finn', 'mira', 'arty', 'pint', 'ganja']) {
      const sheet = demo.sheets.get(id)!;
      expect(sheet.model).toBe(sheet.name!.toLowerCase());
    }
  });

  it('stands them all on the map, on their own tiles', () => {
    const demo = build();
    const tiles = demo.party.members().map((id) => demo.state.entity(id)!.tile);
    expect(new Set(tiles).size).toBe(6);
    for (const tile of tiles) expect(demo.grid.isPassable(tile)).toBe(true);
  });
});

describe('Pint, who keeps the place', () => {

  it('holds Footnote in the vault, because a card that answers every failure stops every roll', () => {
    const demo = build();
    expect(demo.sheets.get('pint')!.domainCards).toContain('footnote');
    expect(demo.sheets.get('pint')!.loadout).not.toContain('footnote');
    expect(demo.world.answersRoll('pint', { total: 8, outcome: 'failureWithBad' })).toBe(false);
  });
});
