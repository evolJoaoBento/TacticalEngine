/**
 * The room growing to take in tiles laid outside it, reversibly.
 *
 * A piece stamped beyond the edge of a room used to be scenery: drawn, and never walked on,
 * because the grid a walk is searched over stopped at the edge. Now the stroke that laid it
 * ends by growing the room round it - and this is that growth, as an edit, so that one undo
 * takes back the tiles and the room they made together (`BuildingEdit.absorb` takes this on
 * as the tail of its stroke).
 *
 * It happens when the pointer comes up, not under it: growing west or north moves every
 * coordinate in the room, and a brush whose cells slid mid-drag would paint somewhere else.
 */

import { grownScene, type Growth, type SceneShape } from '../engine/scene/reshape';
import type { ProjectDoc, SceneDoc } from '../engine/scene/schema';
import type { Edit } from './session';

const SHAPE_FIELDS = ['width', 'height', 'terrain', 'heights', 'tints', 'spawns', 'decos', 'interactables', 'encounters', 'buildingTiles', 'origin'] as const;

export class GrowScene implements Edit {
  readonly label = 'Grow the room';
  private before: Partial<SceneShape> | null = null;

  constructor(
    private readonly sceneId: string,
    readonly growth: Growth,
    /** The stroke's own key, so the edit that laid the tiles can take this on. */
    readonly mergeKey: string,
  ) {}

  apply(project: ProjectDoc): void {
    const scene = sceneOf(project, this.sceneId);
    // By reference: `grownScene` writes nothing it was given, so what is kept here is what was there.
    this.before = Object.fromEntries(SHAPE_FIELDS.filter((field) => scene[field] !== undefined).map((field) => [field, scene[field]]));
    Object.assign(scene, grownScene(scene, this.growth));
  }

  undo(project: ProjectDoc): void {
    if (this.before === null) return;
    const scene = sceneOf(project, this.sceneId);
    // A field the room did not have is taken away again, so an undone growth leaves the
    // document byte for byte as it was.
    for (const field of SHAPE_FIELDS) if (!(field in this.before)) delete scene[field as 'origin'];
    Object.assign(scene, this.before);
  }
}

function sceneOf(project: ProjectDoc, id: string): SceneDoc {
  const scene = project.scenes.find((candidate) => candidate.id === id);
  if (scene === undefined) throw new Error(`Unknown scene ${id}`);
  return scene;
}
