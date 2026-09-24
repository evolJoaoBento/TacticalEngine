/**
 * The ground answering a click: where a walk was ordered, a ripple; where it was refused, a shake.
 *
 * A walk ordered out of a fight takes a moment to read on the board - the token turns, the path
 * clears, and the walk starts - so the spot clicked answers at once. Two rings spread from it and
 * fade, the second a beat behind the first, and a dot at the middle pops and goes: the tap of a
 * finger on water. A click that walks nowhere gets a small red ring that shakes, as a head does,
 * and is gone sooner. In the selected creature's blue, so it reads as theirs.
 *
 * Presentation only, and plain three objects moved by a clock, so it is tested headless. The
 * geometry is shared; each ripple has its own materials, since each fades on its own time, and
 * they are let go when it ends.
 */

import { Color, Group, Mesh, MeshBasicMaterial, RingGeometry, CircleGeometry, type Object3D } from 'three';
import { SELECTED_COLOR } from './faction-outline';

/** How long a ripple lasts, and a refusal. */
export const RIPPLE_SECONDS = 0.7;
export const REFUSAL_SECONDS = 0.45;

/** How far the rings spread, in tiles across; the second trails the first by this much of the time. */
const REACH = 0.9;
const TRAIL = 0.18;
const REFUSED = '#e0533f';

/** How many can be on the ground at once: a player clicking fast leaves a short trail, not a pile. */
const MOST = 6;

type Kind = 'go' | 'no';

interface Ripple {
  kind: Kind;
  group: Group;
  rings: Mesh[];
  dot: Mesh;
  materials: MeshBasicMaterial[];
  elapsed: number;
  at: { x: number; z: number };
}

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

export class ClickRipples {
  readonly group = new Group();
  private readonly live: Ripple[] = [];
  private readonly ring: RingGeometry;
  private readonly disc: CircleGeometry;

  /** `tileSize` is asked each time, so a view that changes its layout has ripples its own size. */
  constructor(private readonly tileSize: () => number) {
    this.group.name = 'click-ripples';
    // A thin band at unit radius, laid flat: scaled, it is any ring from a dot to a tile across.
    this.ring = new RingGeometry(0.86, 1, 40);
    this.ring.rotateX(-Math.PI / 2);
    this.disc = new CircleGeometry(1, 20);
    this.disc.rotateX(-Math.PI / 2);
  }

  /** A click landed on the ground here: `go` when it sent somebody walking, `no` when it did not. */
  add(at: { x: number; y: number; z: number }, kind: Kind): void {
    while (this.live.length >= MOST) this.finish(this.live.shift()!);
    const colour = new Color(kind === 'go' ? SELECTED_COLOR : REFUSED);
    const material = (): MeshBasicMaterial => new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthWrite: false });
    const materials = kind === 'go' ? [material(), material(), material()] : [material(), material()];
    const group = new Group();
    group.position.set(at.x, at.y + 0.02, at.z);
    const rings = (kind === 'go' ? [materials[0]!, materials[1]!] : [materials[0]!]).map((m) => {
      const mesh = new Mesh(this.ring, m);
      mesh.renderOrder = 8;
      group.add(mesh);
      return mesh;
    });
    const dot = new Mesh(this.disc, materials[materials.length - 1]!);
    dot.renderOrder = 8;
    group.add(dot);
    this.group.add(group);
    const ripple: Ripple = { kind, group, rings, dot, materials, elapsed: 0, at: { x: at.x, z: at.z } };
    this.live.push(ripple);
    this.pose(ripple);
  }

  /** How many are showing. */
  get count(): number {
    return this.live.length;
  }

  /**
   * Move every ripple on by `dt` seconds, and let go of the ones that are over. A tenth of a second
   * at most a frame: a hitch longer than a ripple's whole life would otherwise make and end one
   * between two frames, and the click would go unanswered just when the game was slowest to answer.
   */
  tick(dt: number): void {
    const step = Math.min(dt, 0.1);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const ripple = this.live[i]!;
      ripple.elapsed += step;
      if (ripple.elapsed >= (ripple.kind === 'go' ? RIPPLE_SECONDS : REFUSAL_SECONDS)) {
        this.live.splice(i, 1);
        this.finish(ripple);
      } else this.pose(ripple);
    }
  }

  /** Every ripple gone at once: a room changed under them. */
  clear(): void {
    for (const ripple of this.live.splice(0)) this.finish(ripple);
  }

  dispose(): void {
    this.clear();
    this.ring.dispose();
    this.disc.dispose();
  }

  private pose(ripple: Ripple): void {
    const size = this.tileSize() / 2;
    if (ripple.kind === 'go') {
      const t = ripple.elapsed / RIPPLE_SECONDS;
      ripple.rings.forEach((ring, n) => {
        // Each ring its own life inside the whole: the second starts a beat late and ends with it.
        const own = clamp01((t - n * TRAIL) / (1 - n * TRAIL));
        const radius = size * REACH * (0.15 + 0.85 * easeOut(own)) * (n === 0 ? 1 : 0.7);
        ring.scale.set(radius, 1, radius);
        (ring.material as MeshBasicMaterial).opacity = own <= 0 ? 0 : 0.85 * (1 - own) ** 1.5;
      });
      // The dot: pops up fast, and is gone by the time the rings are halfway.
      const pop = clamp01(t / 0.45);
      const dot = size * 0.16 * Math.sin(Math.PI * pop);
      ripple.dot.scale.set(Math.max(dot, 1e-4), 1, Math.max(dot, 1e-4));
      (ripple.dot.material as MeshBasicMaterial).opacity = 0.9 * (1 - pop);
    } else {
      const t = ripple.elapsed / REFUSAL_SECONDS;
      const radius = size * 0.35 * (0.8 + 0.2 * easeOut(clamp01(t * 3)));
      ripple.rings[0]!.scale.set(radius, 1, radius);
      (ripple.rings[0]!.material as MeshBasicMaterial).opacity = 0.9 * (1 - t) ** 1.2;
      ripple.dot.scale.set(size * 0.08, 1, size * 0.08);
      (ripple.dot.material as MeshBasicMaterial).opacity = 0.8 * (1 - t);
      // A shake of the head: side to side, quick and dying away.
      ripple.group.position.x = ripple.at.x + size * 0.12 * Math.sin(t * Math.PI * 6) * (1 - t);
    }
  }

  private finish(ripple: Ripple): void {
    this.group.remove(ripple.group);
    for (const material of ripple.materials) material.dispose();
  }
}

/** Every mesh a ripple group holds, for a test to read. */
export function ripplesIn(group: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  group.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });
  return meshes;
}
