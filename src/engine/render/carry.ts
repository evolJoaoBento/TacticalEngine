/**
 * How the editor's hand moves what it carries: lifted off the ground, hung under the pointer so its
 * bottom swings behind the way it is going, and dropped with a squash when the pointer lets go.
 *
 * Presentation only. The document moves once, on release, in the editor's controller; this poses a
 * `three` object and nothing else, so it runs headless in the unit tests the way the camera does.
 *
 * The thing hangs from its top. Leaning it about its feet would swing the top and keep the bottom
 * planted, the opposite of something held; so each frame the lean is applied first and the object
 * is then moved so its top is back at the grip.
 */

import { Box3, Vector3, type Object3D } from 'three';

/** How high a picked-up thing rides above the ground under the pointer, in world units. */
export const LIFT = 0.55;
/** The most it ever leans, in radians. */
export const MAX_LEAN = 0.5;
/** How long the pick-up takes. */
const LIFT_TIME = 0.18;
/** How fast the grip catches the pointer: a critically damped spring's rate, per second. Slow enough to trail. */
const FOLLOW = 9;
/** Radians of lean per unit of speed. */
const SWING = 0.11;
/** The pendulum the lean rides on: stiff enough to keep up, loose enough to swing past when the hand stops. */
const LEAN_STIFFNESS = 70;
const LEAN_DAMPING = 5;
/** A slow float while it is held still. */
const BOB = 0.035;
/** The fall back to the ground, then the squash that settles it. */
const FALL_TIME = 0.13;
const SETTLE_TIME = 0.32;
const SQUASH = 0.22;

/**
 * One step of a critically damped spring toward a goal: the new value and its speed. The exact
 * solution over `dt`, not an Euler step, so a slow frame never overshoots.
 */
export function follow(value: number, speed: number, goal: number, rate: number, dt: number): [number, number] {
  const delta = value - goal;
  const push = (speed + rate * delta) * dt;
  const decay = Math.exp(-rate * dt);
  return [goal + (delta + push) * decay, (speed - rate * push) * decay];
}

/** The lean a speed asks for, about one axis: behind the motion, never more than `MAX_LEAN`. */
export function leanFor(speed: number): number {
  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, speed * SWING));
}

/** How far a landing is squashed, `q` from 0 at the touch to 1 at rest: one bounce, then still. */
export function squashAt(q: number): number {
  if (q >= 1) return 0;
  return SQUASH * Math.exp(-4 * q) * Math.cos(3 * Math.PI * q);
}

/** Up past the mark and back: the pop of a thing snatched off the ground. */
function overshoot(p: number): number {
  const s = 1.7;
  const t = p - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
}

type Phase = 'lift' | 'hover' | 'fall' | 'settle';

export class CarryMotion {
  private held: Object3D | null = null;
  private phase: Phase = 'lift';
  private elapsed = 0;
  /** Where the held thing stands when it is put down, and which way it faces. */
  private readonly rest = new Vector3();
  /**
   * The size the held thing already was.
   *
   * The lift stretches what it carries and the drop squashes it, and both used to write a scale
   * outright, which assumed everything on the board was drawn at its natural size. A prop placed
   * across a block of tiles is not: picking up a four-tile boulder shrank it to one tile the
   * instant it left the ground, and putting it down left it there. The stretch is a factor of
   * whatever it was, not a size of its own.
   */
  private readonly base = new Vector3(1, 1, 1);
  private turn = 0;
  /** How far above its feet it is held from: its top. */
  private reach = 0.5;
  /** The ground under the pointer, followed by a spring, and the top of the thing: the grip. */
  private readonly ground = new Vector3();
  private readonly groundSpeed = new Vector3();
  private readonly goal = new Vector3();
  private readonly grip = new Vector3();
  private readonly fallFrom = new Vector3();
  private lean = { x: 0, z: 0, vx: 0, vz: 0 };
  private fallLean = { x: 0, z: 0 };
  private readonly offset = new Vector3();

  /** What is being carried or landing, if anything. */
  get holding(): Object3D | null {
    return this.held;
  }

  /** Whether the pointer still has hold of it, rather than it being on its way down. */
  get carrying(): boolean {
    return this.held !== null && (this.phase === 'lift' || this.phase === 'hover');
  }

  /** Take hold of a thing standing where it stands. One landing still under way is put down first. */
  lift(object: Object3D): void {
    this.settle();
    this.held = object;
    this.rest.copy(object.position);
    this.base.copy(object.scale);
    this.turn = object.rotation.y;
    const bounds = new Box3().setFromObject(object);
    this.reach = bounds.isEmpty() ? 0.5 : Math.max(0.3, bounds.max.y - object.position.y);
    this.ground.copy(this.rest);
    this.groundSpeed.set(0, 0, 0);
    this.goal.copy(this.rest);
    this.grip.set(this.rest.x, this.rest.y + this.reach, this.rest.z);
    this.lean = { x: 0, z: 0, vx: 0, vz: 0 };
    // Lean about the world's axes whichever way the thing faces: turn first, then lean.
    object.rotation.order = 'ZXY';
    this.phase = 'lift';
    this.elapsed = 0;
  }

