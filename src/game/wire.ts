/**
 * The wire (`docs/SERVER.md`, phase 3, slice 3d): the page's game held to the game the server plays.
 *
 * The page plays every intent at once, as it always has, and sends it up as it does (`Transport`, a
 * websocket to `/__play` in the page, `play-socket.ts`); the server plays the same intent in a game of its own
 * and answers with its answer and its board, which are held to the page's own just after it played the same
 * intent - the board snapshot taken then, since more may have been played by the time the answer is back.
 * Where they part, the parting is counted as the mirror's are (`window.__replica`), the rest of what is
 * on its way up is played and not held to anything, and when the last of it is answered the page's game is
 * stood where the server's board says (`restoreFromBoard`) - the page restored from the server.
 *
 * The server's game is opened when the wire is, and the page's dice go on from the server's: the seed is the
 * server's from the start. It is brought into step - told the page's game, as the mirror is - only between
 * questions, which have no form to send: before the first intent, after the editor has changed the game
 * (a fresh game opened over the project as it is now), and after a parting the board could not give back -
 * a question open, a conversation set aside. In development only, and only for somebody signed in.
 */

import { boardOf, restoreFromBoard, rollsOf, type BoardSnapshot } from './board';
import type { DemoScene } from './demo-scene';
import { openContainer } from './prop-use';
import { replicaOf } from './replica';
import { firstDifference, recordAsked, recordParting, since } from './shadow';
import { talkingAside } from './talks';

/** What the server said: what was asked for, or why not. */
export interface Said {
  ok?: unknown;
  error?: string;
}

/** The way to the server's game: each message sent as it is given, the answers back in the same order. */
export interface Transport {
  send(message: Record<string, unknown>): Promise<Said>;
  close(): void;
}

/**
 * Where the wire stands: `opening` the server's game, `fresh` (opened, not yet told the page's), `in` step,
 * `parted` (waiting for what is on its way up), `out` of step (to be told the page's game), `closed`.
 */
export type WireState = 'opening' | 'fresh' | 'in' | 'parted' | 'out' | 'closed';

/** An intent's answer from the server, and its board after. */
interface Played {
  answer: unknown;
  board: BoardSnapshot;
}

const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

export class Wire {
  private state: WireState = 'opening';
  /** Bumped when the server is told the page's game: answers to what was sent before it are held to nothing. */
  private epoch = 0;
  private inFlight = 0;
  private logs = { ours: 0, theirs: 0 };
  private retell: () => void = () => undefined;
  /** The server's game opened, and the page's dice going on from its. */
  readonly ready: Promise<void>;

  constructor(private readonly transport: Transport, private readonly demo: DemoScene, private readonly shipped: unknown) {
    this.ready = this.open();
  }

  /** The game it is the wire of: told when the page's game was changed under it (`LocalGame.edited`). */
  attach(retell: () => void): void {
    this.retell = retell;
  }

  status(): WireState {
    return this.state;
  }

  close(): void {
    this.state = 'closed';
    this.transport.close();
  }

  private opening(): Record<string, unknown> {
    return { op: 'open', project: this.demo.project, shipped: this.shipped, table: { animated: this.demo.animated, askDefender: this.demo.askDefender } };
  }

  private async open(): Promise<void> {
    let said: Said;
    try {
      said = await this.transport.send(this.opening());
    } catch {
      this.state = 'closed';
      return;
    }
    const opened = said.ok as { seed: string; board: BoardSnapshot } | undefined;
    if (this.state !== 'opening') return;
    if (opened === undefined) {
      recordParting('server: open', null, null, { failed: said.error ?? 'no game' });
      this.state = 'closed';
      return;
    }
    // The server's seed, from the start: the page's dice go on from where its game's are.
    this.demo.rng.restore(opened.board.rng);
    this.retell();
    this.state = 'fresh';
  }

  /** The editor changed the page's game, or its project: the server is told it again before the next intent. */
  outOfStep(): void {
    if (this.state === 'opening' || this.state === 'closed') return;
    this.epoch++;
    this.state = 'out';
  }

  /** Before an intent: the server brought into step if it can be; whether the intent is to be sent up. */
  before(): boolean {
    if (this.state === 'fresh' || this.state === 'out') this.bringIntoStep();
    return this.state === 'in' || this.state === 'parted';
  }

  /** The server told the page's game: a fresh one first when it was out of step, so nothing of the old is left. */
  private bringIntoStep(): void {
    const demo = this.demo;
    if (demo.pending !== null || talkingAside(demo).length > 0) return;
    const epoch = ++this.epoch;
    const told: Promise<Said>[] = [];
    if (this.state === 'out') told.push(this.send(this.opening()));
    told.push(this.send({ op: 'restore', replica: replicaOf(demo) }));
    told.push(this.send({ op: 'call', call: 'restoreRng', args: [demo.rng.save()] }));
    told.push(this.send({ op: 'call', call: 'restoreWalk', args: [demo.ambush, demo.approaching, openContainer(demo), rollsOf(demo)] }));
    this.logs = { ours: demo.log.length, theirs: 0 };
    this.state = 'in';
    void Promise.all(told).then((said) => {
      if (epoch !== this.epoch) return;
      const refused = said.find((s) => s.error !== undefined);
      if (refused !== undefined) {
        recordParting('server: in step', null, null, { failed: refused.error });
        this.state = 'out';
        return;
      }
      this.logs.theirs = (said[said.length - 1]!.ok as Played).board.log.length;
    }, () => undefined);
  }

  /** An intent the page has played, sent up, and its answer held to the page's, and the board just after. */
  after(call: string, args: readonly unknown[], answer: unknown, compare: { answer: boolean }): void {
    const epoch = this.epoch;
    const ours = this.state === 'in' ? { answer: compare.answer ? copy(answer) : undefined, board: since(boardOf(this.demo), this.logs.ours) } : null;
    this.inFlight++;
    void this.send({ op: 'call', call, args }).then((said) => {
      this.inFlight--;
      if (epoch !== this.epoch || this.state === 'closed') return;
      const played = said.ok as Played | undefined;
      if (this.state === 'in' && ours !== null) {
        recordAsked();
        const parted =
          played === undefined
            ? { path: 'refused', game: null, replica: said.error }
            : (compare.answer ? firstDifference(ours.answer, played.answer, 'answer') : null) ?? firstDifference(ours.board, since(played.board, this.logs.theirs), 'board');
        if (parted !== null) {
          recordParting(`server ${call}: ${parted.path}`, args, parted.game, parted.replica);
          this.state = 'parted';
        }
      }
      if (this.state === 'parted' && this.inFlight === 0) this.restoreFrom(played?.board ?? null);
    });
  }

  /** After a parting, the last of what was on its way up answered: the page stood where the server's game is. */
  private restoreFrom(board: BoardSnapshot | null): void {
    const demo = this.demo;
    const settled = (b: BoardSnapshot): boolean => b.pending === null && b.aside.length === 0;
    if (board === null || !settled(board) || demo.pending !== null || talkingAside(demo).length > 0) {
      // A question open, or a conversation set aside, on either side: the page's game is told the server instead.
      this.state = 'out';
      return;
    }
    restoreFromBoard(demo, board);
    this.logs = { ours: demo.log.length, theirs: board.log.length };
    this.state = 'in';
    this.retell();
  }

  /** A message sent; a socket gone is the wire closed. */
  private send(message: Record<string, unknown>): Promise<Said> {
    return this.transport.send(message).catch(() => {
      this.state = 'closed';
      return { error: 'the connection closed' };
    });
  }
}
