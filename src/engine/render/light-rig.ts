/**
 * The light a room is drawn in (`SceneView`): a sky over it, a little ambient so nothing is black, and a sun that
 * casts. The shadow is the depth cue that makes a wall read as standing on the floor rather than painted on it, and a
 * token as standing rather than floating; its camera is fitted to the map so the whole room is inside it whatever the
 * room's size (`fitSun`).
 *
 * And the light the room gives back (`roomEnvironment`, `setEnvironment`): an environment map, so a material's
 * roughness shapes more than the sun's one highlight - a rough stone stays matte, a smooth one catches the room - and
 * its ambient occlusion has light to take away. Made from a little room of the rig's own colours, the candle sky over
 * the plum floor with a bright patch where the sun is, so the look stays the painted one; the ambient and the sky
 * light step down while it is on, since it lights what they lit. A player may turn it off (`reflections`,
 * `game/user-settings.ts`), and the rig is as it always was.
 */

import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { TileGrid } from '../grid/grid';
import { mapExtent, type TileLayout } from './layout';

/** The rig's lights: the sun to fit to the room, and the two the room's own light stands in for. */
export interface LightRig {
  sun: DirectionalLight;
  ambient: AmbientLight;
  sky: HemisphereLight;
}

/** The ambient and the sky light, without the room's light and with it; and how strongly the room lights. */
export const RIG_LEVELS = { ambient: [0.42, 0.22], sky: [0.6, 0.3] } as const;
export const ENVIRONMENT_INTENSITY = 0.55;

/** The rig's colours: the sky, the floor's bounce, and the sun. */
const SKY = '#ffe6c4';
const FLOOR = '#3d2c48';
const SUN = '#ffe3b8';

/** The rig put into a scene: its lights, the sun for the view to fit to its room. */
export function addLightRig(scene: Scene): LightRig {
  // Warm, as a painted room is: a candle-coloured sky, a plum floor bounce, and an
  // afternoon sun, which the toon ramp turns into flat lit and shaded sides.
  const ambient = new AmbientLight(new Color('#fff1e0'), RIG_LEVELS.ambient[0]);
  const sky = new HemisphereLight(new Color(SKY), new Color(FLOOR), RIG_LEVELS.sky[0]);
  scene.add(ambient, sky);
  const sun = new DirectionalLight(new Color(SUN), 1.5);
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
  return { sun, ambient, sky };
}

/** Where the sun stands, as a direction from the middle of a room (`fitSun`'s, for a square room). */
const SUN_FROM = new Vector3(0.55, 0.6, 0.5).normalize();

/**
 * The light the room gives back, for this renderer: a sphere of the rig's sky fading to its floor, a bright patch where
 * the sun is, prefiltered for every roughness (`PMREMGenerator`). Made once; a scene is handed it by `setEnvironment`.
 */
export function roomEnvironment(renderer: WebGLRenderer): Texture {
  const room = new Scene();
  const sphere = new SphereGeometry(10, 32, 16);
  const up = new Color(SKY);
  const down = new Color(FLOOR);
  const position = sphere.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const mixed = new Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.min(1, Math.max(0, position.getY(i) / 10 * 0.5 + 0.5));
    mixed.copy(down).lerp(up, t * t * (3 - 2 * t));
    colors.set([mixed.r, mixed.g, mixed.b], i * 3);
  }
  sphere.setAttribute('color', new BufferAttribute(colors, 3));
  const walls = new MeshBasicMaterial({ vertexColors: true, side: BackSide });
  room.add(new Mesh(sphere, walls));
  const patch = new PlaneGeometry(5, 5);
  const glow = new MeshBasicMaterial({ color: new Color(SUN).multiplyScalar(4) });
  const window_ = new Mesh(patch, glow);
  window_.position.copy(SUN_FROM).multiplyScalar(9);
  window_.lookAt(0, 0, 0);
  room.add(window_);
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  for (const thing of [sphere, patch, walls, glow]) thing.dispose();
  return texture;
}

/** The room's light given to a scene, or taken away (`null`): the ambient and the sky stepped down while it lights. */
export function setEnvironment(scene: Scene, rig: LightRig, environment: Texture | null): void {
  scene.environment = environment;
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  const lit = environment === null ? 0 : 1;
  rig.ambient.intensity = RIG_LEVELS.ambient[lit];
  rig.sky.intensity = RIG_LEVELS.sky[lit];
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
