/**
 * Where the camera goes when the one being played changes place in a way the player did not steer.
 *
 * Two moments: another member is selected - from their card, Tab or a click on them - and the
 * selected one comes out of a portal somewhere else. Each slides the camera over them, keeping the
 * angle and the distance the player chose: `OrbitCamera` eases its drawn pose to the goal this
 * moves, so the slide is the camera's own. An ordinary walk does not move it; that is the held
 * click's business (`followSelected` in `main.ts`), and a click leaves the view where it was put.
 *
 * Through a portal the camera waits for the walk up to it to finish, so it does not leave them
 * half-way across the room and slide off to where they have not arrived yet.
 */

import type { Spot, TileGrid } from '../engine/grid/grid';
import type { OrbitCamera } from '../engine/render/camera';
import { spotToWorld, type TileLayout } from '../engine/render/layout';

export interface FocusView {
  /** Whether a creature's token is walking, or about to: a walk handed over counts before it starts. */
  hasWalk(id: string): boolean;
  readonly layout: TileLayout;
}

export class CameraFocus {
  /** A member who came through a portal at the end of a walk, and is looked for once it ends. */
  private afterWalk: string | null = null;

  constructor(
    private readonly camera: Pick<OrbitCamera, 'follow'>,
    private readonly view: FocusView,
    private readonly world: () => { grid: TileGrid; at: (id: string) => Spot | null },
  ) {}

  /** Slide over where this member stands. False when they stand nowhere on the board. */
  on(id: string): boolean {
    const { grid, at } = this.world();
    const spot = at(id);
    if (spot === null) return false;
    this.camera.follow(spotToWorld(grid, spot, this.view.layout), 0);
    return true;
  }

  /** They came out of a portal: over there, once the walk up to it has ended. */
  through(id: string): void {
    this.afterWalk = id;
    this.tick();
  }

  /** Each frame: the slide a portal was holding, when the walk it waited on is over. */
  tick(): void {
    if (this.afterWalk === null || this.view.hasWalk(this.afterWalk)) return;
    const id = this.afterWalk;
    this.afterWalk = null;
    this.on(id);
  }
}
