/**
 * A range as the shape it is: a circle on the ground.
 *
 * A range band is a distance, and the ground somebody may move over in a fight is a circle of
 * one - so it is drawn as one, rather than as the squares whose centres happen to fall inside it.
 * Up to three rings at once: the circle a fighter moves freely in, the wider one a roll would open
 * (fainter, dashed), and the reach of a jump being aimed (gold). Each sits flat just above the
 * ground at its own centre and is drawn over everything, as the arc is.
 *
 * Presentation only, and DOM-free, so it runs headless in the unit tests.
 */

import { Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';

/** One circle to draw: its centre in world units (`y` up), how big it is in tiles, and which of the three it is. */
export interface Ring {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly kind: 'move' | 'push' | 'jump';
}

const COLOURS: Readonly<Record<Ring['kind'], string>> = { move: '#69d2ff', push: '#ffc14d', jump: '#ffe08a' };
const OPACITY: Readonly<Record<Ring['kind'], number>> = { move: 0.85, push: 0.45, jump: 0.8 };
/** How far inside the radius the line reaches, in world units; it reaches a little less outside, so the edge reads as the radius. A hairline, not a band. */
const WIDTH = 0.035;
/** Enough points that a circle of Very Far still looks round. */
const SEGMENTS = 96;

export class ReachRing {
  readonly group = new Group();
  private readonly rings = new Map<Ring['kind'], { mesh: Mesh; material: MeshBasicMaterial; radius: number }>();
  /** What is drawn right now, for a test or a caller to read back. */
  showing: readonly Ring[] = [];

  constructor(private readonly tileSize: number) {
    this.group.name = 'reach-rings';
    this.group.visible = false;
    for (const kind of ['push', 'move', 'jump'] as const) {
      const material = new MeshBasicMaterial({ color: new Color(COLOURS[kind]), transparent: true, opacity: OPACITY[kind], depthTest: false, depthWrite: false });
      const mesh = new Mesh(new RingGeometry(1, 1, SEGMENTS), material);
      mesh.name = `reach:${kind}`;
      mesh.renderOrder = kind === 'jump' ? 9 : 7;
      mesh.visible = false;
      this.rings.set(kind, { mesh, material, radius: 0 });
      this.group.add(mesh);
    }
  }

  /** Draw these rings and no others. */
  show(rings: readonly Ring[]): void {
    this.showing = rings.map((ring) => ({ ...ring }));
    for (const ring of this.rings.values()) ring.mesh.visible = false;
    for (const ring of rings) {
      const drawn = this.rings.get(ring.kind)!;
      if (Math.abs(drawn.radius - ring.radius) > 1e-6) {
        drawn.mesh.geometry.dispose();
        const r = ring.radius * this.tileSize;
        drawn.mesh.geometry = new RingGeometry(Math.max(0.01, r - WIDTH), r + WIDTH * 0.4, SEGMENTS);
        drawn.mesh.geometry.rotateX(-Math.PI / 2);
        drawn.radius = ring.radius;
      }
      drawn.mesh.position.set(ring.x, ring.y + 0.04, ring.z);
      drawn.mesh.visible = true;
    }
    this.group.visible = rings.length > 0;
  }

  hide(): void {
    this.show([]);
  }

  dispose(): void {
    for (const ring of this.rings.values()) {
      ring.mesh.geometry.dispose();
      ring.material.dispose();
    }
  }
}
