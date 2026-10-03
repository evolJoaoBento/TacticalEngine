/**
 * The page playing the Rust engine (`docs/SERVER.md`: phase 3, slice 3b; phase 4, slices 1 and 2).
 *
 * `WasmGame` is the page's game wherever the engine is built - in a build as in development. Every intent is
 * played by the engine built to WebAssembly, and the engine's answer is the one the page is given. The page's
 * own game - the `DemoScene` its views read: the HUD, the panels, the board's drawing, the right-click card -
 * is not played: it is filled from the engine's board (`restoreFromBoard`) whenever that has changed since it
 * last was, which the drains every frame leave as it was. A question the engine holds is shown from its board
 * (`shownFrom`), and the conversations set aside are known by who is having them; the engine plays them on.
 *
 * The questions the pointer asks are put to both and held to each other - the page's views over the filled
 * game, and the engine - the page's answer, in the page's shapes, given. The editor still changes the page's
 * game - its project, its ground, its party - and the engine is built again and told the game after.
 *
 * The page's own game plays only when development asks for it (`?engine=ts`, `VITE_ENGINE=ts`) while it is the
 * oracle the Rust is held to, or where the engine was never built (`oracle/local-game.ts`) - loaded by an import
 * only development makes, so a build carries none of its rules (phase 4, slice 3).
 */

import { BOOT } from 'virtual:boot-project';
import { restoreFromBoard, rollsOf, type BoardSnapshot } from './board';
import { GameTable, type GameClient, type LocalPowers, type Plays } from './client';
import type { DemoScene } from './demo-scene';
import { openContainer } from './prop-use';
import { replicaOf } from './replica';
import { engineModule, firstDifference, publishCount, recordAsked, recordParting } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { PlaySocket, serverAccount } from './play-socket';
import { Wire } from './wire';
import { loadAccountSaves } from './account-saves';
import { SaveSlots, browserStore, type SaveShelf } from './save-slots';

export type { GameClient, LocalPowers } from './client';

/** The page's own rules, which a game the engine plays is never given: touched, it says so rather than plays. */
const NO_PLAYS = new Proxy({} as Plays, {
  get(_, rule) {
    throw new Error(`the page's own game plays nothing beside the engine (${String(rule)})`);
  },
});

export class WasmGame extends GameTable {
  /** The engine's board, as written, that the page's game was last stood where it says. */
  private filled = '';

  constructor(demo: DemoScene, private readonly engine: WasmEngine, private readonly shipped: unknown) {
    super(demo);
    this.toldFromThePage();
    publishCount('wasm');
  }

  /** The engine built from the project and told the page's game: at the start, and after the editor's changes. */
  private toldFromThePage(): void {
    this.engine.build(this.demo.project, this.shipped, 'wasm', { animated: this.demo.animated, askDefender: this.demo.askDefender });
    this.engine.restore(replicaOf(this.demo));
    this.engine.call('restoreRng', [this.demo.rng.save()]);
    this.engine.call('restoreWalk', [this.demo.ambush, this.demo.approaching, openContainer(this.demo), rollsOf(this.demo)]);
    this.engine.call('restoreLog', [this.demo.log]);
    this.engine.call('restoreViews', [this.demo.motions, this.demo.floaters]);
    this.filled = this.engine.boardText();
  }

  /** The page's game stood where the engine's board says, if it has changed since the page's last was. */
  private fill(): void {
    const text = this.engine.boardText();
    if (text === this.filled) return;
    this.filled = text;
    restoreFromBoard(this.demo, (JSON.parse(text) as { ok: BoardSnapshot }).ok);
  }

  protected override edited(): void {
    this.toldFromThePage();
  }

  /** An intent: the engine plays it and answers, and the page's game is filled from its board after. */
  protected play<T>(call: string, args: readonly unknown[], run: (plays: Plays) => T, compare: { answer: boolean }): T {
    let engines: unknown;
    try {
      engines = this.engine.call(call, args);
    } catch (failure) {
      // An engine that cannot answer is a parting, and there is no other game here to answer instead.
      recordParting(`${call}: the engine failed`, args, null, { failed: failure instanceof Error ? failure.message : String(failure) });
      throw failure;
    }
    this.fill();
    // A question asked for the mark it leaves on the game (`abilityList`, a container or a thing read) is
    // answered in the page's shapes: read off the page's game, now where the engine's is, which it marks alike.
    return compare.answer ? (engines as T) : run(NO_PLAYS);
  }

