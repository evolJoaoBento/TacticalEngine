import { describe, it, expect } from 'vitest';
import { hollowVaultMap } from './demo-map';
import { tileOf } from '../engine/scene/grid-from-scene';
import { buildDemoScene, type DemoScene } from './demo-scene';
import { interactablesOf } from '../engine/scene/prop-functions';

/**
 * The vault door, picked rather than force-opened.
 *
 * It starts shut and in the way; a Finesse roll opens it; a failed roll leaves
 * it shut but does not use it up; an open door is not rolled again.
 */

const scene = (seed: string): DemoScene => buildDemoScene(hollowVaultMap(), seed);

function door(demo: DemoScene) {
  return interactablesOf(demo.scene).find((i) => i.kind === 'door')!;
}

describe('the vault door', () => {
  it('starts shut and blocks the way', () => {
    const demo = scene('door');
    const d = door(demo);
    expect(demo.state.interactable(d.id).open).toBe(false);
    expect(demo.state.blockedFor(demo.party.selected!)(tileOf(demo.grid, d.position))).toBe(true);
    expect(d.repeatable).toBe(true);
  });
});
