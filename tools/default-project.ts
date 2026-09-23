/**
 * The default project as a file: read when the page opens, written when it is saved.
 *
 * The demo used to be built from code on every load, so nothing done to it in the editor outlived
 * a refresh - a save went to a file somewhere else, and the page opened on the code again. Now the
 * project that opens is `projects/default.json`, and saving it writes that same file, so what was
 * changed is what opens next time.
 *
 * A browser cannot write into the folder it was served from, which is why this is a plugin: the dev
 * server is Node, and Node can. It is the same arrangement `model-manifest.ts` has with the models
 * folder, the other way round.
 *
 * The file lives beside `public/` rather than in it. Vite copies `public/` as it stands and a
 * change there is an asset change; a project is authored work, and keeping it apart means a save
 * can never be mistaken for a new model arriving.
 *
 * **Guarded, because it writes to disk.** A dev server listens on a port any page in the browser
 * can send a request to, and a plain cross-site POST needs no permission to be sent. So a save has
 * to carry a header of its own - which no other site can add without asking the server first, and
 * this server never agrees - and come from the page's own origin. It writes exactly one file,
 * named here, never a path taken from the request.
 *
 * Tests run on the code-built demo, whatever the file holds (`TACTICAL_BOOT=builtin`, set by the
 * Playwright config), and with that set the save route refuses outright: an end-to-end suite that
 * could overwrite somebody's project by pressing Ctrl+S is not one anybody should run.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Where the file is, from the project root, and where the page asks for it. */
export const PROJECT_FILE = 'projects/default.json';
export const PROJECT_URL = '/projects/default.json';
/** Where a save is sent, and the header that says the page itself sent it. */
export const SAVE_URL = '/__project/save';
export const SAVE_HEADER = 'x-tactical-save';
/** The largest save accepted. The demo is half a megabyte; a room forty times its size is still a room. */
export const SAVE_LIMIT = 32 * 1024 * 1024;

const VIRTUAL = 'virtual:boot-project';
const RESOLVED = `\0${VIRTUAL}`;

/** What a save request is judged on - kept apart from the server so it can be tested without one. */
export interface SaveRequest {
  method?: string | undefined;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

export type SaveJudgement = { ok: true; text: string } | { ok: false; status: number; reason: string };

/**
 * The host an origin names, or nothing when it names none. A sandboxed page sends the origin
 * `null`, which is not a URL at all, and a save from one is a save from nowhere this server knows.
 */
const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

const header = (request: SaveRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Whether a save may be written, and the text to write when it may.
 *
 * Checked in the order that says the most about a refused one: the wrong kind of request, then
 * somebody else's page, then a body that is not a project. What is written is the text as sent,
 * so the file diffs the way the editor pretty-printed it.
 */
export function judgeSave(request: SaveRequest, body: string): SaveJudgement {
  if (request.method !== 'POST') return { ok: false, status: 405, reason: 'a save is a POST' };
  if (header(request, SAVE_HEADER) !== '1') return { ok: false, status: 403, reason: 'not sent by the page' };
  // A same-origin fetch names its origin; a page on another origin names that one instead.
  const origin = header(request, 'origin');
  const host = header(request, 'host');
  if (origin !== undefined && host !== undefined && hostOf(origin) !== host) {
    return { ok: false, status: 403, reason: 'sent from another origin' };
  }
  if (body.length > SAVE_LIMIT) return { ok: false, status: 413, reason: 'too large to be a project' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, reason: 'not JSON' };
  }
  const project = parsed as { id?: unknown; scenes?: unknown };
  if (typeof project !== 'object' || project === null || typeof project.id !== 'string' || !Array.isArray(project.scenes) || project.scenes.length === 0) {
    return { ok: false, status: 422, reason: 'not a project: no id, or no scenes' };
  }
  return { ok: true, text: body.endsWith('\n') ? body : `${body}\n` };
}

/**
 * Write the file whole or not at all. A crash half-way through a plain write would leave half a
 * project where the whole one was, and that is the one file this exists to keep.
 */
export function writeProject(root: string, text: string): void {
  const target = resolve(root, PROJECT_FILE);
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  writeFileSync(partial, text, 'utf8');
  renameSync(partial, target);
}

/** How the page should open, and whether it may save back: read once, when the server starts. */
function bootFacts(command: 'serve' | 'build'): { boot: 'file' | 'builtin'; saves: boolean } {
  const boot = process.env['TACTICAL_BOOT'] === 'builtin' ? 'builtin' : 'file';
  return { boot, saves: command === 'serve' && boot === 'file' };
}

export function defaultProject(): Plugin {
  let root = process.cwd();
  let facts = bootFacts('serve');
  // Where the site is served from: a project page on GitHub is served under its own name, and a
  // page there asking for `/projects/...` would ask the wrong site.
  let base = '/';
  return {
    name: 'tactical-default-project',
    configResolved(config) {
      root = config.root;
      base = config.base;
      facts = bootFacts(config.command);
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return [
        `export const BOOT = ${JSON.stringify(facts.boot)};`,
        `export const SAVES = ${JSON.stringify(facts.saves)};`,
        `export const PROJECT_URL = ${JSON.stringify(`${base.replace(/[/]+$/, '')}${PROJECT_URL}`)};`,
        `export const SAVE_URL = ${JSON.stringify(SAVE_URL)};`,
        `export const SAVE_HEADER = ${JSON.stringify(SAVE_HEADER)};`,
        '',
      ].join('\n');
    },
    configureServer(server) {
      // Read fresh on every request, never cached: the point is that a reload shows the last save.
      server.middlewares.use(PROJECT_URL, (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        const file = resolve(root, PROJECT_FILE);
        if (!existsSync(file)) {
          response.statusCode = 404;
          return response.end();
        }
        response.setHeader('content-type', 'application/json');
        response.setHeader('cache-control', 'no-store');
        response.end(readFileSync(file));
      });
      server.middlewares.use(SAVE_URL, (request, response) => {
        const refuse = (status: number, reason: string): void => {
          response.statusCode = status;
          response.end(reason);
        };
        if (!facts.saves) return refuse(403, 'this server does not save the default project');
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= SAVE_LIMIT) chunks.push(chunk);
        });
        request.on('end', () => {
          // Judged on its whole size, not on the part that was kept: a truncated body would
          // otherwise be refused as bad JSON rather than as the too-large save it is.
          if (size > SAVE_LIMIT) return refuse(413, 'too large to be a project');
          const verdict = judgeSave(request, Buffer.concat(chunks).toString('utf8'));
          if (!verdict.ok) return refuse(verdict.status, verdict.reason);
          try {
            writeProject(root, verdict.text);
          } catch (failure) {
            return refuse(500, failure instanceof Error ? failure.message : String(failure));
          }
          response.statusCode = 204;
          response.end();
        });
      });
    },
    /** A built site opens on the same project, read-only: there is no server there to write it. */
    generateBundle() {
      const file = resolve(root, PROJECT_FILE);
      if (existsSync(file)) this.emitFile({ type: 'asset', fileName: PROJECT_FILE, source: readFileSync(file) });
    },
  };
}
