/**
 * A room's own light (`SceneDoc.light`, drawn by `scene-view.ts`): the rig's sky, sun and ambient (`light-rig.ts`) turned
 * down to it, and - in a room dimmer than daylight - what burns in it lit: its fires, braziers and torches, each a warm
 * light of its own that flickers. A room that says nothing is lit as every room always was.
 *
 * The lamps are a fixed number, made the first time a dim room needs them and kept after - lit or dark - since a scene's
 * shaders are made for the lights it has, and a room with a different number would make every material again.
 * Presentation only: the rules never read a room's light.
 */

import { PointLight, type Object3D, type Scene } from 'three';
import { ENVIRONMENT_INTENSITY, RIG_LEVELS, SUN_INTENSITY, type LightRig } from './light-rig';

/** What burns, and how it lights: its colour, how bright, how far it reaches in tiles, and how high its flame is. */
export const BURNING: Readonly<Record<string, { color: string; intensity: number; reach: number; flame: number }>> = {
  'camp-fire-prop': { color: '#ff8f3f', intensity: 9, reach: 8, flame: 0.6 },
  'standing-torch-prop': { color: '#ffaa5c', intensity: 5, reach: 6, flame: 1.7 },
  'wall-torch-prop': { color: '#ffaa5c', intensity: 5, reach: 6, flame: 1.4 },
};

/** How many lamps a room lights at most. */
export const LAMPS = 8;

/** How far a flame's light wavers, as a share of its brightness, and how fast. */
const FLICKER = 0.12;
const FLICKER_RATE = 7;

export class RoomLight {
  private readonly lamps: PointLight[] = [];
  /** Each lit lamp's own brightness and its own phase, so no two flicker together. */
  private readonly burns: { intensity: number; phase: number }[] = [];
  private level = 1;
  private time = 0;

  constructor(
    private readonly parent: Object3D,
    private readonly scene: Scene,
    private readonly rig: () => LightRig | null,
  ) {}

  /**
   * The room's light: the rig at its level (absent, daylight), and in a dim room the first `LAMPS` of what burns in it -
   * by its model (`BURNING`) - lit where it stands, its flame above.
   */
  light(level: number | undefined, decos: readonly { model: string; at: Object3D }[]): void {
    this.level = level === undefined ? 1 : Math.min(1, Math.max(0, level));
    const burning = this.level < 1 ? decos.filter((deco) => BURNING[deco.model] !== undefined).slice(0, LAMPS) : [];
    if (burning.length > 0 && this.lamps.length === 0) {
      for (let n = 0; n < LAMPS; n++) {
        const lamp = new PointLight('#ffffff', 0, 1, 2);
        this.parent.add(lamp);
        this.lamps.push(lamp);
      }
    }
    this.burns.length = 0;
    this.lamps.forEach((lamp, n) => {
      const what = burning[n];
      const burn = what === undefined ? undefined : BURNING[what.model]!;
      // Dark lamps stay in the room, unlit: the shaders were made for this many.
      if (what === undefined || burn === undefined) {
        lamp.intensity = 0;
        this.burns.push({ intensity: 0, phase: 0 });
        return;
      }
      lamp.color.set(burn.color);
      lamp.distance = burn.reach;
      lamp.position.set(what.at.position.x, what.at.position.y + burn.flame, what.at.position.z);
      // The darker the room, the more its fires are what you see by.
      const intensity = burn.intensity * (1.4 - this.level);
      lamp.intensity = intensity;
      this.burns.push({ intensity, phase: n * 1.7 });
    });
    this.dim();
  }

  /** The rig at the room's level - again after `setEnvironment`, which puts it back to daylight's. */
  dim(): void {
    const rig = this.rig();
    if (rig === null) return;
    const reflected = this.scene.environment === null ? 0 : 1;
    rig.ambient.intensity = RIG_LEVELS.ambient[reflected] * this.level;
    rig.sky.intensity = RIG_LEVELS.sky[reflected] * this.level;
    rig.sun.intensity = SUN_INTENSITY * this.level;
    this.scene.environmentIntensity = ENVIRONMENT_INTENSITY * this.level;
  }

  /** The flames waver, each its own way. */
  tick(dt: number): void {
    if (this.burns.length === 0) return;
    this.time += dt;
    this.lamps.forEach((lamp, n) => {
      const burn = this.burns[n];
      if (burn === undefined) return;
      const t = this.time * FLICKER_RATE + burn.phase;
      lamp.intensity = burn.intensity * (1 + FLICKER * (Math.sin(t) * 0.6 + Math.sin(t * 2.3 + 1) * 0.4));
    });
  }

  /** How many lamps are lit, for a test. */
  lit(): number {
    return this.burns.filter((burn) => burn.intensity > 0).length;
  }
}
