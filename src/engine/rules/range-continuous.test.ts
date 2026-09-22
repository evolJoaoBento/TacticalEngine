/**
 * Range is a real number: measured from where one creature stands to where the other does,
 * with every band reaching half a tile past its number - which is what "to the nearest tile"
 * always meant, so nothing between two tile centres falls anywhere new.
 */

import { describe, expect, it } from 'vitest';
import { resolveAttack, type AttackProfile } from '../combat/attack';
import { evaluateTarget } from '../combat/targeting';
import { createRng } from '../core/rng';
import { TileGrid } from '../grid/grid';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import { parseDice } from './dice';
import { BAND_GRACE, bandBetweenStanding, bandForDistance, bandForSpan } from './range';

const table = { melee: 1, veryClose: 2, close: 4, far: 8, veryFar: 12 };

describe('the band a span falls in', () => {
  it('is what rounding to the nearest tile gave, for every span between two tile centres', () => {
    for (let dx = 0; dx <= 14; dx++) {
      for (let dy = 0; dy <= 14; dy++) {
        const span = Math.hypot(dx, dy);
        expect(bandForSpan(span, table)).toBe(bandForDistance(Math.round(span), table));
      }
    }
  });

  it('turns over at half a tile past the number, and not a hair before', () => {
    expect(BAND_GRACE).toBe(0.5);
    expect(bandForSpan(1.499, table)).toBe('melee');
    expect(bandForSpan(1.5, table)).toBe('veryClose');
    expect(bandForSpan(Math.SQRT2, table)).toBe('melee'); // corner to corner
    expect(bandForSpan(4.49, table)).toBe('close');
    expect(bandForSpan(4.51, table)).toBe('far');
    expect(bandForSpan(12.6, table)).toBe('outOfRange');
  });

  it('is measured between where two creatures stand', () => {
    const at = (tile: number, x: number, y: number) => ({ tile, at: { x, y } });
    // Two tiles apart by their squares, and a lean towards each other is Melee.
    expect(bandBetweenStanding(at(0, 0, 0), at(2, 2, 0), table)).toBe('veryClose');
    expect(bandBetweenStanding(at(0, 0.3, 0), at(2, 1.7, 0), table)).toBe('melee');
    // Next to each other by their squares, and backed away to the far edges is not.
    expect(bandBetweenStanding(at(0, -0.4, 0), at(1, 1.4, 0), table)).toBe('veryClose');
    expect(bandBetweenStanding(at(0, 0, 0), undefined, table)).toBeNull();
    expect(bandBetweenStanding(at(-1, 0, 0), at(1, 1, 0), table)).toBeNull();
  });
});

describe('an attack', () => {
  const grid = new TileGrid({ width: 8, height: 3 });

  it('reaches by the spots when it is told them, and by the squares when it is not', () => {
    const from = grid.indexOf(1, 1);
    const to = grid.indexOf(3, 1);
    expect(evaluateTarget(grid, from, to, 'melee', { bandTiles: table }).refusal).toBe('outOfRange');
    const leaning = { attacker: { x: 1.3, y: 1 }, target: { x: 2.7, y: 1 } };
    const report = evaluateTarget(grid, from, to, 'melee', { bandTiles: table, at: leaning });
    expect(report.refusal).toBeNull();
    expect(report.distance).toBeCloseTo(1.4, 6);
    expect(report.band).toBe('melee');
  });

  it('measures two bodies a scene is keeping from where they stand', () => {
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(1, 1)));
    state.addEntity(createAdversaryEntity('husk', 'husk', grid.indexOf(3, 1), { hitPoints: 8, stress: 3 }));
    const profile: AttackProfile = { kind: 'pc', name: 'Greatblade', modifier: parseDice('+2')!, range: 'melee', damage: parseDice('d8+2 phy')!, proficiency: 2 };
    const swing = () => resolveAttack(createRng('reach'), { grid, attacker: state.entity('kara')!, target: state.entity('husk')!, profile, defender: { difficulty: 13, thresholds: { major: 8, severe: 15 } }, options: { bandTiles: table } });
    // Two squares apart is past a blade, from the middle of each.
    expect(swing().refused).toBe('outOfRange');
    // The same two squares, with both of them leaning in: a step of a third of a tile each is what it took.
    state.placeEntity('kara', 1.3, 1);
    state.placeEntity('husk', 2.7, 1);
    expect(state.entity('kara')!.tile).toBe(grid.indexOf(1, 1));
    expect(swing().refused).toBeNull();
  });
});
