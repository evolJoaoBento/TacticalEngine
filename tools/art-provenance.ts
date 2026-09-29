import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { SAVE_HEADER } from './default-project.ts';

/**
 * How each piece of the engine's art was made - AI generated, AI assisted, or made by hand - kept for
 * every project at once.
 *
 * The editor marks AI art with a red badge (`src/editor/ui/AiMark.tsx`) and a note when it is hovered;
 * what it says follows a rule for each kind of art (`src/editor/art-provenance.ts`: the models and the
 * equipment pictures are AI generated, the reference card art and the engine's code-drawn models made
 * by hand), and anything changed from its rule is kept here, in `projects/art-provenance.json` - a
 * tracked file, so a change is the repository's and outlives any project or browser. The editor sends
 * a change (`PROVENANCE_URL`); the route is guarded as the project save is (`default-project.ts`): a
 * POST, the page's own header, from the page's own origin, one file named here, and a body that is a
 * key and one of the three words, or nothing to go back to the rule. It refuses when the tests are
 * serving (`TACTICAL_BOOT=builtin`). A write updates what the next page load is served, without
 * reloading the page that wrote it.
 */

export const PROVENANCE_FILE = 'projects/art-provenance.json';
export const PROVENANCE_URL = '/__art/provenance';
const VIRTUAL = 'virtual:art-provenance';
const RESOLVED = '\0' + VIRTUAL;
/** The most a change may weigh: one key and one word. */
const LIMIT = 4096;

export const PROVENANCES = ['ai-generated', 'ai-assisted', 'human-made'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** What a piece of art is called here: what kind it is, and its id - `model:quim`, `card:bare-bones`, `equipment:broadsword.webp`. */
const KEY = /^(model|card|equipment):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Art key to how it was made, for the art changed from its rule. */
export type ProvenanceMap = Readonly<Record<string, Provenance>>;

const isProvenance = (value: unknown): value is Provenance => (PROVENANCES as readonly unknown[]).includes(value);

/** The file's map, or nothing: no file, or anything in it that is not a key and one of the three, is left out. */
export function readProvenance(root: string): ProvenanceMap {
  const file = resolve(root, PROVENANCE_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, Provenance] => KEY.test(entry[0]) && isProvenance(entry[1])));
  } catch {
    return {};
  }
}

/** The map with one piece of art marked, or put back to its rule (`null`), keys in order so the file diffs cleanly. */
export function markProvenance(map: ProvenanceMap, key: string, provenance: Provenance | null): ProvenanceMap {
  const next: Record<string, Provenance> = { ...map };
  if (provenance === null) delete next[key];
  else next[key] = provenance;
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

/** Write the file whole or not at all. */
export function writeProvenance(root: string, map: ProvenanceMap): void {
  const target = resolve(root, PROVENANCE_FILE);
  mkdirSync(dirname(target), { recursive: true });
  const partial = `${target}.partial`;
  writeFileSync(partial, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  renameSync(partial, target);
}

export interface ProvenanceRequest {
  method?: string | undefined;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

export type ProvenanceJudgement = { ok: true; key: string; provenance: Provenance | null } | { ok: false; status: number; reason: string };

const headerOf = (request: ProvenanceRequest, name: string): string | undefined => {
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

/** Whether a piece of art's mark may be changed, and to what: checked as the project save is checked. */
export function judgeProvenance(request: ProvenanceRequest, body: string): ProvenanceJudgement {
  if (request.method !== 'POST') return { ok: false, status: 405, reason: 'a change is a POST' };
  if (headerOf(request, SAVE_HEADER) !== '1') return { ok: false, status: 403, reason: 'not sent by the page' };
  const origin = headerOf(request, 'origin');
  const host = headerOf(request, 'host');
  if (origin !== undefined && host !== undefined && hostOf(origin) !== host) return { ok: false, status: 403, reason: 'sent from another origin' };
  if (body.length > LIMIT) return { ok: false, status: 413, reason: 'too large to be one mark' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, reason: 'not JSON' };
  }
  const { key, provenance } = (parsed ?? {}) as { key?: unknown; provenance?: unknown };
  if (typeof key !== 'string' || !KEY.test(key)) return { ok: false, status: 422, reason: 'not a piece of art the engine knows how to name' };
  if (provenance !== null && !isProvenance(provenance)) return { ok: false, status: 422, reason: 'not AI generated, AI assisted, human made, or nothing' };
  return { ok: true, key, provenance };
}

export function artProvenance(): Plugin {
  let root = process.cwd();
  let saves = process.env['TACTICAL_BOOT'] !== 'builtin';
  return {
    name: 'tactical-art-provenance',
    configResolved(config) {
      root = config.root;
      saves = config.command === 'serve' && process.env['TACTICAL_BOOT'] !== 'builtin';
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return [
        `export const PROVENANCE = ${JSON.stringify(readProvenance(root))};`,
        `export const PROVENANCE_URL = ${JSON.stringify(PROVENANCE_URL)};`,
        `export const PROVENANCE_SAVES = ${JSON.stringify(saves)};`,
        '',
      ].join('\n');
    },
    configureServer(server) {
      server.middlewares.use(PROVENANCE_URL, (request, response) => {
        const refuse = (status: number, reason: string): void => {
          response.statusCode = status;
          response.end(reason);
        };
        if (!saves) return refuse(403, 'this server does not keep how art was made');
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= LIMIT) chunks.push(chunk);
        });
        request.on('end', () => {
          if (size > LIMIT) return refuse(413, 'too large to be one mark');
          const verdict = judgeProvenance(request, Buffer.concat(chunks).toString('utf8'));
          if (!verdict.ok) return refuse(verdict.status, verdict.reason);
          try {
            const map = markProvenance(readProvenance(root), verdict.key, verdict.provenance);
            writeProvenance(root, map);
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
