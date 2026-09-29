import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { keepsAccounts } from './accounts.ts';

/**
 * **Your models**: each player's own `.glb` files, kept by the dev server in their folder
 * (`data/users/<account>/models/imported/`, git ignored as the accounts are), and offered in the
 * editor under every project they open (`src/game/your-models.ts`, the Models page).
 *
 * A model comes into it three ways, all through `importModel`: **Get** on a model in the Store
 * (`tools/store.ts`), a project opened with models it carries - embedded in the file, or in another
 * player's folder - imported on the fly (`importCarriedModels`), and nothing else. The same file twice
 * is kept once: a model is known by its bytes (`hash`), so opening the same project again imports
 * nothing. Its id is its file's name, tidied as the engine's are (`tidyId`), and never one this
 * player's folder has already given to a different file.
 *
 * **The routes are the Rust server's now** (`server/serve/src/your_models.rs`, `docs/SERVER.md`), over the
 * same folders; the functions here stay the reference it is held to (`tests/unit/your-models.golden.test.ts`
 * writes `server/fixtures/your-models.json` from them).
 *
 * Routes: `/__models/mine` (GET, your models), `/__models/u/<account>/imported/<file>` (GET, the file,
 * for anybody signed in - a project that uses it draws it for whoever opens it), and `/__models/import`
 * (POST, the page's own, signed in: `{ name, data }` a file, or `{ url }` a file in another player's
 * folder). None of it when the tests are serving (`TACTICAL_BOOT=builtin`): every route answers 404.
 */

export const YOUR_MODELS_URL = '/__models/mine';
export const USER_MODELS_URL = '/__models/u';
export const IMPORT_MODEL_URL = '/__models/import';
/** The most an import may weigh, sent as base64. */
export const IMPORT_LIMIT = 128 * 1024 * 1024;

/** One of a player's models. */
export interface YourModel {
  id: string;
  /** The file in the player's folder, and where it is served. */
  file: string;
  url: string;
  /** Its bytes' SHA-256, hex: the same file is kept once. */
  hash: string;
  /** The Store listing it was got from, if it was. */
  listing?: string;
  added: number;
}

const ACCOUNT = /^[a-z0-9_-]{3,24}$/;
const FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.glb$/;

export const modelsFolder = (account: string): string => `data/users/${account}/models/imported`;
const indexFile = (account: string): string => `data/users/${account}/models/imported.json`;
export const modelUrl = (account: string, file: string): string => `${USER_MODELS_URL}/${account}/imported/${file}`;

/** A file's name as a model id, as the engine tidies the names in `public/models`. */
export function tidyId(name: string): string {
  const base = name.replace(/\.(glb|gltf)$/i, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

/** Whether these bytes are a binary glTF: the only file a player's folder keeps. */
export const isGlb = (bytes: Uint8Array): boolean => bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;

export const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Which account and file a served url names, or nothing: `/__models/u/<account>/imported/<file>`. */
export function fileOfUrl(url: string): { account: string; file: string } | null {
  const match = /^\/__models\/u\/([^/]+)\/imported\/([^/?#]+)$/.exec(url);
  if (match === null || !ACCOUNT.test(match[1]!) || !FILE.test(match[2]!)) return null;
  return { account: match[1]!, file: match[2]! };
}

export function readYourModels(root: string, account: string): YourModel[] {
  const file = resolve(root, indexFile(account));
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as YourModel[]) : [];
  } catch {
    return [];
  }
}

function writeYourModels(root: string, account: string, models: readonly YourModel[]): void {
  const file = resolve(root, indexFile(account));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.partial`, `${JSON.stringify(models, null, 2)}\n`, 'utf8');
  renameSync(`${file}.partial`, file);
}

/**
 * Where a new file goes in a folder: the name's id, or the first `-2`, `-3`... not taken. A file the
 * folder already holds - the same bytes - is not a new one (`importModel` answers it first).
 */
export function freeModelId(wanted: string, taken: readonly YourModel[]): string {
  const ids = new Set(taken.map((model) => model.id));
  if (!ids.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) if (!ids.has(`${wanted}-${n}`)) return `${wanted}-${n}`;
}

/** Put a `.glb` into a player's folder, or find it already there; or why not. */
export function importModel(
  root: string,
  account: string,
  name: string,
  bytes: Uint8Array,
  from: { listing?: string } = {},
): { ok: true; model: YourModel; fresh: boolean } | { ok: false; reason: string } {
  if (!ACCOUNT.test(account)) return { ok: false, reason: 'no such account' };
  if (!isGlb(bytes)) return { ok: false, reason: 'a model is a binary glTF (.glb)' };
  const models = readYourModels(root, account);
  const hash = hashOf(bytes);
  const known = models.find((model) => model.hash === hash);
  if (known !== undefined) {
    // Got from the Store after it was imported some other way: it is that listing's too.
    if (from.listing !== undefined && known.listing === undefined) {
      known.listing = from.listing;
      writeYourModels(root, account, models);
    }
    return { ok: true, model: known, fresh: false };
  }
  const id = freeModelId(tidyId(name), models);
  const file = `${id}.glb`;
  const folder = resolve(root, modelsFolder(account));
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, file), bytes);
  const model: YourModel = { id, file, url: modelUrl(account, file), hash, ...(from.listing === undefined ? {} : { listing: from.listing }), added: Date.now() };
  writeYourModels(root, account, [...models, model]);
  return { ok: true, model, fresh: true };
}

/** An import, from its body: a file (`name`, `data` as base64 or a data URL), or a url in another player's folder. */
export function judgeImport(body: string): { ok: true; name: string; bytes: Uint8Array } | { ok: true; url: { account: string; file: string } } | { ok: false; reason: string } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (typeof parsed['url'] === 'string') {
    const url = fileOfUrl(parsed['url']);
    return url === null ? { ok: false, reason: 'that is not a model in a player’s folder' } : { ok: true, url };
  }
  const { name, data } = parsed as { name?: unknown; data?: unknown };
  if (typeof name !== 'string' || typeof data !== 'string') return { ok: false, reason: 'an import is a file’s name and its data' };
  const bytes = new Uint8Array(Buffer.from(data.includes(',') ? data.slice(data.indexOf(',') + 1) : data, 'base64'));
  return { ok: true, name, bytes };
}

/**
 * The routes are the Rust server's now (`server/serve/src/your_models.rs`, passed through by
 * `rust-server.ts`); what is left here is the answer when there is no server - the tests', or a build -
 * which is no models of anybody's.
 */
export function yourModels(): Plugin {
  let on = keepsAccounts('serve');
  return {
    name: 'tactical-your-models',
    configResolved(config) {
      on = keepsAccounts(config.command);
    },
    configureServer(server) {
      if (on) return;
      for (const route of [YOUR_MODELS_URL, USER_MODELS_URL, IMPORT_MODEL_URL]) {
        server.middlewares.use(route, (_request: IncomingMessage, response: ServerResponse) => {
          response.statusCode = 404;
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'no-store');
          response.end(JSON.stringify({ reason: 'this server keeps no models of yours' }));
        });
      }
    },
  };
}

/** Copy a file on disk into a player's folder - a Store listing's, or the engine's own. */
export function importFile(root: string, account: string, name: string, path: string, from: { listing?: string } = {}): ReturnType<typeof importModel> {
  if (!existsSync(path)) return { ok: false, reason: 'no such file' };
  return importModel(root, account, name, new Uint8Array(readFileSync(path)), from);
}
