/**
 * Where the page's games part, counted (`docs/SERVER.md`, phases 3 to 5).
 *
 * The page plays the engine built to WebAssembly (`WasmGame`), and in development holds it to the game on the
 * server (`wire.ts`); the questions the pointer asks are put to the page's views and to the engine. Every such
 * comparison is counted here, and where two part the parting is kept - the first few - and said to the console
 * as an error, which a watching spec fails on; the e2e suite reads the count (`window.__replica`) and holds it to
 * nought. `firstDifference` says where two values first part, key order aside. And `engineModule` is the engine,
 * compiled once for the page.
 *
 * (It was the mirror's - a second engine played in step with the page's own TypeScript game - until that game,
 * the oracle, was deleted: phase 5, slice 0.)
 */

/** Where the game and the replica parted: the question, what it was asked with, and each answer. */
export interface Parting {
  question: string;
  asked: unknown;
  game: unknown;
  replica: unknown;
}

/** What the e2e suite reads: how many questions were asked of both, and where they parted. */
export interface ReplicaCount {
  asked: number;
  parted: number;
  first: Parting[];
}

declare global {
  interface Window {
    /** The shadow's count, for a test. Absent where there is no replica. */
    __replica?: { count: () => ReplicaCount; playing: () => 'wasm' | 'ts'; server: () => string };
  }
}

const plain = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * A value as two games are compared on it: keys in order, and a key whose value is nothing left out - the
 * TypeScript leaves a field out where the Rust writes `null` for it, and neither is wrong.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const field = (value as Record<string, unknown>)[key];
      if (field !== null && field !== undefined) out[key] = canonical(field);
    }
    return out;
  }
  return Object.is(value, -0) ? 0 : value;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Where two values first part: the path to it, and each side there. */
export function firstDifference(a: unknown, b: unknown, at = ''): { path: string; game: unknown; replica: unknown } | null {
  if (same(a, b)) return null;
  const x = canonical(a);
  const y = canonical(b);
  if (Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
    for (let i = 0; i < x.length; i++) {
      const found = firstDifference(x[i], y[i], `${at}[${i}]`);
      if (found !== null) return found;
    }
  }
  if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    for (const key of keys) {
      const found = firstDifference((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key], `${at}.${key}`);
      if (found !== null) return found;
    }
  }
  return { path: at, game: x, replica: y };
}

/** A board, its log cut to the lines since a game was brought into step. */
export const since = (board: unknown, from: number): Record<string, unknown> => {
  const b = JSON.parse(plain(board)) as Record<string, unknown> & { log: unknown[] };
  return { ...b, log: b.log.slice(from) };
};
/** How many partings are kept to be read; the rest are only counted. */
const KEPT = 20;

/** One count for the page, whichever game is being played. */
const count: ReplicaCount = { asked: 0, parted: 0, first: [] };

/** A parting counted, kept (the first few) and said to the console as an error, which a watching spec fails on. */
export function recordParting(question: string, asked: unknown, game: unknown, replica: unknown): void {
  count.parted++;
  const parting = { question, asked: JSON.parse(plain(asked)), game: JSON.parse(plain(game)), replica: JSON.parse(plain(replica)) };
  if (count.first.length < KEPT) {
    count.first.push(parting);
    console.error('the replica parted from the game', JSON.stringify(parting).slice(0, 1500));
  }
}

/** A question put to both, counted. */
export function recordAsked(): void {
  count.asked++;
}

/** The count as it stands, a copy. */
export function replicaCount(): ReplicaCount {
  return JSON.parse(JSON.stringify(count)) as ReplicaCount;
}


let compiled: Promise<WebAssembly.Module | null> | null = null;

/**
 * The engine, compiled once for the page - in a build as in development, the builds compiling it (`npm run
 * build` runs `npm run wasm` first) - or `null` where it was never built.
 */
export function engineModule(): Promise<WebAssembly.Module | null> {
  if (compiled === null) {
    compiled = fetch('/wasm/engine.wasm')
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((bytes) => (bytes === null ? null : WebAssembly.compile(bytes)))
      .catch(() => null);
  }
  return compiled;
}

/** Which game the page plays: its own, or the engine's (`wasm-game.ts`). */
let playing: 'wasm' | 'ts' = 'wasm';
/** Where the wire to the server's game stands (`wire.ts`): `off` where there is none. */
let server: () => string = () => 'off';

/** The count, where a test can read it, which game the page plays, and how its wire to the server stands. */
export function publishCount(engine?: 'wasm' | 'ts', wire?: () => string): void {
  if (engine !== undefined) playing = engine;
  if (wire !== undefined) server = wire;
  if (typeof window !== 'undefined') window.__replica = { count: replicaCount, playing: () => playing, server: () => server() };
}

