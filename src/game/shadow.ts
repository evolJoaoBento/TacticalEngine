/**
 * The engine in the page, asked beside the game (`docs/SERVER.md`, phase 3, slice 2c).
 *
 * The game still answers the page: this asks the replica - the Rust engine built to WebAssembly
 * (`wasm-engine.ts`) - the same question, and keeps count of where the two part. Nothing a player sees
 * changes; the e2e suite reads the count (`window.__replica`) and holds it to nought. It runs only where
 * the page is served for development, the dev server the tests use, and only when `npm run wasm` has
 * built the engine: a page without it is the page it was.
 *
 * The replica is built from the project once, and again when the editor has changed the project under
 * the game (`projectChanged`); between, before each question, it is told how the game stands if that
 * has changed since it was last told.
 *
 * And a second game, in a second engine, is played in step with the page's (slice 3b, `mirror`): every
 * intent the page's game is given, it is given too, with the same arguments, and its answer and its board
 * (`board.ts`) are held to the page's. It is brought into step - built, told the game, its dice set - only
 * between questions, since a question waiting has no form to send; where it parts, it is out of step until
 * the next time it can be brought in. This is the game the page is to play (`WasmGame`), checked before the
 * page plays it.
 */

import type { DemoScene } from './demo-scene';
import { boardOf } from './board';
import { replicaOf } from './replica';
import { talkingAside } from './talks';
import { openContainer } from './prop-use';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';

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
    __replica?: { count: () => ReplicaCount };
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
function firstDifference(a: unknown, b: unknown, at = ''): { path: string; game: unknown; replica: unknown } | null {
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
const since = (board: unknown, from: number): Record<string, unknown> => {
  const b = JSON.parse(plain(board)) as Record<string, unknown> & { log: unknown[] };
  return { ...b, log: b.log.slice(from) };
};
/** How many partings are kept to be read; the rest are only counted. */
const KEPT = 20;

/** One count for the page, whichever game is being played. */
const count: ReplicaCount = { asked: 0, parted: 0, first: [] };

/** The count as it stands, a copy. */
export function replicaCount(): ReplicaCount {
  return JSON.parse(JSON.stringify(count)) as ReplicaCount;
}

export class Shadow {
  private builtFor: object | null = null;
  private told = '';
  /** The game played in step, and what it was built from; whether it is in step, and its log's start then. */
  private stepBuiltFor: object | null = null;
  private inStep = false;
  private logs = { ours: 0, theirs: 0 };

  constructor(private readonly engine: WasmEngine, private readonly demo: DemoScene, private readonly shipped: unknown, private readonly game: WasmEngine | null = null) {}

  /** The editor changed the project under the game: the replica is built again before it is next asked. */
  projectChanged(): void {
    this.builtFor = null;
    this.stepBuiltFor = null;
    this.inStep = false;
  }

  /** Something the game played in step was not told of happened: it is brought into step again before the next intent. */
  outOfStep(): void {
    this.inStep = false;
  }

  /** Bring the game played in step into step: only between questions, which have no form to send. */
  private bringIntoStep(game: WasmEngine): void {
    if (this.demo.pending !== null || talkingAside(this.demo).length > 0) return;
    try {
      if (this.stepBuiltFor !== this.demo.project) {
        game.build(this.demo.project, this.shipped, 'mirror', { animated: this.demo.animated, askDefender: this.demo.askDefender });
        this.stepBuiltFor = this.demo.project;
      }
      game.restore(replicaOf(this.demo));
      game.call('restoreRng', [this.demo.rng.save()]);
      game.call('restoreWalk', [this.demo.ambush, this.demo.approaching, openContainer(this.demo)]);
      this.logs = { ours: this.demo.log.length, theirs: (game.board() as { log: unknown[] }).log.length };
      this.inStep = true;
    } catch (failure) {
      this.part('in step', null, null, { failed: failure instanceof Error ? failure.message : String(failure) });
    }
  }

  private part(question: string, asked: unknown, game: unknown, replica: unknown): void {
    count.parted++;
    this.inStep = false;
    const parting = { question, asked: JSON.parse(plain(asked)), game: JSON.parse(plain(game)), replica: JSON.parse(plain(replica)) };
    if (count.first.length < KEPT) {
      count.first.push(parting);
      console.error('the replica parted from the game', JSON.stringify(parting).slice(0, 1500));
    }
  }

  /**
   * An intent given to the page's game, and to the game played in step: their answers, and their boards
   * after, held to each other. The page's answer is the one given.
   */
  mirror<T>(call: string, args: readonly unknown[], ours: () => T, compare: { answer: boolean } = { answer: true }): T {
    const game = this.game;
    if (game === null) return ours();
    if (!this.inStep) this.bringIntoStep(game);
    const stepped = this.inStep;
    const answer = ours();
    if (!stepped) return answer;
    let theirs: unknown;
    try {
      theirs = game.call(call, args);
    } catch (failure) {
      theirs = { failed: failure instanceof Error ? failure.message : String(failure) };
    }
    count.asked++;
    // A question asked for the mark it leaves on the game (`abilityList` names the actor) is held by the board
    // alone: its answer is the page's view of a card, which the engine writes in its own shape.
    if (compare.answer && !same(answer, theirs)) {
      this.part(call, args, answer, theirs);
      return answer;
    }
    const boards = { ours: since(boardOf(this.demo), this.logs.ours), theirs: since(game.board(), this.logs.theirs) };
    const parted = firstDifference(boards.ours, boards.theirs, 'board');
    if (parted !== null) this.part(`${call}: ${parted.path}`, args, parted.game, parted.replica);
    return answer;
  }

  /**
   * The game's answer, the replica asked the same and any parting counted. The replica is told how the game
   * stands before either answers: some of the game's answers leave a mark on it (whom a card may be aimed at
   * names the actor), and the replica, asked after, leaves the same.
   */
  check<T>(question: string, asked: unknown, game: () => T, replica: (engine: WasmEngine) => unknown, seen: (answer: T) => unknown = (a) => a): T {
    let synced = true;
    try {
      if (this.builtFor !== this.demo.project) {
        this.engine.build(this.demo.project, this.shipped, 'replica');
        this.builtFor = this.demo.project;
        this.told = '';
      }
      const now = replicaOf(this.demo);
      const text = plain(now);
      if (text !== this.told) {
        this.engine.restore(now);
        this.told = text;
      }
    } catch (failure) {
      synced = false;
      this.told = '';
      if (count.first.length < KEPT) count.first.push({ question: 'told', asked: null, game: null, replica: { failed: failure instanceof Error ? failure.message : String(failure) } });
    }
    const ours = game();
    if (!synced) {
      count.parted++;
      return ours;
    }
    let theirs: unknown;
    try {
      theirs = replica(this.engine);
    } catch (failure) {
      theirs = { failed: failure instanceof Error ? failure.message : String(failure) };
    }
    count.asked++;
    const said = seen(ours);
    if (plain(said) !== plain(theirs)) {
      count.parted++;
      const parting = { question, asked: JSON.parse(plain(asked)), game: JSON.parse(plain(said)), replica: JSON.parse(plain(theirs)) };
      if (count.first.length < KEPT) {
        count.first.push(parting);
        console.error('the replica parted from the game', JSON.stringify(parting).slice(0, 2000));
      }
    }
    return ours;
  }
}

let compiled: Promise<WebAssembly.Module | null> | null = null;

/** The engine, compiled once for the page: `null` outside development, or when it was never built. */
function engineModule(): Promise<WebAssembly.Module | null> {
  if (compiled === null) {
    compiled = import.meta.env.DEV
      ? fetch('/wasm/engine.wasm')
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .then((bytes) => (bytes === null ? null : WebAssembly.compile(bytes)))
          .catch(() => null)
      : Promise.resolve(null);
  }
  return compiled;
}

/** A shadow for a game, once the engine is here - or never. The count is published the first time. */
export async function shadowFor(demo: DemoScene): Promise<Shadow | null> {
  const module = await engineModule();
  if (module === null) return null;
  const shadow = new Shadow(await WasmEngine.of(module), demo, shippedContent(), await WasmEngine.of(module));
  if (typeof window !== 'undefined') window.__replica = { count: replicaCount };
  return shadow;
}
