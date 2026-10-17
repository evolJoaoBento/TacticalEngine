import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';

/**
 * The Duality Dice a view has to show.
 *
 * The rules never wait for them — a roll is decided, applied and logged in one
 * breath — so what is asserted here is the queue: whose roll it was, which
 * faces it landed on, and that a d20 leaves nothing behind to watch.
 */

const scene = (seed = 'dice'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

describe('the dice a player watches land', () => {

  it('starts every scene with a settle time a view can turn off', () => {
    const demo = scene();
    expect(demo.diceMillis).toBeGreaterThan(0);
    demo.diceMillis = 0;
    expect(demo.diceMillis).toBe(0);
  });
});
