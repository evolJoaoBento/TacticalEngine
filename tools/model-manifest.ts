import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { SAVE_HEADER } from './default-project.ts';

/**
 * The models a project ships with, found rather than listed.
 *
 * Dropping a `.glb` into `public/models` is how a model gets into the game: this
 * reads that folder at startup and hands the app what it found, so nothing has to
 * be registered by hand and a file added later is picked up on the next restart.
 * `import.meta.glob` cannot do it — Vite keeps `publicDir` out of the module graph
 * on purpose, because those files are copied rather than bundled — so the list
 * comes through a virtual module instead.
 *
 * The id is the file's own name, tidied the way the Models panel tidies the name of a
 * picked file: `bandit-cutter.glb` is the model `bandit-cutter`, and `stone_golem.glb`
 * is `stone-golem`, which is what content refers to and what an adversary of that id is
 * drawn with. The url keeps the name the file actually has, which is what is served.
 *
 * **Which ancestry a model draws** is kept here too, for every project at once: the editor's Models
 * page sets it (`ANCESTRY_URL`), this writes it to `projects/model-ancestries.json` - a tracked file,
 * so the choice is the repository's and outlives any one project or browser - and each model in the
 * list carries its `ancestry`. New Game offers an ancestry its models (`character-models.ts`). The
 * route is guarded as the project save is (`default-project.ts`): a POST, the page's own header, from
 * the page's own origin, one file named here, and a body that is a model id and an ancestry id or
 * nothing. It refuses when the tests are serving (`TACTICAL_BOOT=builtin`). A write updates the list
 * the next page load gets, without reloading the page that wrote it.
 *
 * **A model added to the engine** comes the same way (`MODEL_ADD_URL`): the editor's Models page sends
 * a `.glb` and this writes it into `public/models` under the name it was sent with, tidied to an id
 * (`judgeModelAdd`) - a binary glTF only, never over a file already there, under the same guard - so it
 * is a model every project has, as if it had been dropped in by hand. The page that sent it is not
 * reloaded for it (`quiet`); every other page is, as for any file dropped in. The folder is git-ignored:
 * a model reaches another machine through the lock (`npm run models`), once it is uploaded and locked.
 */

/** Where the files live, under the served directory, and what the app imports to get them. */
export const MODELS_DIRECTORY = 'models';
const VIRTUAL = 'virtual:shipped-models';
const RESOLVED = '\0' + VIRTUAL;

/** One model the folder holds: its id, the URL it is served at, how big it is drawn, and whose it is. */
export interface ShippedModel {
  id: string;
  url: string;
  scale: number;
  /** The ancestry it draws, when one has been chosen for it (`projects/model-ancestries.json`). */
  ancestry?: string;
}

/** Where the models' ancestries are kept, from the project root, and where the editor sends one. */
export const ANCESTRY_FILE = 'projects/model-ancestries.json';
export const ANCESTRY_URL = '/__models/ancestry';
/** The largest request the route reads: a model id and an ancestry id are a few dozen bytes. */
const ANCESTRY_LIMIT = 4096;
/** What an id is: lower case, digits and hyphens, as the manifest and content make them. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where the editor sends a model to add to the engine, and the most it may weigh. */
export const MODEL_ADD_URL = '/__models/add';
export const MODEL_ADD_LIMIT = 64 * 1024 * 1024;

/**
 * Whether a file the watcher reports is one of the engine's models: a glTF directly in the models folder,
 * which is all the manifest reads. Matched on the folder itself, not on a `/models/` somewhere in the
 * path - a player's own models are under `data/users/<account>/models/imported/`, and a Get or an import
 * writing one there must not reload every open page, the one that asked for it included. Separators are
 * the host's, and a Windows path compares without case.
 */
export function isEngineModelFile(file: string, folder: string): boolean {
  const norm = (path: string): string => {
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
  };
  const path = norm(file);
  const at = path.lastIndexOf('/');
  return /\.(glb|gltf)$/i.test(path) && path.slice(0, at) === norm(folder);
}