  /** A question the pointer asks: put to both, held to each other; the page's answer, being the same, given. */
  protected override asked<T>(question: string, asked: unknown, game: () => T, replica: (engine: WasmEngine) => unknown, seen: (answer: T) => unknown = (a) => a): T {
    const pages = game();
    let engines: unknown;
    try {
      engines = replica(this.engine);
    } catch (failure) {
      engines = { failed: failure instanceof Error ? failure.message : String(failure) };
    }
    recordAsked();
    const parted = firstDifference(seen(pages), engines, question);
    if (parted !== null) recordParting(`${question}: ${parted.path}`, asked, parted.game, parted.replica);
    return pages;
  }
}

/** An engine ready to hand out at once - a page loading a project cannot wait for one - and refilled after. */
let spare: WasmEngine | null = null;

async function refill(): Promise<void> {
  const module = await engineModule();
  if (module !== null) spare = await WasmEngine.of(module);
}

/**
 * Which game the page plays: the engine's, unless development asks for the page's own (`?engine=ts`, or a dev
 * server's `VITE_ENGINE=ts`) while it is the oracle.
 */
export function engineChosen(dev: boolean = import.meta.env.DEV): 'wasm' | 'ts' {
  if (!dev) return 'wasm';
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('engine');
  if (asked === 'wasm' || asked === 'ts') return asked;
  return import.meta.env['VITE_ENGINE'] === 'ts' ? 'ts' : 'wasm';
}

/** Whether the page's game is held to one on the server (`play-socket.ts`): asked once, as the page boots. */
let serverOn = false;
/** The wire of the game the page plays now, closed when another takes its place. */
let wired: Wire | null = null;
/** The game the page boots with being made: the one a reload comes back to the server's game with. */
let booting = false;

/** The account's saves, read from the server as the page boots (`gameReady`); none where it does not keep them. */
let shelf: SaveShelf | null = null;

/**
 * Where the game's saves go: the account's, on the server, when the server plays beside the page - read as the
 * page booted - else the browser's.
 */
export function savesFor(): SaveShelf {
  shelf ??= new SaveSlots(browserStore());
  return shelf;
}

/** The game held to one on the server, when it is to be: a socket of its own, the last game's closed. */
function wireUp(game: GameTable, demo: DemoScene, resume: boolean): void {
  wired?.close();
  wired = null;
  if (!serverOn) return;
  const wire = new Wire(() => new PlaySocket(), demo, shippedContent(), { resume });
  game.wireWith(wire);
  wired = wire;
  publishCount(undefined, () => wire.status());
}

/**
 * The page's own game, the oracle: loaded only in development - the import is one a build drops - when asked for,
 * or where the engine was never built.
 */
let Oracle: (new (demo: DemoScene) => GameTable) | null = null;

async function loadOracle(): Promise<void> {
  if (import.meta.env.DEV && Oracle === null) Oracle = (await import('./oracle/local-game')).LocalGame;
}

/** The game the page plays, now: the engine's when it is chosen and one is ready, else - in development - the page's own. */
export function gameFor(demo: DemoScene): GameClient & LocalPowers {
  let game: GameTable;
  if (engineChosen() === 'wasm' && spare !== null) {
    const engine = spare;
    spare = null;
    void refill();
    game = new WasmGame(demo, engine, shippedContent());
  } else if (Oracle !== null) game = new Oracle(demo);
  else throw new Error('There is no game to play: the engine was not built (npm run wasm).');
  wireUp(game, demo, booting && reloaded());
  return game;
}

/** Whether the page was reloaded rather than opened: a reload comes back to the game the server kept. */
function reloaded(): boolean {
  const entry = typeof performance === 'undefined' ? undefined : (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined);
  return entry?.type === 'reload';
}

/** Whether the game the page booted with came back to the one the server kept, rather than starting afresh. */
export function resumed(): boolean {
  return wired?.resumed ?? false;
}

/** How long the page waits at boot for the server's game, whose seed it plays with, before playing without. */
const OPENING_MS = 3000;

/** The game the page boots with, once the engine - when it is chosen - is ready, and the server's game open. */
export async function gameReady(demo: DemoScene): Promise<GameClient & LocalPowers> {
  const [account] = await Promise.all([serverAccount(BOOT), engineChosen() === 'wasm' ? refill() : null, loadOracle()]);
  serverOn = account !== null;
  booting = true;
  const game = gameFor(demo);
  booting = false;
  const opening = wired === null ? null : Promise.race([wired.ready, new Promise((wait) => setTimeout(wait, OPENING_MS))]);
  const [saves] = await Promise.all([account === null ? null : loadAccountSaves(account.id, () => wired), opening]);
  if (saves !== null) shelf = saves;
  return game;
}
