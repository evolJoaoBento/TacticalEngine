/**
 * Through a portal: a token blinks - shrinking away where it stood, growing back where it comes
 * out - and never walks the room between. After a walk up to the portal it blinks once it gets there.
 */

import { describe, it, expect } from 'vitest';
import { Group } from 'three';
import { TileGrid } from '../grid/grid';
import { SceneState, createPartyEntity } from '../scene/state';
import { BLINK_SECONDS, poseBlink, restFromBlink, startBlink } from './blink';
import { tileCenter } from './layout';
import { SceneView } from './scene-view';

describe('a blink, posed', () => {
  const token = (): Group => {
    const group = new Group();
    group.position.set(6, 0, 2);
    group.scale.set(2, 2, 2);
    group.rotation.y = 0.5;
    return group;
  };

  it('is whole where it stood at the start, gone at the middle, and whole where it came out at the end', () => {
    const group = token();
    const blink = startBlink(group, { x: 1, y: 0, z: 1 });
    poseBlink(group, blink, 0);
    expect(group.position.toArray()).toEqual([1, 0, 1]);
    expect(group.scale.x).toBeCloseTo(2, 9);

    poseBlink(group, blink, 0.25);
    expect(group.position.x).toBe(1);
    expect(group.scale.x).toBeGreaterThan(0);
    expect(group.scale.x).toBeLessThan(2);

    // Nothing to see at the turn, and never quite zero.
    poseBlink(group, blink, 0.5);
    expect(group.position.toArray()).toEqual([6, 0, 2]);
    expect(group.scale.x).toBeGreaterThan(0);
    expect(group.scale.x).toBeLessThan(0.01);

    poseBlink(group, blink, 1);
    expect(group.scale.x).toBeCloseTo(2, 9);
    // Round a whole turn each way: facing the way it did.
    expect(Math.cos(group.rotation.y - 0.5)).toBeCloseTo(1, 9);
  });

  it('is left at rest where it came out, its own size, facing as it did', () => {
    const group = token();
    const blink = startBlink(group, { x: 1, y: 0, z: 1 });
    poseBlink(group, blink, 0.7);
    restFromBlink(group, blink);
    expect(group.position.toArray()).toEqual([6, 0, 2]);
    expect(group.scale.toArray()).toEqual([2, 2, 2]);
    expect(group.rotation.y).toBe(0.5);
  });
});

describe('a token through a portal', () => {
  const setup = () => {
    const grid = new TileGrid({ width: 9, height: 3 });
    const state = new SceneState({ id: 'room' }, grid);
    state.addEntity(createPartyEntity('kara', 'sentinel', grid.indexOf(0, 1)));
    const view = new SceneView(grid);
    view.syncTokens(state);
    return { grid, state, view, token: view.tokenFor('kara')!.group };
  };

  it('blinks across the room from where it stood, and never walks it', () => {
    const { grid, state, view, token } = setup();
    state.moveEntity('kara', grid.indexOf(8, 1));
    view.teleport('kara');
    view.syncTokens(state);
    expect(view.glidingCount).toBe(0);
    expect(view.reactingCount).toBe(1);

    const out = tileCenter(grid, grid.indexOf(8, 1));
    const was = tileCenter(grid, grid.indexOf(0, 1));
    view.tick(BLINK_SECONDS * 0.25);
    // Still where it stood, going: not somewhere between.
    expect(token.position.x).toBeCloseTo(was.x, 6);
    view.tick(BLINK_SECONDS);
    expect(view.reactingCount).toBe(0);
    expect(token.position.x).toBeCloseTo(out.x, 6);
    expect(token.scale.x).toBeGreaterThan(0.5);
  });

  it('walks up to the portal first when that was the way there, and blinks once it arrives', () => {
    const { grid, state, view, token } = setup();
    // The walk up to the portal at (4,1), then through it to (8,1), in one go.
    const route = [grid.spotOf(grid.indexOf(0, 1)), grid.spotOf(grid.indexOf(3, 1))];
    state.moveEntity('kara', grid.indexOf(8, 1));
    view.walkAlong('kara', route);
    view.teleport('kara');
    view.syncTokens(state);
    expect(view.glidingCount).toBe(1);
    expect(view.reactingCount).toBe(0);

    // The walk goes no further than the portal: never out along the room to where they come out.
    let furthest = -Infinity;
    for (let i = 0; i < 40 && view.glidingCount > 0; i++) {
      view.tick(0.1);
      furthest = Math.max(furthest, token.position.x);
    }
    expect(furthest).toBeLessThanOrEqual(tileCenter(grid, grid.indexOf(3, 1)).x + 1e-6);
    // Arrived: now through it.
    expect(view.reactingCount).toBe(1);
    view.tick(BLINK_SECONDS * 2);
    expect(token.position.x).toBeCloseTo(tileCenter(grid, grid.indexOf(8, 1)).x, 6);
  });

  it('is simply put there when the view is told to snap', () => {
    const { grid, state, view, token } = setup();
    state.moveEntity('kara', grid.indexOf(8, 1));
    view.teleport('kara');
    view.syncTokens(state, { snap: true });
    expect(view.reactingCount).toBe(0);
    expect(view.glidingCount).toBe(0);
    expect(token.position.x).toBeCloseTo(tileCenter(grid, grid.indexOf(8, 1)).x, 6);
  });
});
