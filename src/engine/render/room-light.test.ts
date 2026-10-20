import { describe, expect, it } from 'vitest';
import { Group, PointLight, Scene, Texture } from 'three';
import { addLightRig, ENVIRONMENT_INTENSITY, RIG_LEVELS, setEnvironment, SUN_INTENSITY } from './light-rig';
import { BURNING, LAMPS, RoomLight } from './room-light';

/**
 * A room's own light (`room-light.ts`): the rig turned down to it, and what burns in a dim room lit where it stands -
 * as many lamps as a room may have, made once and kept.
 */

function room() {
  const scene = new Scene();
  const root = new Group();
  scene.add(root);
  const rig = addLightRig(scene);
  const light = new RoomLight(root, scene, () => rig);
  const lamps = () => root.children.filter((child): child is PointLight => child instanceof PointLight);
  return { scene, root, rig, light, lamps };
}

/** A prop where it stands in the room. */
const at = (model: string, x: number, z: number) => {
  const group = new Group();
  group.position.set(x, 0.25, z);
  return { model, at: group };
};

describe("a room's own light", () => {
  it('is daylight when the room says nothing: the rig as it always was, and nothing lit', () => {
    const { rig, light, lamps } = room();
    light.light(undefined, [at('camp-fire-prop', 0, 0), at('wall-torch-prop', 1, 0)]);
    expect([rig.ambient.intensity, rig.sky.intensity, rig.sun.intensity]).toEqual([RIG_LEVELS.ambient[0], RIG_LEVELS.sky[0], SUN_INTENSITY]);
    expect(lamps()).toEqual([]);
    expect(light.lit()).toBe(0);
  });

  it('turns the rig down in a dim room, and lights what burns there, its flame above it', () => {
    const { scene, rig, light, lamps } = room();
    light.light(0.3, [at('camp-fire-prop', 2, 3), at('barrel-prop', 4, 4), at('standing-torch-prop', -1, 5)]);
    expect(rig.ambient.intensity).toBeCloseTo(RIG_LEVELS.ambient[0] * 0.3);
    expect(rig.sky.intensity).toBeCloseTo(RIG_LEVELS.sky[0] * 0.3);
    expect(rig.sun.intensity).toBeCloseTo(SUN_INTENSITY * 0.3);
    expect(scene.environmentIntensity).toBeCloseTo(ENVIRONMENT_INTENSITY * 0.3);
    // As many lamps as a room may have, two of them lit: the fire and the torch, not the barrel.
    expect(lamps()).toHaveLength(LAMPS);
    expect(light.lit()).toBe(2);
    const [fire, torch] = lamps();
    expect([fire!.position.x, fire!.position.y, fire!.position.z]).toEqual([2, 0.25 + BURNING['camp-fire-prop']!.flame, 3]);
    expect(fire!.distance).toBe(BURNING['camp-fire-prop']!.reach);
    expect(fire!.intensity).toBeGreaterThan(0);
    expect(torch!.position.y).toBeCloseTo(0.25 + BURNING['standing-torch-prop']!.flame);
    expect(lamps().slice(2).every((lamp) => lamp.intensity === 0)).toBe(true);
    // The darker the room, the brighter its fires.
    const dimmer = room();
    dimmer.light.light(0.15, [at('camp-fire-prop', 2, 3)]);
    expect(dimmer.lamps()[0]!.intensity).toBeGreaterThan(fire!.intensity);
  });

  it('lights no more than it has lamps for, and keeps its lamps - dark - in a room lit again', () => {
    const { rig, light, lamps } = room();
    light.light(0.2, Array.from({ length: LAMPS + 3 }, (_, n) => at('wall-torch-prop', n, 0)));
    expect(light.lit()).toBe(LAMPS);
    light.light(undefined, [at('wall-torch-prop', 0, 0)]);
    expect(lamps()).toHaveLength(LAMPS);
    expect(lamps().every((lamp) => lamp.intensity === 0)).toBe(true);
    expect(light.lit()).toBe(0);
    expect(rig.sun.intensity).toBe(SUN_INTENSITY);
  });

  it('stays turned down when the room is given its reflections, or they are taken away', () => {
    const { scene, rig, light } = room();
    light.light(0.5, []);
    setEnvironment(scene, rig, new Texture());
    light.dim();
    expect(rig.ambient.intensity).toBeCloseTo(RIG_LEVELS.ambient[1] * 0.5);
    setEnvironment(scene, rig, null);
    light.dim();
    expect(rig.ambient.intensity).toBeCloseTo(RIG_LEVELS.ambient[0] * 0.5);
  });

  it('flickers each flame its own way, never far from its brightness, and the dark lamps not at all', () => {
    const { light, lamps } = room();
    light.light(0.3, [at('wall-torch-prop', 0, 0), at('wall-torch-prop', 3, 0)]);
    const steady = lamps().map((lamp) => lamp.intensity);
    const seen: number[][] = [];
    for (let n = 0; n < 20; n++) {
      light.tick(0.05);
      seen.push(lamps().map((lamp) => lamp.intensity));
    }
    for (const frame of seen) {
      frame.slice(0, 2).forEach((intensity, n) => expect(Math.abs(intensity - steady[n]!) / steady[n]!).toBeLessThanOrEqual(0.12 + 1e-9));
      expect(frame.slice(2).every((intensity) => intensity === 0)).toBe(true);
    }
    expect(new Set(seen.map((frame) => frame[0]!.toFixed(4))).size).toBeGreaterThan(5);
    expect(seen.some((frame) => frame[0] !== frame[1])).toBe(true);
  });
});
