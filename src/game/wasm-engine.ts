/**
 * The engine built to WebAssembly, as the page asks it (`docs/SERVER.md`, phase 3, slice 2; the Rust is
 * `server/wasm`): a replica of the game, stood up from the project, told how the game stands after every
 * intent (`replica.ts`), and asked what the pointer asks on every move.
 *
 * The module's face is C: the message is JSON written into memory it lends (`alloc`), handed over
 * (`call`), and the answer read back where `answer_ptr` says, as long as `call` said. Nothing here
 * touches the DOM - the bytes come from whoever has them, `fetch` in the page and the file in a test -
 * so the vitest asks the very `.wasm` the page loads. `npm run wasm` builds it.
 *
 * A project's hooks are the page's to run: the module imports `host.hook`, answered here by running the
 * hook's JavaScript in the prelude QuickJS runs it in on the server (`server/hooks/src/prelude.js`), and a
 * hook's reads come back into the module through `hook_read`, while the call that ran the hook is still
 * inside it. Nothing here may throw back into the module: a throw would leave it mid-call for good, so a
 * hook that fails says so in its answer.
 */

import type { ProjectDoc } from '../engine/scene/schema';
import PRELUDE from '../../server/hooks/src/prelude.js?raw';
import type { Spot } from '../engine/grid/grid';
import type { Replica } from './replica';

interface Face {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(at: number, len: number): void;
  call(at: number, len: number): number;
  answer_ptr(): number;
  hook_read(at: number, len: number): number;
}

/** The prelude's two doors: run a hook, and check that a body compiles. */
interface Prelude {
  run(source: string, effect: boolean, readsJson: string, seed: number, lastRollJson: string): string;
}

/** The prelude, made once per engine with its `__host` - the one way a hook's read leaves it. */
function prelude(host: (name: string, args: string) => string | undefined): Prelude {
  return new Function('__host', `${PRELUDE}\nreturn { run };`)(host) as Prelude;
}

/** The ground a walk reaches: as `reachableTiles` would be drawn, `null` for no limit. */
export interface Reach {
  start: number;
  budget: number | null;
  tiles: number[];
  cost: (number | null)[];
}

/** The line a click would walk (`previewWalk`). */
export interface Preview {
  route: Spot[];
  beyond: Spot[];
  run: boolean;
}

export class WasmEngine {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  private face!: Face;
  private readonly hooks: Prelude;

  private constructor() {
    this.hooks = prelude((name, args) => this.read(name, args));
  }

  /** What the module imports: a hook run. */
  private imports(): WebAssembly.Imports {
    return { host: { hook: (at: number, len: number) => this.hook(at, len) } };
  }

  /** The module stood up from its bytes. */
  static async load(bytes: BufferSource): Promise<WasmEngine> {
    const engine = new WasmEngine();
    const { instance } = await WebAssembly.instantiate(bytes, engine.imports());
    engine.face = instance.exports as unknown as Face;
    return engine;
  }

  /** Another engine from a module already compiled: a game of its own, the compiling done once. */
  static async of(module: WebAssembly.Module): Promise<WasmEngine> {
    const engine = new WasmEngine();
    const instance = await WebAssembly.instantiate(module, engine.imports());
    engine.face = instance.exports as unknown as Face;
    return engine;
  }

  /** Bytes into memory the module lends, and where. */
  private lend(bytes: Uint8Array, prefixed = false): number {
    const at = this.face.alloc(bytes.length + (prefixed ? 4 : 0));
    if (prefixed) new DataView(this.face.memory.buffer).setUint32(at, bytes.length, true);
    new Uint8Array(this.face.memory.buffer, at + (prefixed ? 4 : 0), bytes.length).set(bytes);
    return at;
  }

  /** The module's last answer, as text. */
  private answered(length: number): string {
    return this.decoder.decode(new Uint8Array(this.face.memory.buffer, this.face.answer_ptr(), length));
  }

  /** `host.hook`: the hook run in the prelude, its answer handed back length-first. Never throws. */
  private hook(at: number, len: number): number {
    let said: string;
    try {
      const message = JSON.parse(this.decoder.decode(new Uint8Array(this.face.memory.buffer, at, len))) as { source: string; effect: boolean; reads: unknown; seed: number; last: unknown };
      said = this.hooks.run(message.source, message.effect, JSON.stringify(message.reads), message.seed, JSON.stringify(message.last ?? null));
    } catch (failure) {
      said = JSON.stringify({ ok: false, message: failure instanceof Error ? failure.message : String(failure), queued: [], state: null });
    }
    return this.lend(this.encoder.encode(said), true);
  }

  /** A hook's read of the world, through the module: its answer, or `undefined`. */
  private read(name: string, args: string): string | undefined {
    const text = this.encoder.encode(JSON.stringify({ name, args: JSON.parse(args) as unknown }));
    const at = this.lend(text);
    const length = this.face.hook_read(at, text.length);
    this.face.free(at, text.length);
    return length === 0 ? undefined : this.answered(length);
  }

  /** One message, and its answer; an `{ error }` is thrown. */
  private send(message: unknown): unknown {
    const text = this.encoder.encode(JSON.stringify(message));
    const at = this.lend(text);
    const length = this.face.call(at, text.length);
    this.face.free(at, text.length);
    const answer = JSON.parse(this.answered(length)) as { ok?: unknown; error?: string };
    if (answer.error !== undefined) throw new Error(`the engine: ${answer.error}`);
    return answer.ok ?? null;
  }

  private ask<T>(ask: string, rest: Record<string, unknown> = {}): T {
    return this.send({ op: 'ask', ask, ...rest }) as T;
  }

  /** A game stood up from a project and the content shipped with the page; walked and asked as a page does, or not. */
  build(project: ProjectDoc, shipped: unknown, seed: string, table: { animated?: boolean; askDefender?: boolean } = {}): void {
    this.send({ op: 'build', project, shipped, seed, animated: table.animated === true, askDefender: table.askDefender === true });
  }

  /** An intent, by the page's name for it, and the game's answer (`game/dispatch.rs`). */
  call(name: string, args: readonly unknown[] = []): unknown {
    return this.send({ op: 'call', call: name, args });
  }

  /** How the game stands, as the page reads it (`game/board.rs`). */
  board(): unknown {
    return this.call('board');
  }

  /** Told how the game stands. */
  restore(replica: Replica): void {
    this.send({ op: 'restore', replica });
  }

  reach(budget?: number): Reach {
    return this.ask('reach', budget === undefined ? {} : { budget });
  }

  pressure(): number[] {
    return this.ask('pressure');
  }

  preview(destination: number, aim: Spot, from?: Spot): Preview | null {
    return this.ask('preview', { destination, aim, ...(from === undefined ? {} : { from }) });
  }

  targets(id: string, ability: string): string[] {
    return this.ask('targets', { id, ability });
  }

  tiles(id: string, ability: string): number[] {
    return this.ask('tiles', { id, ability });
  }

  shape(id: string, ability: string, tile: number): string[] {
    return this.ask('shape', { id, ability, tile });
  }

  jumpOffered(): boolean {
    return this.ask('jumpOffered');
  }

  jumpAim(): number[] | null {
    return this.ask('jumpAim');
  }

  jumpReaches(id: string, destination: number, aim?: Spot): boolean {
    return this.ask('jumpReaches', { id, destination, aim: aim ?? null });
  }
}
