/**
 * The page's own TypeScript game, playing (`docs/SERVER.md`, phase 4, slice 3): the oracle the Rust is held to.
 *
 * Every intent is played by the page's own rules (`plays.ts`), on the page's game itself. In development the
 * engine built to WebAssembly is played beside it as a mirror (`shadow.ts`), held to it intent for intent, and
 * put the pointer's questions too. The page plays it only in development, when asked for (`?engine=ts`,
 * `VITE_ENGINE=ts`) or where the engine was never built - loaded by an import a build drops - and the tests and
 * the writers of the golden fixtures play it as they always did.
 */

import { GameTable, type Plays } from '../client';
import type { DemoScene } from '../demo-scene';
import { shadowFor, type Shadow } from '../shadow';
import * as plays from './plays';

export class LocalGame extends GameTable {
  /** The replica the pointer's questions are also put to, once the engine is here; none outside development. */
  private shadow: Shadow | null = null;

  /** `shadowed`: whether the page's dev engine is fetched to mirror it - none, for a test that brings its own. */
  constructor(demo: DemoScene, shadowed = true) {
    super(demo);
    if (shadowed) {
      void shadowFor(demo).then((shadow) => {
        this.shadow = shadow;
      });
    }
  }

  /** For a test: a shadow given rather than fetched. */
  shadowWith(shadow: Shadow): void {
    this.shadow = shadow;
  }

  protected override edited(projectChanged: boolean): void {
    if (projectChanged) this.shadow?.projectChanged();
    else this.shadow?.outOfStep();
  }

  /** An intent played by the page's own rules - and, with a shadow, in step in the engine too, held to each other. */
  protected play<T>(call: string, args: readonly unknown[], run: (plays: Plays) => T, compare: { answer: boolean }): T {
    const ours = (): T => run(plays);
    return this.shadow === null ? ours() : this.shadow.mirror(call, args, ours, compare);
  }

  /** The game's answer - and, with a replica, the replica's beside it, any parting counted. */
  protected override asked<T>(question: string, asked: unknown, game: () => T, replica: Parameters<Shadow['check']>[3], seen?: (answer: T) => unknown): T {
    return this.shadow === null ? game() : this.shadow.check(question, asked, game, replica, seen);
  }
}
