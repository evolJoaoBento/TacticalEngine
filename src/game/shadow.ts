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
 */

import type { DemoScene } from './demo-scene';
import { replicaOf } from './replica';
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

  constructor(private readonly engine: WasmEngine, private readonly demo: DemoScene, private readonly shipped: unknown) {}

  /** The editor changed the project under the game: the replica is built again before it is next asked. */
  projectChanged(): void {
    this.builtFor = null;
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
        console.warn('the replica parted from the game', parting);
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
  const shadow = new Shadow(await WasmEngine.of(module), demo, shippedContent());
  if (typeof window !== 'undefined') window.__replica = { count: replicaCount };
  return shadow;
}
