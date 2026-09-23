/**
 * What opening a project does to it, whichever file it came from.
 *
 * Three things a project saved some time ago is behind on. It may name a built-in model that was
 * retired (`engine/scene/retired-models.ts`). Its objects were not yet props with a
 * function (format 6 moves the ones in a document it migrates; this catches a project built in
 * memory, as the demo is). And its list of models is the one it was saved with: dropping a `.glb`
 * into `public/models` is how a model gets into the game (`tools/model-manifest.ts`), but only the
 * demo built from code was ever handed the folder, so a project opened from a file - the default
 * project included - never saw a model added after it was saved.
 *
 * A model is added by id and only when the project has none of that id, so one the author re-seated
 * or re-scaled keeps their settings, and a project that already has everything is left untouched.
 */

import { SHIPPED_MODELS } from 'virtual:shipped-models';
import { modelAssetSchema } from '../engine/render/assets';
import type { ProjectDoc } from '../engine/scene/schema';
import { renameRetiredModels } from '../engine/scene/retired-models';
import { objectsToProps } from './prop-use';

export { SHIPPED_MODELS };

/** Add the shipped models the project does not list yet; say which. */
export function withShippedModels(project: ProjectDoc, shipped: readonly { id: string; url: string; scale: number }[] = SHIPPED_MODELS): string[] {
  const listed = new Set(project.assets.map((asset) => asset.id));
  const added: string[] = [];
  for (const model of shipped) {
    if (listed.has(model.id)) continue;
    project.assets.push(modelAssetSchema.parse(model));
    listed.add(model.id);
    added.push(model.id);
  }
  return added;
}

/** Bring a project up to date as it is opened. Changes it in place. */
export function openProject(project: ProjectDoc): void {
  renameRetiredModels(project);
  for (const scene of project.scenes) objectsToProps(scene);
  withShippedModels(project);
}
