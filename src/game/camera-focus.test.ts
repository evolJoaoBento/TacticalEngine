/**
 * The camera slides over whoever is selected, and over whoever comes out of a portal - once they
 * have finished walking up to it.
 */

import { describe, it, expect } from 'vitest';
import { TileGrid, type Spot } from '../engine/grid/grid';
import { OrbitCamera } from '../engine/render/camera';
import { DEFAULT_LAYOUT, spotToWorld } from '../engine/render/layout';
import { CameraFocus } from './camera-focus';

function setup() {
  const grid = new TileGrid({ width: 20, height: 10 });
  const camera = new OrbitCamera({ yaw: 0.3, pitch: 0.85 });
  camera.snap();
  const where = new Map<string, Spot>([['kara', { x: 2.5, y: 3.5 }], ['finn', { x: 15.5, y: 8.5 }]]);
  const gliding = new Set<string>();
  const view = { hasWalk: (id: string) => gliding.has(id), layout: DEFAULT_LAYOUT };
  const focus = new CameraFocus(camera, view, () => ({ grid, at: (id) => where.get(id) ?? null }));
  return { grid, camera, where, gliding, focus };
}

describe('the camera on whoever is played', () => {
  it('slides over the one selected, keeping its angle and distance', () => {
    const { grid, camera, focus } = setup();
    const before = { yaw: camera.goal.yaw, pitch: camera.goal.pitch, distance: camera.goal.distance };
    expect(focus.on('finn')).toBe(true);
    const there = spotToWorld(grid, { x: 15.5, y: 8.5 });
    expect(camera.goal.target.x).toBeCloseTo(there.x, 9);
    expect(camera.goal.target.z).toBeCloseTo(there.z, 9);
    expect({ yaw: camera.goal.yaw, pitch: camera.goal.pitch, distance: camera.goal.distance }).toEqual(before);
    // A slide, not a cut: the drawn pose is still where it was, and eases there.
    expect(camera.pose.target.x).not.toBeCloseTo(there.x, 3);
    for (let i = 0; i < 200; i++) camera.update(1 / 60);
    expect(camera.pose.target.x).toBeCloseTo(there.x, 2);
  });

  it('does nothing for somebody standing nowhere', () => {
    const { camera, focus } = setup();
    const before = { ...camera.goal.target };
    expect(focus.on('nobody')).toBe(false);
    expect(camera.goal.target).toEqual(before);
  });

  it('through a portal, goes to where they come out - after the walk up to it, not during', () => {
    const { grid, camera, where, gliding, focus } = setup();
    const before = { ...camera.goal.target };
    where.set('kara', { x: 18.5, y: 1.5 });
    gliding.add('kara');
    focus.through('kara');
    expect(camera.goal.target).toEqual(before);
    focus.tick();
    expect(camera.goal.target).toEqual(before);

    gliding.delete('kara');
    focus.tick();
    const out = spotToWorld(grid, { x: 18.5, y: 1.5 });
    expect(camera.goal.target.x).toBeCloseTo(out.x, 9);
    expect(camera.goal.target.z).toBeCloseTo(out.z, 9);
  });

  it('through a portal with no walk first, goes at once', () => {
    const { grid, camera, where, focus } = setup();
    where.set('kara', { x: 18.5, y: 1.5 });
    focus.through('kara');
    expect(camera.goal.target.x).toBeCloseTo(spotToWorld(grid, { x: 18.5, y: 1.5 }).x, 9);
  });
});
