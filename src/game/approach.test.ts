/**
 * A click on a thing out of reach: walked up to, then used - as a click on an adversary out of
 * reach walks up to swing. And not walked to when nowhere this move is in reach of it.
 */

import { describe, it, expect } from 'vitest';
import { buildDemoScene, buildProjectScene, DEMO_REACH, useSelectedOn, type DemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { closeToUse, startEncounter } from './movement';
import { openContainer } from './prop-use';
import type { Deco, ProjectDoc } from '../engine/scene/schema';

/** The demo with these props added to the vault, stood up the way a project file is, Quim selected. */
function withProps(...decos: Deco[]): DemoScene {
  const project = JSON.parse(JSON.stringify(buildDemoScene(hollowVaultMap()).project)) as ProjectDoc;
  project.scenes[0]!.decos.push(...decos);
  const demo = buildProjectScene(project, 'approach');
  demo.party.select('kara');
  return demo;
}

const standAt = (demo: DemoScene, id: string, x: number, y: number): void => {
  demo.state.moveEntity(id, demo.grid.indexOf(x, y));
  demo.state.placeEntity(id, x, y);
};

/** How many tiles apart, diagonals counting one: the measure reach is taken in. */
const apart = (demo: DemoScene, a: number, b: number): number =>
  Math.max(Math.abs(demo.grid.xOf(a) - demo.grid.xOf(b)), Math.abs(demo.grid.yOf(a) - demo.grid.yOf(b)));

const box: Deco = { id: 'box', model: 'rock', position: { x: 10, y: 9 }, rotation: 0, function: { kind: 'container', items: [{ item: 'minor-health-potion', count: 1 }] } };

describe('a click on a thing out of reach', () => {
  it('walks up to it, to a tile in reach, and then it is used from there', () => {
    const demo = withProps(box);
    standAt(demo, 'kara', 4, 9);
    // Out of reach as they stand: using it from here is refused, as it always was.
    expect(useSelectedOn(demo, 'box').status).toBe('unreachable');

    expect(closeToUse(demo, 'kara', 'box', DEMO_REACH)).toBe('closed');
    const at = demo.state.entity('kara')!.tile;
    expect(apart(demo, at, demo.grid.indexOf(10, 9))).toBeLessThanOrEqual(DEMO_REACH);
    // The nearest such tile, not any: the one on this side of it.
    expect(demo.grid.xOf(at)).toBe(9);
    // The walk is drawn like any other.
    expect(demo.motions.some((motion) => motion.id === 'kara' && (motion.path?.length ?? 0) > 1)).toBe(true);

    expect(useSelectedOn(demo, 'box').status).toBe('done');
    expect(openContainer(demo)).toBe('box');
  });

  it('walks nowhere when they are already in reach', () => {
    const demo = withProps(box);
    standAt(demo, 'kara', 9, 10);
    demo.motions.length = 0;
    expect(closeToUse(demo, 'kara', 'box', DEMO_REACH)).toBe('inReach');
    expect(demo.state.entity('kara')!.tile).toBe(demo.grid.indexOf(9, 10));
    expect(demo.motions).toEqual([]);
  });

  it('reaches a thing across several tiles by its nearest edge', () => {
    // A 3x3 block anchored at (10,9) covers (10..12, 9..11): its west edge is in reach from x = 9.
    const demo = withProps({ ...box, span: 3 });
    standAt(demo, 'kara', 4, 10);
    expect(closeToUse(demo, 'kara', 'box', DEMO_REACH)).toBe('closed');
    expect(demo.grid.xOf(demo.state.entity('kara')!.tile)).toBe(9);
  });

  it('in a fight, walks up only as far as the move a turn allows, and not at all past it', () => {
    const near = withProps({ ...box, position: { x: 7, y: 9 } });
    startEncounter(near, near.scene.encounters[0]!.id);
    standAt(near, 'kara', 4, 9);
    expect(closeToUse(near, 'kara', 'box', DEMO_REACH)).toBe('closed');
    expect(near.grid.xOf(near.state.entity('kara')!.tile)).toBe(6);

    const far = withProps({ ...box, position: { x: 30, y: 26 } });
    startEncounter(far, far.scene.encounters[0]!.id);
    standAt(far, 'kara', 4, 9);
    expect(closeToUse(far, 'kara', 'box', DEMO_REACH)).toBe('short');
    expect(far.state.entity('kara')!.tile).toBe(far.grid.indexOf(4, 9));
  });

  it('does not move when nowhere they could walk is in reach of it', () => {
    // Walled in on every side by solid rocks: there is no tile beside it to stand on.
    const ring: Deco[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx !== 0 || dy !== 0) ring.push({ model: 'rock', position: { x: 10 + dx, y: 9 + dy }, rotation: 0, solid: true });
      }
    }
    const demo = withProps(box, ...ring);
    standAt(demo, 'kara', 4, 9);
    demo.motions.length = 0;
    expect(closeToUse(demo, 'kara', 'box', DEMO_REACH)).toBe('short');
    expect(demo.state.entity('kara')!.tile).toBe(demo.grid.indexOf(4, 9));
    expect(demo.motions).toEqual([]);
    // And the use says why, as it did before.
    expect(useSelectedOn(demo, 'box').status).toBe('unreachable');
    expect(demo.log.at(-1)!.text).toBe('It is out of reach.');
  });
});
