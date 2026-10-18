/**
 * The light a room is drawn in (`SceneView`): a sky over it, a little ambient so nothing is black, and a sun that
 * casts. The shadow is the depth cue that makes a wall read as standing on the floor rather than painted on it, and a
 * token as standing rather than floating; its camera is fitted to the map so the whole room is inside it whatever the
 * room's size (`fitSun`).
 */

import { AmbientLight, Color, DirectionalLight, HemisphereLight, type Scene } from 'three';
import type { TileGrid } from '../grid/grid';
import { mapExtent, type TileLayout } from './layout';

/** The rig put into a scene: the sun it casts with, for the view to fit to its room. */
export function addLightRig(scene: Scene): DirectionalLight {
  // Warm, as a painted room is: a candle-coloured sky, a plum floor bounce, and an
  // afternoon sun, which the toon ramp turns into flat lit and shaded sides.
  scene.add(new AmbientLight(new Color('#fff1e0'), 0.42));
  scene.add(new HemisphereLight(new Color('#ffe6c4'), new Color('#3d2c48'), 0.6));
  const sun = new DirectionalLight(new Color('#ffe3b8'), 1.5);
  sun.castShadow = true;
  // 1024 is soft enough on a 22-tile room, and half the cost of the next
  // size up on the software GL the browser suite runs on.
  sun.shadow.mapSize.set(1024, 1024);
  // Flat-shaded boxes lit at a low angle acne without a bias along the normal.
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  // The light aims at its target, which lives at the origin unless it is in the scene.
  scene.add(sun.target);
  return sun;
}

/** The sun where this room wants it, with its shadow camera round the whole room. */
export function fitSun(sun: DirectionalLight, grid: TileGrid, layout: TileLayout): void {
  // Low enough that a wall throws a shadow you can see, high enough that
  // the shadow does not cover the tile beside it: about fifty degrees up.
  sun.position.set(grid.width * 0.55, Math.max(grid.width, grid.height) * 0.6, grid.height * 0.5);
  const extent = mapExtent(grid, layout);
  const reach = extent.radius * 1.1;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = extent.radius * 6;
  sun.shadow.camera.updateProjectionMatrix();
}
