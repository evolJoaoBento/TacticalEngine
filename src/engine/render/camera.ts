/**
 * An orbit camera as plain numbers.
 *
 * The prototype leaned on three's `OrbitControls`, which owns the DOM events,
 * the damping and the clamps in one object nothing else can read. This keeps
 * the *model* — where the camera is looking from and at — as data that a test
 * can drive in node and a save could carry, and leaves the DOM to `main.ts`.
 *
 * The frame is BG3's: yaw around a target on the ground, a pitch that never
 * goes flat enough to lose the board or steep enough to lose the depth, a
 * distance between "close enough to read a face" and "the whole room". Pan
 * moves the target across the ground plane relative to the current yaw, so
 * "left" is always screen-left.
 */

export interface CameraLimits {
  minPitch: number;
  maxPitch: number;
  /** The flattest the camera may sit when it is all the way out: the far view is looked down on. */
  farPitch: number;
  minDistance: number;
  maxDistance: number;
}

export const DEFAULT_LIMITS: CameraLimits = {
  /** Radians above the ground plane. */
  minPitch: 0.35,
  maxPitch: 1.45,
  farPitch: 1.3,
  minDistance: 6,
  maxDistance: 80,
};

export interface CameraPose {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
}

export interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The flattest angle allowed from a given distance.
 *
 * Close up the camera is the player's to swing where they like — that is where
 * the room is looked at from, and a low angle is what makes it a place. Pulling
 * back is asking a different question, "where is everything", and the camera is
 * levered towards looking down on it so the far view reads as a map rather than
 * a horizon. Measured on the logarithm of the distance, because zoom multiplies:
 * a notch of the wheel moves the floor by about as much wherever it is.
 */
export function pitchFloor(distance: number, limits: CameraLimits = DEFAULT_LIMITS): number {
  const held = clamp(distance, limits.minDistance, limits.maxDistance);
  const out = Math.log(held / limits.minDistance) / Math.log(limits.maxDistance / limits.minDistance);
  return limits.minPitch + (limits.farPitch - limits.minPitch) * out;
}

export class OrbitCamera {
  /** Where the camera is heading. Inputs write this. */
  readonly goal: CameraPose;
  /** Where the camera is drawn from this frame. `update()` eases it toward `goal`. */
  readonly pose: CameraPose;
  readonly limits: CameraLimits;
  /** Fraction of the remaining distance closed per second of `update`. */
  damping = 10;
  /**
   * The angle the player last asked for, which is not always the angle they get:
   * pulled back the camera is held above it, and it is handed back on the way in.
   */
  private wanted: number;

  constructor(pose: Partial<CameraPose> = {}, limits: CameraLimits = DEFAULT_LIMITS) {
    this.limits = limits;
    this.wanted = clamp(pose.pitch ?? 0.9, limits.minPitch, limits.maxPitch);
    const distance = clamp(pose.distance ?? 20, limits.minDistance, limits.maxDistance);
    this.goal = {
      target: { x: 0, y: 0, z: 0, ...pose.target },
      yaw: pose.yaw ?? 0,
      pitch: clamp(this.wanted, pitchFloor(distance, limits), limits.maxPitch),
      distance,
    };
    this.pose = { ...this.goal, target: { ...this.goal.target } };
  }

  /**
   * Turn around the target. `dx` and `dy` are radians.
   *
   * The drag is remembered whether or not it can be shown: asking for a flatter
   * angle than this distance allows is not refused, it is kept, and zooming in
   * arrives at it.
   */
  orbit(dx: number, dy: number): void {
    this.goal.yaw += dx;
    this.wanted = clamp(this.wanted + dy, this.limits.minPitch, this.limits.maxPitch);
    this.seat();
  }

  /** Hold the angle above the floor for however far out the camera is now. */
  private seat(): void {
    this.goal.pitch = clamp(this.wanted, pitchFloor(this.goal.distance, this.limits), this.limits.maxPitch);
  }

