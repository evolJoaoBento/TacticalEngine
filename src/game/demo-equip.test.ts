import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { gearOf } from './equip';

/**
 * Changing what a character wields and wears.
 *
 * The rule under test is that the sheet, the derived numbers, the live pools
 * and the pack all move together — a swap that changed one and not the others
 * is the kind of bug a player finds three fights later.
 */

const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('equipping', () => {
  it('starts with the sheet\'s own gear, by name', () => {
    expect(gearOf(scene(), 'kara')).toEqual({ weapon: 'Longsword', armor: 'Ringmail' });
  });
});
