/**
 * The white rim round the thing under the pointer.
 *
 * A door at the back of a room is half behind a wall, and a player needs to know
 * what they are about to reach for — so what is pointed at is rimmed in white,
 * and the rim is drawn through whatever stands in front of it. It reads as the
 * whole shape of the thing, not the part of it that happens to be in view.
 *
 * Only the rim ignores the depth of the room, never the pointing: a press finds
 * what it finds by looking, so an object entirely behind a wall is not lit by
 * waving at the wall. The caller does that test; this only draws.
 *
 * The rim is `faction-outline`'s silhouette in white: the thing masked into the
 * stencil buffer and the line drawn only outside it, so it cannot leak across a
 * shape however it folds. One pair per thing, round the whole of it rather than
 * round each part, and kept: pointing at the same thing twice does not build it
 * twice. They are hidden rather than removed when the pointer leaves.
 */

import { type Mesh, type Object3D } from 'three';
import { outline } from './faction-outline';

export class Spotlight {
  /** What is lit now, and the rims hung on it. */
  private on: Object3D | null = null;
  private readonly rims = new WeakMap<Object3D, Mesh[]>();

  /** What the pointer is on, or null. Lighting what is already lit changes nothing. */
  show(target: Object3D | null): void {
    if (target === this.on) return;
    this.hide();
    if (target === null) return;
    this.on = target;
    for (const rim of this.rimsFor(target)) rim.visible = true;
  }

  /** Nothing is pointed at. */
  hide(): void {
    if (this.on === null) return;
    for (const rim of this.rims.get(this.on) ?? []) rim.visible = false;
    this.on = null;
  }

  /** What is lit, for a caller that wants to know. */
  get lit(): Object3D | null {
    return this.on;
  }

  /**
   * The rim for one thing, built the first time it is pointed at.
   *
   * Round the whole of it rather than round each part: merged once, so no interior seam is
   * drawn. Hung on the target, so it moves, turns and hides with it, and goes when it goes.
   * The hull is the pose it was built in, which is what a door, a chest or a pillar needs;
   * something that animates would want its rim rebuilt.
   */
  private rimsFor(target: Object3D): Mesh[] {
    const kept = this.rims.get(target);
    if (kept !== undefined) return kept;
    // The same silhouette a creature wears, in white, and seen through whatever stands in
    // front of it. One mesh pair, not two: the ghost that used to draw the shape through a
    // wall is gone, because the silhouette itself does that now - the stencil keeps it off
    // the thing's own face, so there is nothing to wash pale.
    //
    // Built hidden. An object is rimmed only while it is pointed at, and the pair sits on
    // layer 0, so `show` drives it rather than the camera's layer mask.
    const made = outline(target, `spot:${target.name}`, '#ffffff', false, true);
    this.rims.set(target, made);
    return made;
  }

}