  /**
   * Turn what is held, in radians about Y.
   *
   * It turns in the hand and is put down facing that way: the lean rides on top of
   * the turn (the rotation order is set on lift), so a thing being swung about still
   * trails from its feet while it turns.
   */
  turnTo(radians: number): void {
    this.turn = radians;
  }

  /** Which way what is held will be facing when it lands. */
  get facing(): number {
    return this.turn;
  }

  /** Where the pointer meets the ground: the thing follows, riding `LIFT` above it. */
  moveTo(x: number, y: number, z: number): void {
    if (this.carrying) this.goal.set(x, y, z);
  }

  /**
   * Let go. `landed` is what now stands where the document has the thing: the one carried when it
   * did not move, or a fresh copy the view drew at its new place. It falls there from where it hung.
   */
  drop(landed: Object3D | null): void {
    if (!this.carrying) return;
    const held = this.held!;
    const target = landed ?? held;
    if (target !== held) {
      this.settleInPlace(held);
      this.rest.copy(target.position);
      this.turn = target.rotation.y;
      target.rotation.order = 'ZXY';
    }
    this.held = target;
    this.fallFrom.copy(this.grip);
    this.fallLean = { x: this.lean.x, z: this.lean.z };
    this.phase = 'fall';
    this.elapsed = 0;
    this.pose(1);
  }

  /** Advance the lift, the hang or the landing. `dt` in seconds. */
  tick(dt: number): void {
    const held = this.held;
    if (held === null) return;
    // Drawn away underneath - the room was rebuilt mid-carry - so there is nothing left to move.
    if (held.parent === null) {
      this.held = null;
      return;
    }
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.elapsed += step;
    if (this.phase === 'lift' || this.phase === 'hover') this.hang(step);
    else if (this.phase === 'fall') this.fall();
    else this.land();
  }

  private hang(dt: number): void {
    const axes = ['x', 'y', 'z'] as const;
    for (const axis of axes) {
      [this.ground[axis], this.groundSpeed[axis]] = follow(this.ground[axis], this.groundSpeed[axis], this.goal[axis], FOLLOW, dt);
    }
    const p = Math.min(1, this.elapsed / LIFT_TIME);
    if (this.phase === 'lift' && p >= 1) this.phase = 'hover';
    const bob = this.phase === 'hover' ? BOB * Math.sin((this.elapsed - LIFT_TIME) * 3) : 0;
    this.grip.set(this.ground.x, this.ground.y + this.reach + LIFT * overshoot(p) + bob, this.ground.z);
    // The bottom trails the motion: a lean about X follows speed along Z, about Z against speed along X.
    const wantX = leanFor(this.groundSpeed.z);
    const wantZ = -leanFor(this.groundSpeed.x);
    this.lean.vx += (LEAN_STIFFNESS * (wantX - this.lean.x) - LEAN_DAMPING * this.lean.vx) * dt;
    this.lean.vz += (LEAN_STIFFNESS * (wantZ - this.lean.z) - LEAN_DAMPING * this.lean.vz) * dt;
    this.lean.x = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, this.lean.x + this.lean.vx * dt));
    this.lean.z = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, this.lean.z + this.lean.vz * dt));
    // A stretch on the way up, as if snatched.
    this.pose(this.phase === 'lift' ? 1 + 0.12 * Math.sin(Math.PI * p) : 1);
  }

  private fall(): void {
    const p = Math.min(1, this.elapsed / FALL_TIME);
    const across = 1 - (1 - p) * (1 - p);
    const down = p * p;
    this.grip.set(
      this.fallFrom.x + (this.rest.x - this.fallFrom.x) * across,
      this.fallFrom.y + (this.rest.y + this.reach - this.fallFrom.y) * down,
      this.fallFrom.z + (this.rest.z - this.fallFrom.z) * across,
    );
    this.lean.x = this.fallLean.x * (1 - p);
    this.lean.z = this.fallLean.z * (1 - p);
    this.pose(1 + 0.06 * p);
    if (p >= 1) {
      this.phase = 'settle';
      this.elapsed = 0;
    }
  }

  private land(): void {
    const q = this.elapsed / SETTLE_TIME;
    if (q >= 1) {
      this.settle();
      return;
    }
    this.grip.set(this.rest.x, this.rest.y + this.reach, this.rest.z);
    this.lean.x = 0;
    this.lean.z = 0;
    this.pose(1 - squashAt(q));
  }

  /** Stand whatever is held exactly at rest, and let go of it. */
  private settle(): void {
    if (this.held !== null) this.settleInPlace(this.held);
    this.held = null;
  }

  private settleInPlace(object: Object3D): void {
    object.rotation.set(0, this.turn, 0);
    object.rotation.order = 'XYZ';
    object.position.copy(this.rest);
    object.scale.copy(this.base);
  }

  /** Lean the held thing, stretch it by `stretch` about its feet, and hang its top from the grip. */
  private pose(stretch: number): void {
    const held = this.held!;
    held.rotation.set(this.lean.x, this.turn, this.lean.z);
    const wide = 1 / Math.sqrt(stretch);
    held.scale.set(this.base.x * wide, this.base.y * stretch, this.base.z * wide);
    this.offset.set(0, this.reach * stretch, 0).applyEuler(held.rotation);
    held.position.copy(this.grip).sub(this.offset);
  }
}
