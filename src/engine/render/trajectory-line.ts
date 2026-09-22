/**
 * The arc a jump is aimed along: a line through the air from where the jump is made to where
 * it lands, with a ring on the landing - and, when the landing is past the jumper's range, the
 * line they walk along the ground to where they jump from. Where no jump can be made the ring
 * wears an X.
 *
 * Gold when the jump can be made and red when it cannot, so the aim says no before the click
 * does. The curve is `arcHeight`, the same one the rule checks the ground against and the
 * token then flies, which is the point of drawing it: what is seen is what happens.
 *
 * Apart from `SceneView` because that file is at its readable limit. The view owns one of
 * these, parents it to the scene and tells it what to draw.
 */

import { BufferAttribute, BufferGeometry, Color, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { Spot, TileGrid } from '../grid/grid';
import { arcHeight } from '../rules/jump';
import { spotToWorld, type TileLayout } from './layout';
import { buildRefusalMark } from './refusal-mark';

/** An arc to draw: between two spots, this many blocks over the straight line, and whether it can be jumped. */
export interface AimedArc {
  /** The way walked along the ground before the jump, when there is one. */
  walk?: readonly Spot[];
  from: Spot;
  to: Spot;
  lift: number;
  ok: boolean;
}

/** Points along the curve. Enough that a long jump is round and a hop is not a triangle. */
const SEGMENTS = 28;
/** Points the walk before it may be drawn through. */
const WALK_CAPACITY = 256;
const CAN = new Color('#ffe08a');
const CANNOT = new Color('#e0533a');
/** Off the ground a little at both ends, so the line leaves a body's middle rather than its feet. */
const CHEST = 0.45;

export class TrajectoryLine {
  readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly material = new LineBasicMaterial({ color: CAN, transparent: true, opacity: 0.95, depthTest: false });
  private readonly ringGeometry: RingGeometry;
  private readonly ringMaterial = new MeshBasicMaterial({ color: CAN, transparent: true, opacity: 0.9, depthWrite: false });
  private readonly walkGeometry = new BufferGeometry();
  private readonly line: Line;
  private readonly walk: Line;
  private readonly ring: Mesh;
  private readonly refusal: ReturnType<typeof buildRefusalMark>;

  constructor(tileSize: number) {
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
    this.line = new Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 8;
    this.ringGeometry = new RingGeometry(tileSize * 0.3, tileSize * 0.4, 32);
    this.ringGeometry.rotateX(-Math.PI / 2);
    this.ring = new Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.renderOrder = 8;
    this.walkGeometry.setAttribute('position', new BufferAttribute(new Float32Array(WALK_CAPACITY * 3), 3));
    this.walk = new Line(this.walkGeometry, this.material);
    this.walk.frustumCulled = false;
    this.walk.renderOrder = 8;
    this.refusal = buildRefusalMark(tileSize);
    this.ring.add(this.refusal.group);
    this.group.name = 'jump-arc';
    this.group.add(this.line, this.ring, this.walk);
    this.group.visible = false;
  }

  /** Whether an arc is on the board, and whether it is one that can be jumped. */
  get showing(): 'ok' | 'blocked' | null {
    return !this.group.visible ? null : this.material.color.equals(CAN) ? 'ok' : 'blocked';
  }

  /** Draw an arc, or take it down. */
  show(grid: TileGrid, layout: TileLayout, arc: AimedArc | null): void {
    this.group.visible = arc !== null;
    if (arc === null) return;
    const a = spotToWorld(grid, arc.from, layout);
    const b = spotToWorld(grid, arc.to, layout);
    const positions = this.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      // The rule's own curve, in world units: a block is a tile high.
      const y = arcHeight(a.y, b.y, arc.lift * layout.tileSize, t) + CHEST * layout.tileSize * (1 - t);
      positions.setXYZ(i, a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
    }
    positions.needsUpdate = true;
    const colour = arc.ok ? CAN : CANNOT;
    this.material.color.copy(colour);
    this.ringMaterial.color.copy(colour);
    this.ring.position.set(b.x, b.y + 0.05, b.z);
    this.refusal.group.visible = !arc.ok;

    // The walk to where the jump is made from, laid on the ground in half-tile legs so it follows it.
    const ground = this.walkGeometry.getAttribute('position') as BufferAttribute;
    const way = arc.walk ?? [];
    let n = 0;
    for (let i = 0; i + 1 < way.length; i++) {
      const p = way[i]!;
      const q = way[i + 1]!;
      const pieces = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.5));
      for (let k = i === 0 ? 0 : 1; k <= pieces && n < WALK_CAPACITY; k++) {
        const w = spotToWorld(grid, { x: p.x + ((q.x - p.x) * k) / pieces, y: p.y + ((q.y - p.y) * k) / pieces }, layout);
        ground.setXYZ(n++, w.x, w.y + 0.05, w.z);
      }
    }
    ground.needsUpdate = true;
    this.walkGeometry.setDrawRange(0, n);
    this.walk.visible = n >= 2;
  }

  /** How many points the walk before the jump is drawn through; none when the jump is made from where they stand. */
  get walkPoints(): number {
    return this.group.visible && this.walk.visible ? this.walkGeometry.drawRange.count : 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.walkGeometry.dispose();
    this.refusal.dispose();
  }
}