/** A file name as the manifest makes a model id of it: `Stone Golem.glb` is `stone-golem`. */
export function modelIdOf(name: string): string {
  return name
    .replace(/\.(glb|gltf)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type ModelAddJudgement = { ok: true; id: string; file: string } | { ok: false; status: number; reason: string };

/**
 * Whether a model may be added to the engine, and under what file: the project save's guard, a name
 * that makes an id, the four bytes every binary glTF starts with, and no file of that name already there.
 */
export function judgeModelAdd(request: AncestryRequest, name: string | null, body: Uint8Array, taken: (id: string) => boolean): ModelAddJudgement {
  if (request.method !== 'POST') return { ok: false, status: 405, reason: 'an upload is a POST' };
  if (headerOf(request, SAVE_HEADER) !== '1') return { ok: false, status: 403, reason: 'not sent by the page' };
  const origin = headerOf(request, 'origin');
  const host = headerOf(request, 'host');
  if (origin !== undefined && host !== undefined && hostOf(origin) !== host) return { ok: false, status: 403, reason: 'sent from another origin' };
  if (body.length > MODEL_ADD_LIMIT) return { ok: false, status: 413, reason: 'larger than a model should be - lighten it first' };
  const id = name === null || !/\.glb$/i.test(name) ? '' : modelIdOf(name);
  if (id === '') return { ok: false, status: 422, reason: 'only a .glb can be added to the engine' };
  const magic = body.length >= 4 && body[0] === 0x67 && body[1] === 0x6c && body[2] === 0x54 && body[3] === 0x46;
  if (!magic) return { ok: false, status: 422, reason: 'not a binary glTF file' };
  // By id, not by file name: `Quim.glb` and `quim.glb` are one model to the engine, whatever the disk thinks.
  if (taken(id)) return { ok: false, status: 409, reason: `the engine already has a model called ${id}` };
  return { ok: true, id, file: `${id}.glb` };
}

/** Model id to ancestry id. */
export type ModelAncestries = Readonly<Record<string, string>>;

/** The file's map, or nothing - no file, or anything in it that is not an id to an id, is left out. */
export function readModelAncestries(root: string): ModelAncestries {
  const file = resolve(root, ANCESTRY_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => ID.test(entry[0]) && typeof entry[1] === 'string' && ID.test(entry[1])));
  } catch {
    return {};
  }
}

