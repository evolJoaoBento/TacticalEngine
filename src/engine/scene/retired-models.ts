/**
 * Built-in models that were retired, and what took each one's place.
 *
 * Thirteen of the props ported from the legacy prototype were replaced by imported models in
 * `public/models` and taken out of the procedural library. A project saved before that - a file,
 * an old save, a legacy map read in - still names them, and a name the library no longer has is
 * drawn as the placeholder. So a project is renamed as it opens (`game/project-open.ts`): every
 * place a model is named gets the model that replaced it, and nothing else is touched.
 */

import type { ProjectDoc } from './schema';

/** Each retired id, and the model that replaced it. */
export const RETIRED_MODELS: Readonly<Record<string, string>> = {
  pine: 'tree-prop',
  deadTree: 'withering-tree-prop',
  barrel: 'barrel-prop',
  crate: 'crate-prop',
  brazier: 'standing-torch-prop',
  cart: 'cart-prop',
  dummy: 'training-dummy-prop',
  door: 'door-prop',
  chest: 'chest-prop',
  portal: 'portal-prop',
  banner: 'banner-prop',
  rock: 'rock-prop',
  campfire: 'camp-fire-prop',
};

/** The model to draw for a name: its replacement when it was retired, else the name itself. */
export function currentModel(id: string): string {
  return Object.hasOwn(RETIRED_MODELS, id) ? RETIRED_MODELS[id]! : id;
}

/**
 * Rename every retired model a project names: props and remixes, objects, placed creatures and
 * the creature types' models, and the kinds of ground. Changes it in place; says how many it renamed.
 */
export function renameRetiredModels(project: ProjectDoc): number {
  let renamed = 0;
  const now = <T extends string | null | undefined>(id: T): T => {
    if (typeof id !== 'string' || !Object.hasOwn(RETIRED_MODELS, id)) return id;
    renamed++;
    return RETIRED_MODELS[id] as T;
  };
  for (const scene of project.scenes) {
    for (const deco of scene.decos) deco.model = now(deco.model);
    for (const object of scene.interactables) object.model = now(object.model);
    for (const encounter of scene.encounters) {
      for (const placed of encounter.adversaries) if (placed.model !== undefined) placed.model = now(placed.model);
    }
  }
  for (const preset of project.propPresets ?? []) preset.model = now(preset.model);
  for (const kind of project.terrainPalette ?? []) if (kind.model !== undefined) kind.model = now(kind.model);
  for (const [type, model] of Object.entries(project.adversaryModels)) project.adversaryModels[type] = now(model);
  return renamed;
}
