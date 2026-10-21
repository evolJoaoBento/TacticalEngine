/**
 * **Your models**, as the page talks to them (`tools/your-models.ts`): the `.glb` files in the signed-in
 * player's own folder - got from the Store, or brought in by a project they opened - which the editor
 * lays under every project they open (`EditorShell`, the Models page's *Your models*), as the engine's
 * own are laid under every project (`project-open.ts`).
 *
 * **A project's models come in on the fly** (`importCarriedModels`): opening one - to play or to edit -
 * puts every model it carries into the player's folder, a file embedded in it or one in another
 * player's folder, so it is theirs for the next project too. A model is known by its bytes, so an
 * embedded one already in the folder is not sent again, and the project itself is not changed.
 *
 * Nobody signed in, or a server with no accounts, has no models of theirs: every call here answers
 * nothing rather than failing.
 */

import { modelAssetSchema, type ModelAsset } from '../engine/render/assets';

/** One of the player's models, as the server lists it. */
export interface YourModel {
  id: string;
  file: string;
  url: string;
  hash: string;
  listing?: string;
  added: number;
}

type Send = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const HEADER = 'x-tactical-save';

/** Which player's folder a model url is in, or nothing: `/__models/u/<account>/imported/<file>`. */
export function ownerOfModelUrl(url: string): string | null {
  return /^\/__models\/u\/([a-z0-9_-]{3,24})\/imported\/[a-z0-9-]+\.glb$/.exec(url)?.[1] ?? null;
}

/** The player's models; or why there are none to show. */
export async function listYourModels(send: Send = fetch): Promise<YourModel[] | { refused: string }> {
  try {
    const response = await send('/__models/mine', { credentials: 'same-origin' });
    if (!response.ok) return { refused: response.status === 404 ? 'this server keeps no models of yours' : 'sign in first' };
    return (await response.json()) as YourModel[];
  } catch {
    return { refused: 'the server could not be reached' };
  }
}

/** Put a model into the player's folder: a file (`name`, `data`) or one in another player's (`url`). */
export async function importModel(body: { name: string; data: string } | { url: string }, send: Send = fetch): Promise<YourModel | { refused: string }> {
  try {
    const response = await send('/__models/import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', [HEADER]: '1' },
      body: JSON.stringify(body),
    });
    const value = (await response.json()) as { model?: YourModel; reason?: string };
    return response.ok && value.model !== undefined ? value.model : { refused: value.reason ?? 'the model was not imported' };
  } catch {
    return { refused: 'the server could not be reached' };
  }
}

/** The player's models a project does not have yet, as the declarations laid under it: an id it already uses stays its own. */
export function yourModelsMissingFrom(assets: readonly Pick<ModelAsset, 'id'>[], mine: readonly YourModel[]): ModelAsset[] {
  const taken = new Set(assets.map((asset) => asset.id));
  return mine.filter((model) => !taken.has(model.id)).map((model) => modelAssetSchema.parse({ id: model.id, url: model.url, scale: 1 }));
}

/** An embedded model's bytes, when it is a binary glTF; nothing for anything else. */
export function embeddedGlb(url: string): Uint8Array | null {
  if (!url.startsWith('data:') || !url.includes(';base64,')) return null;
  try {
    const binary = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46 ? bytes : null;
  } catch {
    return null;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Bring the models a project carries into the player's folder: each embedded `.glb` not already
 * there, and each in another player's folder. Says which of the project's models came in.
 */
export async function importCarriedModels(assets: readonly ModelAsset[], me: string, send: Send = fetch): Promise<string[]> {
  const mine = await listYourModels(send);
  if (!Array.isArray(mine)) return [];
  const known = new Set(mine.map((model) => model.hash));
  const came: string[] = [];
  for (const asset of assets) {
    const owner = ownerOfModelUrl(asset.url);
    let body: { name: string; data: string } | { url: string } | null = null;
    if (owner !== null && owner !== me) body = { url: asset.url };
    else {
      const bytes = embeddedGlb(asset.url);
      if (bytes !== null && !known.has(await sha256(bytes))) body = { name: `${asset.id}.glb`, data: asset.url };
    }
    if (body === null) continue;
    const made = await importModel(body, send);
    if ('refused' in made) continue;
    known.add(made.hash);
    came.push(asset.id);
  }
  return came;
}
