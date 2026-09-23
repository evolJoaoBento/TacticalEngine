/**
 * Which project the page opens on, and saving it back to where it came from.
 *
 * The default project is a file, `projects/default.json`, so what is changed in the editor and
 * saved is what opens the next time. The demo built from code is still here, standing in whenever
 * the file cannot be used, and it is what every test opens on (`tools/default-project.ts`).
 *
 * Four ways the page can open, and they differ in one thing that matters - whether Ctrl+S may
 * write the file back:
 *
 *   `file`     the file was there and loaded. Saves go back to it.
 *   `missing`  there is no file yet, so the code-built demo opens. Saves create the file, which
 *              is also how the default is reset: delete it, reload, save.
 *   `invalid`  there is a file and it would not load. The code-built demo opens and says why,
 *              and saves do **not** go to the file: it may be a great deal of somebody's work with
 *              one bad field in it, and quietly writing the demo over it would lose all of it.
 *   `builtin`  the code-built demo was asked for (`?boot=builtin`, or a test server). The file
 *              is not touched, however often somebody saves.
 */

import { BOOT, PROJECT_URL, SAVE_HEADER, SAVE_URL, SAVES } from 'virtual:boot-project';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema } from '../engine/scene/schema';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene, buildProjectScene, type DemoScene } from './demo-scene';

export type BootSource = 'file' | 'missing' | 'invalid' | 'builtin';

export interface Booted {
  demo: DemoScene;
  source: BootSource;
  /** Why the file was not used, for the player to be told; null when nothing went wrong. */
  problem: string | null;
}

/** What the page is opened with, so a test can hand in its own. */
export interface BootOptions {
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  /** The page's query string: `?boot=builtin` or `?boot=file` overrides the server's choice. */
  search?: string;
  boot?: 'file' | 'builtin';
  /** Where to report why the file was not used, so the player is told rather than the demo quietly opening. */
  problems?: string[];
}

const builtin = (): DemoScene => buildDemoScene(hollowVaultMap());

/** Which way to open: what the address asks for, or what the server was started with. */
export function bootMode(search: string, fallback: 'file' | 'builtin' = BOOT): 'file' | 'builtin' {
  const asked = new URLSearchParams(search).get('boot');
  return asked === 'builtin' || asked === 'file' ? asked : fallback;
}

/** Open the default project, or the demo from code when the file cannot be used. */
export async function bootDemo(options: BootOptions = {}): Promise<Booted> {
  const booted = await open(options);
  if (booted.problem !== null) options.problems?.push(booted.problem);
  return booted;
}

async function open(options: BootOptions): Promise<Booted> {
  const search = options.search ?? globalThis.location?.search ?? '';
  if (bootMode(search, options.boot ?? BOOT) === 'builtin') return { demo: builtin(), source: 'builtin', problem: null };

  const fetcher = options.fetcher ?? ((url: string, init?: RequestInit) => fetch(url, init));
  let text: string;
  try {
    const response = await fetcher(PROJECT_URL, { cache: 'no-store' });
    if (response.status === 404) return { demo: builtin(), source: 'missing', problem: null };
    if (!response.ok) return { demo: builtin(), source: 'invalid', problem: `The saved project could not be read (HTTP ${response.status}), so the demo opened instead.` };
    text = await response.text();
  } catch (failure) {
    return { demo: builtin(), source: 'invalid', problem: `The saved project could not be read (${reasonOf(failure)}), so the demo opened instead.` };
  }

  // Migrated before it is checked, the way a project opened by hand is: a file written by an
  // older build is brought up to date on the way in rather than refused.
  try {
    const parsed = projectSchema.safeParse(migrateDocument(JSON.parse(text)));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue === undefined ? '' : ` at ${issue.path.join('.')}`;
      return { demo: builtin(), source: 'invalid', problem: `The saved project would not load (${issue?.message ?? 'invalid'}${where}), so the demo opened instead. The file has been left as it is.` };
    }
    return { demo: buildProjectScene(parsed.data, parsed.data.id), source: 'file', problem: null };
  } catch (failure) {
    return { demo: builtin(), source: 'invalid', problem: `The saved project would not load (${reasonOf(failure)}), so the demo opened instead. The file has been left as it is.` };
  }
}

/** Whether Ctrl+S writes the default project back, for a page opened this way. */
export function savesToDefault(source: BootSource, saves: boolean = SAVES): boolean {
  return saves && (source === 'file' || source === 'missing');
}

/**
 * Write the default project back through the dev server.
 *
 * `unavailable` rather than a throw when it cannot: a built site has no server to write to, and
 * the caller falls back to saving a file of the player's choosing, as it always did.
 */
export async function saveDefault(text: string, fetcher: BootOptions['fetcher'] = (url, init) => fetch(url, init)): Promise<'written' | 'unavailable'> {
  try {
    const response = await fetcher(SAVE_URL, { method: 'POST', headers: { 'content-type': 'application/json', [SAVE_HEADER]: '1' }, body: text });
    return response.ok ? 'written' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const reasonOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));
