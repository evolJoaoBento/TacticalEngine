/**
 * The scene menu's own edits: a new room's id, and a room's own light (`SceneDoc.light`, `render/room-light.ts`) - a
 * level from a tenth to all of daylight, or nothing: daylight, as a room that has never said is lit.
 */

import type { ProjectDoc } from '../engine/scene/schema';
import type { Edit } from './session';

/** A kebab-case id from a name, made unique against the scenes already there. */
export function newSceneId(project: Pick<ProjectDoc, 'scenes'>, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene';
  const taken = new Set(project.scenes.map((scene) => scene.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A room's light, as a person types it: a percentage, 10 to 100, or nothing for daylight; `null` for neither. */
export function lightFromText(text: string): number | undefined | null {
  const said = text.trim().replace(/%$/, '').trim();
  if (said === '') return undefined;
  const percent = Number(said);
  if (!Number.isFinite(percent) || percent < 10 || percent > 100) return null;
  return percent === 100 ? undefined : Math.round(percent) / 100;
}

/** A room's light set, or - `undefined` - taken back to daylight, which the room then does not say. */
export function setSceneLight(sceneId: string, light: number | undefined): Edit {
  let before: number | undefined;
  let found = false;
  return {
    label: light === undefined ? 'Daylight in the room' : 'Dim the room',
    apply(project) {
      const scene = project.scenes.find((s) => s.id === sceneId);
      found = scene !== undefined;
      if (scene === undefined) return;
      before = scene.light;
      if (light === undefined) delete scene.light;
      else scene.light = light;
    },
    undo(project) {
      const scene = project.scenes.find((s) => s.id === sceneId);
      if (scene === undefined) return;
      if (before === undefined) delete scene.light;
      else scene.light = before;
    },
    isNoop() {
      return !found || before === light;
    },
  };
}
