/**
 * The light a room is drawn in (`light-rig.ts`): the rig as it always was, and the light the room gives back put in and
 * taken out - the ambient and the sky stepping down while it lights, and back up once it is gone. (The room's light is
 * made on a WebGL renderer, which a unit test has none of: the e2e suite draws it.)
 */

import { describe, expect, it } from 'vitest';
import { Scene, Texture } from 'three';
import { ENVIRONMENT_INTENSITY, RIG_LEVELS, addLightRig, setEnvironment } from './light-rig';

describe('the light a room is drawn in', () => {
  it('is a sky, a little ambient and a casting sun, at the levels it always had', () => {
    const scene = new Scene();
    const rig = addLightRig(scene);
    expect([rig.ambient.intensity, rig.sky.intensity, rig.sun.intensity]).toEqual([0.42, 0.6, 1.5]);
    expect(rig.sun.castShadow).toBe(true);
    expect(scene.children).toEqual(expect.arrayContaining([rig.ambient, rig.sky, rig.sun, rig.sun.target]));
    expect(scene.environment).toBeNull();
  });

  it('takes the light the room gives back, stepping the ambient and the sky down, and gives it up again', () => {
    const scene = new Scene();
    const rig = addLightRig(scene);
    const room = new Texture();
    setEnvironment(scene, rig, room);
    expect(scene.environment).toBe(room);
    expect(scene.environmentIntensity).toBe(ENVIRONMENT_INTENSITY);
    expect([rig.ambient.intensity, rig.sky.intensity]).toEqual([RIG_LEVELS.ambient[1], RIG_LEVELS.sky[1]]);
    expect(rig.ambient.intensity).toBeLessThan(RIG_LEVELS.ambient[0]);
    setEnvironment(scene, rig, null);
    expect(scene.environment).toBeNull();
    expect([rig.ambient.intensity, rig.sky.intensity]).toEqual([0.42, 0.6]);
    expect(rig.sun.intensity).toBe(1.5);
  });
});