  /**
   * Slide the target across the ground, in screen terms: `right` and `forward`
   * are world units along the camera's own right and forward-on-the-ground.
   */
  pan(right: number, forward: number): void {
    const sin = Math.sin(this.goal.yaw);
    const cos = Math.cos(this.goal.yaw);
    // The camera sits at +sin/+cos of the yaw from the target, so "forward" on
    // the ground is toward -sin/-cos.
    this.goal.target.x += right * cos - forward * sin;
    this.goal.target.z += -right * sin - forward * cos;
  }

  /** Move in or out. `factor > 1` moves away. */
  zoom(factor: number): void {
    this.goal.distance = clamp(this.goal.distance * factor, this.limits.minDistance, this.limits.maxDistance);
    this.seat();
  }

  /** Look at a point from the current angle, at a distance that fits `radius`. */
  frame(target: { x: number; y: number; z: number }, radius: number): void {
    this.goal.target = { ...target };
    // 1.8 × the radius reads the whole board at the default pitch without the
    // corners leaving the frame.
    this.goal.distance = clamp(radius * 1.8, this.limits.minDistance, this.limits.maxDistance);
    this.seat();
  }

  /** Look at a point without changing distance or angle. */
  lookAt(target: { x: number; y: number; z: number }): void {
    this.goal.target = { ...target };
  }

  /**
   * Keep a point within `slack` of the target, along the ground, moving the
   * target as little as that takes and not at all when the point is already
   * close: a walking token stays in frame without the camera chasing every
   * step. Angle and distance are untouched. Returns whether it moved.
   */
  follow(point: { x: number; z: number }, slack: number): boolean {
    const dx = point.x - this.goal.target.x;
    const dz = point.z - this.goal.target.z;
    const away = Math.hypot(dx, dz);
    if (away <= slack || away < 1e-9) return false;
    const pull = (away - slack) / away;
    this.goal.target.x += dx * pull;
    this.goal.target.z += dz * pull;
    return true;
  }

  /** Jump the drawn pose to the goal, skipping the easing. */
  snap(): void {
    Object.assign(this.pose, this.goal, { target: { ...this.goal.target } });
  }

  /** Ease the drawn pose toward the goal. `dt` in seconds. Returns whether it moved. */
  update(dt: number): boolean {
    const t = 1 - Math.exp(-this.damping * Math.max(0, dt));
    const before = JSON.stringify(this.pose);
    this.pose.yaw += (this.goal.yaw - this.pose.yaw) * t;
    this.pose.pitch += (this.goal.pitch - this.pose.pitch) * t;
    this.pose.distance += (this.goal.distance - this.pose.distance) * t;
    this.pose.target.x += (this.goal.target.x - this.pose.target.x) * t;
    this.pose.target.y += (this.goal.target.y - this.pose.target.y) * t;
    this.pose.target.z += (this.goal.target.z - this.pose.target.z) * t;
    // Settle exactly, so a still camera stops asking for frames.
    if (Math.abs(this.goal.yaw - this.pose.yaw) < 1e-4) this.pose.yaw = this.goal.yaw;
    if (Math.abs(this.goal.pitch - this.pose.pitch) < 1e-4) this.pose.pitch = this.goal.pitch;
    if (Math.abs(this.goal.distance - this.pose.distance) < 1e-3) this.pose.distance = this.goal.distance;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(this.goal.target[axis] - this.pose.target[axis]) < 1e-3) {
        this.pose.target[axis] = this.goal.target[axis];
      }
    }
    return JSON.stringify(this.pose) !== before;
  }

  /** Where the camera is, for the drawn pose. */
  position(): CameraPosition {
    return positionOf(this.pose);
  }
}

/** The eye point a pose describes. */
export function positionOf(pose: CameraPose): CameraPosition {
  const flat = Math.cos(pose.pitch) * pose.distance;
  return {
    x: pose.target.x + Math.sin(pose.yaw) * flat,
    y: pose.target.y + Math.sin(pose.pitch) * pose.distance,
    z: pose.target.z + Math.cos(pose.yaw) * flat,
  };
}
