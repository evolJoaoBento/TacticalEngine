/**
 * The camera in a conversation: centred and drawn in on whoever is being talked to, kept there -
 * no panning, no zooming, no following the selected - while the angle stays the player's, and put
 * back where it was when the conversation ends.
 */

import { describe, it, expect } from 'vitest';
import { TileGrid, type Spot } from '../engine/grid/grid';
import { OrbitCamera } from '../engine/render/camera';
import { DEFAULT_LAYOUT, spotToWorld } from '../engine/render/layout';
import { CameraFocus } from './camera-focus';

describe('a held camera', () => {
  it('turns, but does not pan, zoom or follow, and goes back to where it was when let go', () => {
    const camera = new OrbitCamera({ target: { x: 1, y: 0, z: 2 }, distance: 20, yaw: 0.2 });
    camera.hold({ x: 5, y: 0.5, z: -3 }, 6);
    expect(camera.held).toBe(true);
    expect(camera.goal.target).toEqual({ x: 5, y: 0.5, z: -3 });
    expect(camera.goal.distance).toBe(6);
    camera.pan(4, 4);
    camera.zoom(3);
    expect(camera.follow({ x: 40, z: 40 }, 0)).toBe(false);
    expect(camera.goal.target).toEqual({ x: 5, y: 0.5, z: -3 });
    expect(camera.goal.distance).toBe(6);
    // The angle is still the player's.
    camera.orbit(0.5, 0);
    expect(camera.goal.yaw).toBeCloseTo(0.7, 9);
    camera.release();
    expect(camera.held).toBe(false);
    expect(camera.goal.target).toEqual({ x: 1, y: 0, z: 2 });
    expect(camera.goal.distance).toBe(20);
    // Free again.
    camera.zoom(0.5);
    expect(camera.goal.distance).toBe(10);
  });
});

describe('the focus in a conversation', () => {
  it('holds the camera on whoever is talked to while the talk lasts, and lets go after', () => {
    const grid = new TileGrid({ width: 12, height: 8 });
    const camera = new OrbitCamera({ distance: 24 });
    let talking: Spot | null = null;
    const focus = new CameraFocus(camera, { hasWalk: () => false, layout: DEFAULT_LAYOUT }, () => ({ grid, at: () => null, talking }));
    focus.tick();
    expect(camera.held).toBe(false);

    talking = { x: 9, y: 2 };
    focus.tick();
    const there = spotToWorld(grid, talking, DEFAULT_LAYOUT);
    expect(camera.held).toBe(true);
    expect(camera.goal.target.x).toBeCloseTo(there.x, 9);
    expect(camera.goal.target.z).toBeCloseTo(there.z, 9);
    // As close as the camera goes.
    expect(camera.goal.distance).toBe(camera.limits.minDistance);

    talking = null;
    focus.tick();
    expect(camera.held).toBe(false);
    expect(camera.goal.distance).toBe(24);
  });
});
