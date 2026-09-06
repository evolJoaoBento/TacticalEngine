import { describe, it, expect } from 'vitest';
import { DEFAULT_LIMITS, OrbitCamera, positionOf } from './camera';

/**
 * The camera as numbers. What matters: the clamps hold, pan is screen-relative
 * whichever way the camera has turned, and the easing settles exactly.
 */

describe('orbiting', () => {
  it('turns around the target', () => {
    const cam = new OrbitCamera({ distance: 10, pitch: 0.5 });
    const before = positionOf(cam.goal);
    cam.orbit(Math.PI / 2, 0);
    const after = positionOf(cam.goal);
    // Same height and distance, different place on the ring.
    expect(after.y).toBeCloseTo(before.y);
    expect(Math.hypot(after.x, after.z)).toBeCloseTo(Math.hypot(before.x, before.z));
    expect(after.x).not.toBeCloseTo(before.x);
  });

  it('never goes flat or overhead', () => {
    const cam = new OrbitCamera();
    cam.orbit(0, -10);
    expect(cam.goal.pitch).toBe(DEFAULT_LIMITS.minPitch);
    cam.orbit(0, 10);
    expect(cam.goal.pitch).toBe(DEFAULT_LIMITS.maxPitch);
  });
});

describe('zooming', () => {
  it('scales the distance within limits', () => {
    const cam = new OrbitCamera({ distance: 20 });
    cam.zoom(0.5);
    expect(cam.goal.distance).toBe(10);
    cam.zoom(0.001);
    expect(cam.goal.distance).toBe(DEFAULT_LIMITS.minDistance);
    cam.zoom(1000);
    expect(cam.goal.distance).toBe(DEFAULT_LIMITS.maxDistance);
  });
});

describe('panning', () => {
  it('moves the target along the ground, not up', () => {
    const cam = new OrbitCamera();
    cam.pan(3, 0);
    expect(cam.goal.target.y).toBe(0);
    expect(Math.hypot(cam.goal.target.x, cam.goal.target.z)).toBeCloseTo(3);
  });

  it('is screen-relative: "right" stays right after a quarter turn', () => {
    // At yaw 0 the camera sits at +z looking toward -z, so screen-right is +x.
    const straight = new OrbitCamera({ yaw: 0 });
    straight.pan(1, 0);
    expect(straight.goal.target.x).toBeCloseTo(1);
    expect(straight.goal.target.z).toBeCloseTo(0);

    // Turned a quarter, the camera sits at +x looking toward -x; right is -z.
    const turned = new OrbitCamera({ yaw: Math.PI / 2 });
    turned.pan(1, 0);
    expect(turned.goal.target.x).toBeCloseTo(0);
    expect(turned.goal.target.z).toBeCloseTo(-1);
  });

  it('"forward" walks away from the camera', () => {
    const cam = new OrbitCamera({ yaw: 0 });
    cam.pan(0, 2);
    // The camera is at +z; forward on the ground is -z.
    expect(cam.goal.target.z).toBeCloseTo(-2);
    const eye = positionOf(cam.goal);
    expect(eye.z).toBeGreaterThan(cam.goal.target.z);
  });
});

describe('framing', () => {
  it('fits a radius and keeps the angle', () => {
    const cam = new OrbitCamera({ yaw: 1, pitch: 0.7 });
    cam.frame({ x: 5, y: 0, z: 5 }, 10);
    expect(cam.goal.target).toEqual({ x: 5, y: 0, z: 5 });
    expect(cam.goal.distance).toBe(18);
    expect(cam.goal.yaw).toBe(1);
    expect(cam.goal.pitch).toBe(0.7);
  });
});

describe('easing', () => {
  it('moves toward the goal and settles exactly', () => {
    const cam = new OrbitCamera({ distance: 10 });
    cam.zoom(2);
    expect(cam.pose.distance).toBe(10);
    expect(cam.update(1 / 60)).toBe(true);
    expect(cam.pose.distance).toBeGreaterThan(10);
    expect(cam.pose.distance).toBeLessThan(20);
    for (let i = 0; i < 600; i++) cam.update(1 / 60);
    expect(cam.pose.distance).toBe(20);
    // Still: nothing to draw.
    expect(cam.update(1 / 60)).toBe(false);
  });

  it('snaps when asked', () => {
    const cam = new OrbitCamera();
    cam.orbit(1, 0);
    cam.snap();
    expect(cam.pose.yaw).toBe(cam.goal.yaw);
  });
});
