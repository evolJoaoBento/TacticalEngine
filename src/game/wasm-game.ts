/**
 * The page playing the Rust engine (`docs/SERVER.md`, phase 3, slice 3b, its second half).
 *
 * `WasmGame` is `LocalGame` with the roles turned round: every intent is played by the engine built to
 * WebAssembly, and the engine's answer is the one the page is given. The page's own game is played beside
 * it, intent for intent, and held to it - the answer and the board (`board.ts`) - because it is what the
 * page's views read: the HUD, the panels, the board's drawing, the right-click card all read a `DemoScene`,
 * and the one beside the engine is it, in step. Where the two part, the page's game is stood where the
 * engine's board says (`restoreFromBoard`), and the parting is counted as the shadow counts one
 * (`window.__replica`). A question waiting, or a conversation set aside, the board cannot give back: while
 * the engine holds one the page's game is out of step, and brought back when it has closed.
 *
 * The questions the pointer asks are put to both and held to each other; the page's answer, already in the
 * page's shapes, is the one given, being the same. The editor still changes the page's game - its project,
 * its ground, its party - and the engine is built again and told the game after.
 *
 * Chosen with `?engine=wasm`, or for a whole dev server with `VITE_ENGINE=wasm`, in development where
 * `npm run wasm` has built the engine; anywhere else the page plays its own game, as it did.
 */

import { boardOf, restoreFromBoard, rollsOf, type BoardSnapshot } from './board';
import { LocalGame, type GameClient, type LocalPowers } from './client';
import type { DemoScene } from './demo-scene';
import { openContainer } from './prop-use';
import { replicaOf } from './replica';
import { engineModule, firstDifference, publishCount, recordAsked, recordParting } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';

export type { GameClient, LocalPowers } from './client';

/** A board, its log cut to the lines since the two games were last brought into step. */
const since = (board: unknown, from: number): Record<string, unknown> => {
  const b = JSON.parse(JSON.stringify(board ?? null)) as Record<string, unknown> & { log: unknown[] };
  return { ...b, log: b.log.slice(from) };
};

export class WasmGame extends LocalGame {
  private inStep = false;
  private logs = { ours: 0, theirs: 0 };

  constructor(demo: DemoScene, private readonly engine: WasmEngine, private readonly shipped: unknown) {
    super(demo, false);
    this.toldFromThePage();
    publishCount('wasm');
  }

  /** The engine built from the project and told the page's game: at the start, and after the editor's changes. */
  private toldFromThePage(): void {
    this.engine.build(this.demo.project, this.shipped, 'wasm', { animated: this.demo.animated, askDefender: this.demo.askDefender });
    this.engine.restore(replicaOf(this.demo));
    this.engine.call('restoreRng', [this.demo.rng.save()]);
    this.engine.call('restoreWalk', [this.demo.ambush, this.demo.approaching, openContainer(this.demo), rollsOf(this.demo)]);
    this.logs = { ours: this.demo.log.length, theirs: (this.engine.board() as BoardSnapshot).log.length };
    this.inStep = true;
  }

  /** The page's game stood where the engine's board says - or, while the engine holds a question, out of step. */
  private bringBack(): void {
    const board = this.engine.board() as BoardSnapshot;
    if (board.pending !== null || board.aside.length > 0) {
      this.inStep = false;
      return;
    }
    restoreFromBoard(this.demo, board);
    this.logs = { ours: this.demo.log.length, theirs: board.log.length };
    this.inStep = true;
  }

  protected override edited(): void {
    this.toldFromThePage();
  }

  /** An intent: the engine plays it and answers; the page's game plays it beside, held to it. */
  protected override did<T>(call: string, args: readonly unknown[], run: () => T, compare: { answer: boolean } = { answer: true }): T {
    let engines: unknown;
    try {
      engines = this.engine.call(call, args);
    } catch (failure) {
      // An engine that cannot answer is a parting like any other: the page's own game answers this once.
      recordParting(`${call}: the engine failed`, args, null, { failed: failure instanceof Error ? failure.message : String(failure) });
      return run();
    }
    if (!this.inStep) {
      // A question the board could not give back: the engine plays alone until it has closed.
      this.bringBack();
      return compare.answer ? (engines as T) : run();
    }
    const pages = run();
    recordAsked();
    const answer = compare.answer ? firstDifference(pages, engines, 'answer') : null;
    const board = answer ?? firstDifference(since(boardOf(this.demo), this.logs.ours), since(this.engine.board(), this.logs.theirs), 'board');
    if (board !== null) {
      recordParting(`${call}: ${board.path}`, args, board.game, board.replica);
      this.bringBack();
    }
    // A question asked for its mark on the game (`abilityList`) is answered in the page's shapes.
    return compare.answer ? (engines as T) : pages;
  }

  /** A question the pointer asks: put to both, held to each other; the page's answer, being the same, given. */
  protected override asked<T>(question: string, asked: unknown, game: () => T, replica: (engine: WasmEngine) => unknown, seen: (answer: T) => unknown = (a) => a): T {
    const pages = game();
    if (!this.inStep) return pages;
    let engines: unknown;
    try {
      engines = replica(this.engine);
    } catch (failure) {
      engines = { failed: failure instanceof Error ? failure.message : String(failure) };
    }
    recordAsked();
    const parted = firstDifference(seen(pages), engines, question);
    if (parted !== null) {
      recordParting(`${question}: ${parted.path}`, asked, parted.game, parted.replica);
      this.bringBack();
    }
    return pages;
  }
}

/** An engine ready to hand out at once - a page loading a project cannot wait for one - and refilled after. */
let spare: WasmEngine | null = null;

async function refill(): Promise<void> {
  const module = await engineModule();
  if (module !== null) spare = await WasmEngine.of(module);
}

/** Which game the page plays: `?engine=` says, else the dev server's `VITE_ENGINE`, else the page's own. */
export function engineChosen(): 'wasm' | 'ts' {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('engine');
  if (asked === 'wasm' || asked === 'ts') return asked;
  return import.meta.env['VITE_ENGINE'] === 'wasm' ? 'wasm' : 'ts';
}

/** The game the page plays, now: the engine's when it is chosen and one is ready, else the page's own. */
export function gameFor(demo: DemoScene): GameClient & LocalPowers {
  if (engineChosen() === 'wasm' && spare !== null) {
    const engine = spare;
    spare = null;
    void refill();
    return new WasmGame(demo, engine, shippedContent());
  }
  return new LocalGame(demo);
}

/** The game the page boots with, once the engine - when it is chosen - is ready. */
export async function gameReady(demo: DemoScene): Promise<GameClient & LocalPowers> {
  if (engineChosen() === 'wasm') await refill();
  return gameFor(demo);
}