/** The map with one model given an ancestry, or none, its keys in order so the file diffs cleanly. */
export function assignAncestry(map: ModelAncestries, model: string, ancestry: string | null): ModelAncestries {
  const next: Record<string, string> = { ...map };
  if (ancestry === null) delete next[model];
  else next[model] = ancestry;
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

/** Write the file whole or not at all. */
export function writeModelAncestries(root: string, map: ModelAncestries): void {
  const target = resolve(root, ANCESTRY_FILE);
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  writeFileSync(partial, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  renameSync(partial, target);
}

/** What a request to set one is judged on, kept apart from the server so it can be tested without one. */
export interface AncestryRequest {
  method?: string | undefined;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

export type AncestryJudgement = { ok: true; model: string; ancestry: string | null } | { ok: false; status: number; reason: string };

const headerOf = (request: AncestryRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

/** Whether a model's ancestry may be set, and to what: checked as the project save is checked. */
export function judgeAncestry(request: AncestryRequest, body: string): AncestryJudgement {
  if (request.method !== 'POST') return { ok: false, status: 405, reason: 'a change is a POST' };
  if (headerOf(request, SAVE_HEADER) !== '1') return { ok: false, status: 403, reason: 'not sent by the page' };
  const origin = headerOf(request, 'origin');
  const host = headerOf(request, 'host');
  if (origin !== undefined && host !== undefined && hostOf(origin) !== host) return { ok: false, status: 403, reason: 'sent from another origin' };
  if (body.length > ANCESTRY_LIMIT) return { ok: false, status: 413, reason: 'too large to be one model and its ancestry' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, reason: 'not JSON' };
  }
  const { model, ancestry } = (parsed ?? {}) as { model?: unknown; ancestry?: unknown };
  if (typeof model !== 'string' || !ID.test(model)) return { ok: false, status: 422, reason: 'no model id' };
  if (ancestry !== null && (typeof ancestry !== 'string' || !ID.test(ancestry))) return { ok: false, status: 422, reason: 'the ancestry is not an id, or nothing' };
  return { ok: true, model, ancestry };
}

/**
 * How much a shipped model is scaled on the way in: not at all.
 *
 * This was 0.5, because every file in the original set measured two units across
 * and two tall -- a tile's width twice over -- and half brought a creature down to
 * standing in one. That made the engine the place a model's size was decided, and
 * it is the wrong place: a file that comes in at the wrong size is a file to fix,
 * not a number to carry. A tile is one unit, so a model exported at one unit per
 * tile arrives correct, and what Blender says is what the board draws.
 *
 * A file that genuinely wants its own size still says so in the Models panel,
 * which writes it to the project and overrides this.
 */
export const SHIPPED_SCALE = 1;

/** The `.glb` files in the folder, as models, sorted so a build is the same twice, each with its ancestry. */
export function shippedModels(publicDir: string, ancestries: ModelAncestries = {}): ShippedModel[] {
  let names: string[];
  try {
    names = readdirSync(join(publicDir, MODELS_DIRECTORY));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('.glb') || name.toLowerCase().endsWith('.gltf'))
    .sort()
    .map((name) => {
      const id = modelIdOf(name);
      const ancestry = ancestries[id];
      return { id, url: `/${MODELS_DIRECTORY}/${name}`, scale: SHIPPED_SCALE, ...(ancestry === undefined ? {} : { ancestry }) };
    });
}

/** Serves the found list as `virtual:shipped-models`, in dev and in a build alike. */
export function modelManifest(): Plugin {
  let publicDir = 'public';
  let root = process.cwd();
  // Written to only by a dev server the tests are not using, as the project save is.
  let saves = process.env['TACTICAL_BOOT'] !== 'builtin';
  return {
    name: 'tactical-model-manifest',
    configResolved(config) {
      publicDir = config.publicDir || 'public';
      root = config.root;
      saves = config.command === 'serve' && process.env['TACTICAL_BOOT'] !== 'builtin';
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return [
        `export const SHIPPED_MODELS = ${JSON.stringify(shippedModels(publicDir, readModelAncestries(root)))};`,
        `export const ANCESTRY_URL = ${JSON.stringify(ANCESTRY_URL)};`,
        `export const ANCESTRY_SAVES = ${JSON.stringify(saves)};`,
        `export const MODEL_ADD_URL = ${JSON.stringify(MODEL_ADD_URL)};`,
        '',
      ].join('\n');
    },
    /**
     * Watch the folder, so a file dropped in appears without a restart.
     *
     * Two things stand between a new `.glb` and the running page. Vite keeps `publicDir`
     * out of the module graph on purpose - those files are copied rather than bundled - so
     * nothing there is watched unless it is asked for. And the virtual module is loaded
     * once and held: the list the page has is the one read when it was first asked for, so
     * even a file that predates the server never appears. Invalidating it is what makes
     * the next request re-read the folder.
     */
    configureServer(server) {
      const folder = join(publicDir, MODELS_DIRECTORY);
      server.watcher.add(folder);
      // Files this server has just written for the editor: the page that sent one has it already, and
      // reloading that page would throw away whatever was being edited.
      // Kept for a few seconds rather than for one event: a rename can be reported more than once.
      const quiet = new Map<string, number>();
      const changed = (file: string): void => {
        if (!isEngineModelFile(file, folder)) return;
        const path = file.replace(/\\/g, '/');
        const module = server.moduleGraph.getModuleById(RESOLVED);
        if (module !== undefined) server.moduleGraph.invalidateModule(module);
        const name = path.slice(path.lastIndexOf('/') + 1);
        if ((quiet.get(name) ?? 0) > Date.now()) return;
        // A full reload rather than an HMR update: the list is read at startup by the
        // scene the whole game is built from, so nothing short of starting again shows it.
        server.hot.send({ type: 'full-reload' });
      };
      for (const event of ['add', 'unlink', 'change'] as const) server.watcher.on(event, changed);

      server.middlewares.use(MODEL_ADD_URL, (request, response) => {
        const refuse = (status: number, reason: string): void => {
          response.statusCode = status;
          response.end(reason);
        };
        if (!saves) return refuse(403, 'this server does not add models to the engine');
        const name = new URL(request.url ?? '', 'http://local').searchParams.get('name');
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MODEL_ADD_LIMIT) chunks.push(chunk);
        });
        request.on('end', () => {
          if (size > MODEL_ADD_LIMIT) return refuse(413, 'larger than a model should be - lighten it first');
          const body = Buffer.concat(chunks);
          const verdict = judgeModelAdd(request, name, body, (id) => shippedModels(publicDir).some((model) => model.id === id));
          if (!verdict.ok) return refuse(verdict.status, verdict.reason);
          try {
            mkdirSync(folder, { recursive: true });
            quiet.set(verdict.file, Date.now() + 5000);
            const partial = join(folder, `${verdict.file}.part`);
            writeFileSync(partial, body);
            renameSync(partial, join(folder, verdict.file));
            const module = server.moduleGraph.getModuleById(RESOLVED);
            if (module !== undefined) server.moduleGraph.invalidateModule(module);
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ id: verdict.id, url: `/${MODELS_DIRECTORY}/${verdict.file}` }));
          } catch (error) {
            quiet.delete(verdict.file);
            refuse(500, (error as Error).message);
          }
        });
      });

      server.middlewares.use(ANCESTRY_URL, (request, response) => {
        const refuse = (status: number, reason: string): void => {
          response.statusCode = status;
          response.end(reason);
        };
        if (!saves) return refuse(403, 'this server does not keep models\u2019 ancestries');
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= ANCESTRY_LIMIT) chunks.push(chunk);
        });
        request.on('end', () => {
          if (size > ANCESTRY_LIMIT) return refuse(413, 'too large to be one model and its ancestry');
          const verdict = judgeAncestry(request, Buffer.concat(chunks).toString('utf8'));
          if (!verdict.ok) return refuse(verdict.status, verdict.reason);
          try {
            const map = assignAncestry(readModelAncestries(root), verdict.model, verdict.ancestry);
            writeModelAncestries(root, map);
            // The next page load reads the new list; the page that wrote it is not reloaded.
            const module = server.moduleGraph.getModuleById(RESOLVED);
            if (module !== undefined) server.moduleGraph.invalidateModule(module);
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(map));
          } catch (error) {
            refuse(500, (error as Error).message);
          }
        });
      });
    },
  };
}
