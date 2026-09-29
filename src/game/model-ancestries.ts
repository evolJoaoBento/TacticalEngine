/**
 * Which ancestry each shipped model draws, as the page knows it, and the way the editor changes it -
 * and the way it adds a model to the engine's own (`addEngineModel`).
 *
 * The choice is kept for every project at once in `projects/model-ancestries.json`, which the dev
 * server reads into the model list (`tools/model-manifest.ts`) and writes when the editor's Models page
 * sends a change (`setModelAncestry`). The page keeps its own copy, started from the list it was
 * served and moved with each change it makes, so the Models page shows what it has just set without
 * a reload; New Game, opened afterwards, is served the file as it now is.
 */

import { ANCESTRY_URL, MODEL_ADD_URL, SHIPPED_MODELS } from 'virtual:shipped-models';
import { SAVE_HEADER } from 'virtual:boot-project';

const kept = new Map<string, string>(SHIPPED_MODELS.flatMap((model) => (model.ancestry === undefined ? [] : [[model.id, model.ancestry] as [string, string]])));

/** The ancestry a model has been given, when it has been given one. */
export function assignedAncestry(modelId: string): string | undefined {
  return kept.get(modelId);
}

/** Models added to the engine since the page was served (`addEngineModel`). */
const added = new Set<string>();

/** Whether a model is one the build ships (a file in `public/models`), and so one New Game can offer. */
export function isShippedModel(modelId: string): boolean {
  return added.has(modelId) || SHIPPED_MODELS.some((model) => model.id === modelId);
}

/**
 * Add a `.glb` to the engine's own models, in `public/models`, through the dev server: every project
 * has it from then on, and it can be given an ancestry. Resolves to the model, or to why it was not
 * added - another already has its name, it is not a binary glTF, or the server does not add models.
 */
export async function addEngineModel(
  name: string,
  bytes: ArrayBuffer,
  send: (url: string, init: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }> = fetch,
): Promise<{ id: string; url: string } | { refused: string }> {
  let answer: string;
  try {
    const response = await send(`${MODEL_ADD_URL}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'model/gltf-binary', [SAVE_HEADER]: '1' },
      body: bytes,
    });
    answer = await response.text();
    if (!response.ok) return { refused: answer || 'the server would not add it' };
  } catch {
    return { refused: 'the server could not be reached' };
  }
  try {
    const model = JSON.parse(answer) as { id: string; url: string };
    added.add(model.id);
    return model;
  } catch {
    return { refused: 'the server answered with something that is not a model' };
  }
}

/**
 * Give a model an ancestry, or take it away (`null`), for every project: sent to the dev server to
 * keep. Resolves to nothing when it was kept, or to why it was not - a server that does not keep
 * them (a build, or the tests'), or one that could not be reached.
 */
export async function setModelAncestry(
  modelId: string,
  ancestryId: string | null,
  send: (url: string, init: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }> = fetch,
): Promise<string | null> {
  try {
    const response = await send(ANCESTRY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SAVE_HEADER]: '1' },
      body: JSON.stringify({ model: modelId, ancestry: ancestryId }),
    });
    if (!response.ok) return (await response.text()) || 'the server would not keep it';
  } catch {
    return 'the server could not be reached';
  }
  if (ancestryId === null) kept.delete(modelId);
  else kept.set(modelId, ancestryId);
  return null;
}
