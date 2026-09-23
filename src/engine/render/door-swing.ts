/**
 * Doors that swing: a prop that opens is hung on its hinge and turned about it.
 *
 * three.js turns a thing about its own origin, and a model's origin is the middle of its base -
 * which is where a door would spin like a turnstile. So a door is hung on a pivot placed at its
 * **front left edge**, the model moved inside the pivot so the edge sits on the pivot's origin,
 * and the pivot is what turns. The edge is read off the model's own box, in its own frame, so a
 * thin slab hinges at the end of the slab rather than at the corner of the tile it stands in.
 *
 * Opening swings the free end towards the front, a quarter turn; shutting swings it back. It eases
 * rather than snapping, and a door that was already open when the room was drawn again starts open,
 * so a redraw never replays the swing.
 *
 * Presentation only. Whether a door is open is the game's, kept on its state; this is told.
 */

import { Box3, Group, type Object3D } from 'three';

/** A quarter turn, free end towards the front. */
export const SWING = -Math.PI / 2;
/** How long a swing takes, in seconds. */
export const SWING_SECONDS = 0.45;

interface Swing {
  pivot: Group;
  /** The facing the door was placed with, which the swing turns away from and back to. */
  facing: number;
  /** How far open it is, 0 shut and 1 open, and how far it is going. */
  at: number;
  to: number;
}

export class DoorSwings {
  private readonly swings = new Map<string, Swing>();
  /** Which doors are open, kept so a door drawn again comes back as it was. */
  private readonly open = new Set<string>();

  /**
   * Hang a model on its hinge, and hand back what to put in the scene in its place.
   *
   * The model has already been placed where it stands - position, facing, size - and this keeps it
   * exactly there: the pivot takes the position and facing, and the model sits inside it offset by
   * however far the edge is from the model's origin.
   */
  hang(id: string, model: Object3D): Group {
    const facing = model.rotation.y;
    // The box in the model's own frame: measured with its facing taken off, so the front and the
    // left are the model's own rather than whichever way the room happens to have turned it.
    model.rotation.y = 0;
    model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model);
    const edge = box.isEmpty() ? { x: 0, z: 0 } : { x: box.min.x - model.position.x, z: box.max.z - model.position.z };

    const pivot = new Group();
    pivot.name = `hinge:${id}`;
    // Where the prop stands, which the hinge is not: what finds the tile a press landed on reads this.
    pivot.userData.stands = { x: model.position.x, z: model.position.z };
    const turned = { x: edge.x * Math.cos(facing) + edge.z * Math.sin(facing), z: -edge.x * Math.sin(facing) + edge.z * Math.cos(facing) };
    pivot.position.set(model.position.x + turned.x, model.position.y, model.position.z + turned.z);
    model.position.set(-edge.x, 0, -edge.z);
    pivot.add(model);

    const at = this.open.has(id) ? 1 : 0;
    const swing: Swing = { pivot, facing, at, to: at };
    this.swings.set(id, swing);
    pose(swing);
    return pivot;
  }

  /** Which doors are open now. The ones that changed start swinging. */
  setOpen(ids: ReadonlySet<string>): void {
    this.open.clear();
    for (const id of ids) this.open.add(id);
    for (const [id, swing] of this.swings) swing.to = this.open.has(id) ? 1 : 0;
  }

  /** Move every swing on. Linear in time and eased in the pose, so it starts and stops gently. */
  tick(dt: number): void {
    const step = dt / SWING_SECONDS;
    for (const swing of this.swings.values()) {
      if (swing.at === swing.to) continue;
      swing.at = swing.at < swing.to ? Math.min(swing.to, swing.at + step) : Math.max(swing.to, swing.at - step);
      pose(swing);
    }
  }

  /** Forget the doors drawn so far, keeping which are open. The room is about to be drawn again. */
  clear(): void {
    this.swings.clear();
  }

  /** How far a door is turned from its facing, in radians; null for a prop that is not a door. */
  angleOf(id: string): number | null {
    const swing = this.swings.get(id);
    return swing === undefined ? null : swing.pivot.rotation.y - swing.facing;
  }
}

function pose(swing: Swing): void {
  const eased = swing.at * swing.at * (3 - 2 * swing.at);
  swing.pivot.rotation.y = swing.facing + SWING * eased;
}
