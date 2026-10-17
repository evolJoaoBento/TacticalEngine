import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { awaitingLevel } from './level-up';
import { runScript } from '../engine/script/runner';
import { createRng } from '../engine/core/rng';

/**
 * Levelling up, in the game.
 *
 * The engine decides whether a plan is legal; this is about what happens
 * around it — the GM granting a level through a script, the HUD knowing who
 * has one waiting, pools growing without clearing a wound, and a save carrying
 * the grown sheet.
 */

const scene = (seed = 'demo'): DemoScene => buildDemoScene(hollowVaultMap(), seed);

/** The GM says so. */
function grant(demo: DemoScene, level?: number): void {
  runScript([{ kind: 'levelUp', ...(level === undefined ? {} : { level }) }], demo.world, createRng(1));
}

describe('granting a level', () => {
  it('starts with nobody waiting', () => {
    expect(awaitingLevel(scene())).toEqual([]);
  });

  it('raises the party level by one, and everyone is waiting', () => {
    const demo = scene();
    grant(demo);
    expect(demo.scenario.partyLevel).toBe(2);
    expect(awaitingLevel(demo).sort()).toEqual(['arty', 'finn', 'ganja', 'kara', 'mira', 'pint']);
  });

  it('can name the level, and never goes backwards', () => {
    const demo = scene();
    grant(demo, 4);
    expect(demo.scenario.partyLevel).toBe(4);
    grant(demo, 2);
    expect(demo.scenario.partyLevel).toBe(4);
  });

  it('is journalled as news', () => {
    const demo = scene();
    const journal = runScript([{ kind: 'levelUp' }], demo.world, createRng(1));
    expect(journal).toContainEqual({ kind: 'levelUp', level: 2 });
  });
});
