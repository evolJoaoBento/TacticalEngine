/**
 * The engine built to WebAssembly, as the page asks it (`docs/SERVER.md`, phase 3, slice 2; the Rust is
 * `server/wasm`): a replica of the game, stood up from the project, told how the game stands after every
 * intent (`replica.ts`), and asked what the pointer asks on every move.
 *
 * The module's face is C: the message is JSON written into memory it lends (`alloc`), handed over
 * (`call`), and the answer read back where `answer_ptr` says, as long as `call` said. Nothing here
 * touches the DOM - the bytes come from whoever has them, `fetch` in the page and the file in a test -
 * so the vitest asks the very `.wasm` the page loads. `npm run wasm` builds it.
 */

import type { ProjectDoc } from '../engine/scene/schema';
import type { Spot } from '../engine/grid/grid';
import type { Replica } from './replica';

interface Face {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(at: number, len: number): void;
  call(at: number, len: number): number;
  answer_ptr(): number;
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

  private constructor(private readonly face: Face) {}

  /** The module stood up from its bytes. It asks nothing of the page: it imports nothing. */
  static async load(bytes: BufferSource): Promise<WasmEngine> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new WasmEngine(instance.exports as unknown as Face);
  }

  /** Another engine from a module already compiled: a game of its own, the compiling done once. */
  static async of(module: WebAssembly.Module): Promise<WasmEngine> {
    const instance = await WebAssembly.instantiate(module, {});
    return new WasmEngine(instance.exports as unknown as Face);
  }

  /** One message, and its answer; an `{ error }` is thrown. */
  private send(message: unknown): unknown {
    const text = this.encoder.encode(JSON.stringify(message));
    const at = this.face.alloc(text.length);
    new Uint8Array(this.face.memory.buffer, at, text.length).set(text);
    const length = this.face.call(at, text.length);
    this.face.free(at, text.length);
    const answer = JSON.parse(this.decoder.decode(new Uint8Array(this.face.memory.buffer, this.face.answer_ptr(), length))) as { ok?: unknown; error?: string };
    if (answer.error !== undefined) throw new Error(`the engine: ${answer.error}`);
    return answer.ok ?? null;
  }

  private ask<T>(ask: string, rest: Record<string, unknown> = {}): T {
    return this.send({ op: 'ask', ask, ...rest }) as T;
  }

  /** A game stood up from a project and the content shipped with the page. */
  build(project: ProjectDoc, shipped: unknown, seed: string): void {
    this.send({ op: 'build', project, shipped, seed });
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
