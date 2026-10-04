/**
 * The two lists the page needs before anything is built, asked of the server as the page opens: the
 * engine's models, each with its ancestry, and how each piece of art was made.
 *
 * The Rust server reads both on every request (`GET /__models/shipped`, `GET /__art/marks` - the folder,
 * `projects/model-ancestries.json`, `projects/art-provenance.json`), so a model added to the engine, an
 * ancestry given or a mark changed is in the next page's lists without building the client again. Where
 * no server answers - a static site, the tests' server, a unit test - the lists are the ones the build
 * carries (`virtual:shipped-models`, `virtual:art-provenance`), read when it was built.
 *
 * A static build does not ask at all - there is no server behind it, and asking would put a failed request
 * in the console on every load - only a dev server and a build for the Rust server (`--mode server`) do.
 *
 * Asked with a top-level `await`, so whatever imports these has them before it runs: the boot, which
 * lays the engine's models under a project (`project-open.ts`), and the editor's marks
 * (`art-provenance.ts`). One request each, as the page opens; phase 3 of `docs/SERVER.md` carries the
 * rest of what the page is told the same way.
 */

import { SHIPPED_MODELS as BUILT_MODELS } from 'virtual:shipped-models';
import { PROVENANCE as BUILT_MARKS } from 'virtual:art-provenance';
import { hasServer } from './play-socket';

export interface ShippedModel {
  id: string;
  url: string;
  scale: number;
  ancestry?: string;
}

/** Where the page asks for each, on the server it was served from. */
export const SHIPPED_URL = '/__models/shipped';
export const MARKS_URL = '/__art/marks';

const isModel = (value: unknown): value is ShippedModel => {
  const model = value as Partial<ShippedModel> | null;
  return typeof model === 'object' && model !== null && typeof model.id === 'string' && typeof model.url === 'string' && typeof model.scale === 'number';
};
export type Mark = 'ai-generated' | 'ai-assisted' | 'human-made';
const MARKS: readonly unknown[] = ['ai-generated', 'ai-assisted', 'human-made'];
export const isMarks = (value: unknown): value is Record<string, Mark> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((mark) => MARKS.includes(mark));

/** A list as the server has it now, or the one the build carries: no server, a refusal, or not the shape it should be. */
export async function asked<T>(url: string, built: T, valid: (value: unknown) => value is T, send: typeof fetch = fetch): Promise<T> {
  try {
    const response = await send(url, { cache: 'no-store' });
    if (!response.ok) return built;
    const value: unknown = await response.json();
    return valid(value) ? value : built;
  } catch {
    return built;
  }
}

export const listOfModels = (value: unknown): value is ShippedModel[] => Array.isArray(value) && value.every(isModel);

/** Whether this page has a server to ask: a dev server, or a build the Rust server serves (`hasServer`). */
const served = hasServer();

export const SHIPPED_MODELS: readonly ShippedModel[] = served ? await asked<ShippedModel[]>(SHIPPED_URL, [...BUILT_MODELS], listOfModels) : [...BUILT_MODELS];
export const PROVENANCE: Readonly<Record<string, Mark>> = served ? await asked<Record<string, Mark>>(MARKS_URL, { ...BUILT_MARKS }, isMarks) : { ...BUILT_MARKS };
