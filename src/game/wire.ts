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
 *
 * A connection that drops loses what was on its way; the page plays on, sending nothing, and the wire
 * connects again after a while, and again, longer each time (`RETRIES`), and asks for the game the server kept
 * (`resume`, for ten minutes after a socket closes): kept, of this project, it is told the page's game, which
 * went on without it; gone, a fresh one is opened and told it. A page reloaded asks first for the game kept
 * (`resume`): kept, of this project, the page is stood where that game is (`resumed`), and the seed is the one
 * it was played with; else a game is opened as for any page.
 *
 * A question the server's game holds - a roll a script waits on, a defender asked how a hit lands, a line of a
 * conversation - the page's game cannot be given back: it is a script paused part-way, which no board carries.
 * So the page shows it from the server's board (`shownFrom`: what the views read of a question, and no runner),
 * and the answer is not played on the page but sent up (`asked`) without predicting it; the server's game plays
 * it, and the page is stood where its board says after - the next question shown the same way, or none.
 */

import { boardOf, restoreFromBoard, rollsOf, shownFrom, type BoardSnapshot } from './board';
import type { DemoScene } from './demo-scene';
import { openContainer } from './prop-use';
import { replicaOf } from './replica';
import { firstDifference, recordAsked, recordParting, since } from './shadow';
import { talkingAside } from './talks';
import type { SaveSlot } from './save-slots';

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
 * `parted` (waiting for what is on its way up), `asked` (the page showing a question the server's game holds),
 * `out` of step (to be told the page's game), `lost` (the connection dropped, and trying again), `closed`.
 */
export type WireState = 'opening' | 'fresh' | 'in' | 'parted' | 'asked' | 'out' | 'lost' | 'closed';

/** How long to wait before each try to connect again, in milliseconds; when they are spent the wire closes. */
export const RETRIES: readonly number[] = [500, 1000, 2000, 4000, 8000, 15000, 30000];

export interface WireOptions {
  /** Come back to the game the server kept rather than open one: the page was reloaded. */
  resume?: boolean;
  /** The waits between tries to connect again (`RETRIES`), and how a wait is waited - for a test. */
  retries?: readonly number[];
  later?: (run: () => void, ms: number) => void;
}

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
  private transport: Transport;
  /** Which connection a message went by: a drop is the drop of the one it is. */
  private connection = 0;
  private tries = 0;
  /** The editor changed the game while the connection was down: a fresh game when it is back. */
  private stale = false;
  /** The page showing a question the server's game holds (`shownFrom`), and an answer to it on its way up. */
  private showing = false;
  private answering = false;
  /** Whether the page came back to the game the server kept (a reload). */
  resumed = false;
  /** The server's game opened, and the page's dice going on from its - or the page come back to the game kept. */
  readonly ready: Promise<void>;

  constructor(private readonly connect: () => Transport, private readonly demo: DemoScene, private readonly shipped: unknown, private readonly options: WireOptions = {}) {
    this.transport = connect();
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    if (this.options.resume === true && (await this.comeBack())) return;
    await this.open();
  }

  /** A page reloaded: stood where the game the server kept is, if it can be. Whether there is nothing more to do. */
  private async comeBack(): Promise<boolean> {
    let said: Said;
    try {
      said = await this.transport.send({ op: 'resume' });
    } catch {
      this.state = 'closed';
      return true;
    }
    if (this.state !== 'opening') return true;
    const kept = said.ok as { board: BoardSnapshot; project: unknown } | undefined;
    if (kept === undefined || kept.project !== this.demo.project.id || !this.standAt(kept.board)) return false;
    this.resumed = true;
    return true;
  }

  /** The game it is the wire of: told when the page's game was changed under it (`LocalGame.edited`). */
  attach(retell: () => void): void {
    this.retell = retell;
  }

  status(): WireState {
    return this.state;
  }

  /** Closed, whatever was on its way held to nothing: a project loaded closes the last game's wire mid-telling. */
  close(): void {
    this.release();
    this.nextEpoch();
    this.state = 'closed';
    this.transport.close();
  }

  /** A game opened over the page's project and table - and its dice, which only the tests' server takes. */
  private opening(): Record<string, unknown> {
    return { op: 'open', project: this.demo.project, shipped: this.shipped, table: { animated: this.demo.animated, askDefender: this.demo.askDefender }, rng: this.demo.rng.save() };
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
    if (this.state === 'lost') {
      this.stale = true;
      return;
    }
    this.release();
    this.nextEpoch();
    this.state = 'out';
  }

  /**
   * The page let go of a question the server's game held, which it cannot answer itself: the server's game is
   * gone, closed, or about to be told the page's.
   */
  private release(): void {
    if (!this.showing) return;
    this.showing = false;
    this.answering = false;
    this.demo.pending = null;
  }

  /** Whether the page is showing a question the server's game holds, which it does not play (`whileAsked`). */
  asking(): boolean {
    return this.state === 'asked';
  }

  /**
   * An intent while the server's game holds the question: the answer sent up to it and not played here - the
   * page's game has no script to play it on - and the page stood where the server's board says after; the
   * conversations kept where they are, which a stand-in for a question must not be set aside as; anything
   * else played on the page's game alone, which refuses it as it would with any question open, and not sent.
   */
  whileAsked<T>(call: string, args: readonly unknown[], playHere: () => T): T {
    if (call === 'syncTalks') return false as T;
    if (call !== 'answerPending') return playHere();
    if (this.answering) return { status: 'refused', lines: [] } as T;
    this.answering = true;
    const epoch = this.epoch;
    void this.send({ op: 'call', call, args }).then((said) => {
      if (epoch !== this.epoch || this.state !== 'asked') return;
      this.answering = false;
      const played = said.ok as Played | undefined;
      if (played === undefined) {
        recordParting(`server ${call}: refused`, args, null, { failed: said.error });
        this.release();
        this.state = 'out';
        return;
      }
      if (!this.standAt(played.board)) {
        this.release();
        this.state = 'out';
      }
    });
    return { status: 'waiting', lines: [] } as T;
  }

  /**
   * The page stood where a board of the server's says the game is: a question it holds shown, not played
   * (`asked`); none, and in step. Not when a conversation is set aside, on either side - a runner the board
   * does not carry. Whether it was.
   */
  private standAt(board: BoardSnapshot): boolean {
    const demo = this.demo;
    if (board.aside.length > 0 || talkingAside(demo).length > 0) return false;
    // The question the server's game holds, if one: shown from its board (`restoreFromBoard`, `shownFrom`).
    restoreFromBoard(demo, board);
    this.showing = board.pending !== null;
    this.answering = false;
    // What either side had still to draw is the other's no longer: the page's dropped, the server's drained.
    demo.motions.length = 0;
    demo.floaters.length = 0;
    this.drain();
    this.logs = { ours: demo.log.length, theirs: board.log.length };
    this.state = board.pending === null ? 'in' : 'asked';
    this.retell();
    return true;
  }

  /** Everything sent before now held to nothing. */
  private nextEpoch(): number {
    this.inFlight = 0;
    return ++this.epoch;
  }

  /** The connection dropped: what was on its way is lost with it, and the wire tries to come back. */
  private lose(): void {
    if (this.state === 'closed' || this.state === 'lost') return;
    if (this.state === 'opening') {
      this.state = 'closed';
      return;
    }
    this.nextEpoch();
    this.connection++;
    this.state = 'lost';
    this.retry();
  }

  private retry(): void {
    const wait = (this.options.retries ?? RETRIES)[this.tries++];
    if (wait === undefined) {
      this.release();
      this.state = 'closed';
      return;
    }
    (this.options.later ?? ((run, ms) => void setTimeout(run, ms)))(() => void this.reconnect(), wait);
  }

  /** Connected again: the game the server kept told the page's, or a fresh one opened when it is gone. */
  private async reconnect(): Promise<void> {
    if (this.state !== 'lost') return;
    this.transport = this.connect();
    let said: Said;
    try {
      said = await this.transport.send({ op: 'resume' });
    } catch {
      if (this.state === 'lost') this.retry();
      return;
    }
    if (this.state !== 'lost') return;
    this.tries = 0;
    const kept = said.ok as { board: BoardSnapshot; project: unknown } | undefined;
    const same = kept !== undefined && kept.project === this.demo.project.id && !this.stale;
    this.stale = false;
    // A question the server's game held, shown here: still held, shown again where the game now is; gone, let go.
    if (this.showing) {
      if (same && this.standAt(kept.board)) return;
      this.release();
    }
    this.state = same ? 'fresh' : 'out';
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
    const epoch = this.nextEpoch();
    const told: Promise<Said>[] = [];
    if (this.state === 'out') told.push(this.send(this.opening()));
    told.push(this.send({ op: 'restore', replica: replicaOf(demo) }));
    told.push(this.send({ op: 'call', call: 'restoreRng', args: [demo.rng.save()] }));
    told.push(this.send({ op: 'call', call: 'restoreWalk', args: [demo.ambush, demo.approaching, openContainer(demo), rollsOf(demo)] }));
    told.push(this.send({ op: 'call', call: 'restoreLog', args: [demo.log] }));
    // What the page's views have still to draw - walks it played while the connection was down, say - the
    // server's game holds the same, so the next drain is the same on both.
    told.push(this.send({ op: 'call', call: 'restoreViews', args: [demo.motions, demo.floaters] }));
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

  /**
   * What the server's game holds for a view to draw - the walks to show, the numbers to float - drained: the
   * board does not carry it, and the page's views, stood where its board says rather than having played it,
   * never will.
   */
  private drain(): Promise<Said>[] {
    return [this.send({ op: 'call', call: 'takeMotions', args: [] }), this.send({ op: 'call', call: 'takeFloaters', args: [] })];
  }

  /** An intent the page has played, sent up, and its answer held to the page's, and the board just after. */
  after(call: string, args: readonly unknown[], answer: unknown, compare: { answer: boolean }): void {
    const epoch = this.epoch;
    const ours = this.state === 'in' ? { answer: compare.answer ? copy(answer) : undefined, board: since(boardOf(this.demo), this.logs.ours) } : null;
    this.inFlight++;
    void this.send({ op: 'call', call, args }).then((said) => {
      if (epoch !== this.epoch || this.state === 'closed') return;
      this.inFlight--;
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

  /**
   * The game saved by the server's game, into the account's slot (`account-saves.ts`): its own text, held to
   * the page's by value - key order is not the game's - and what it wrote given back, or `null` if it would
   * not. `null` at once when the server is not in step to save the game the page has.
   */
  save(slot: { id: string; name: string; where: string; project?: string }, text: string): Promise<{ slot: SaveSlot; text: string } | null> | null {
    if (!this.before() || this.state !== 'in') return null;
    const epoch = this.epoch;
    const ours = JSON.parse(text) as unknown;
    return this.send({ op: 'save', slot: slot.id, name: slot.name, where: slot.where, ...(slot.project === undefined ? {} : { project: slot.project }) }).then((said) => {
      const saved = said.ok as { slot: SaveSlot; text: string } | undefined;
      if (saved === undefined) {
        if (epoch === this.epoch) recordParting('server save: refused', [slot.id], null, { failed: said.error });
        return null;
      }
      if (epoch === this.epoch) {
        recordAsked();
        const parted = firstDifference(ours, JSON.parse(saved.text) as unknown, 'save');
        if (parted !== null) recordParting(`server save: ${parted.path}`, [slot.id], parted.game, parted.replica);
      }
      return saved;
    });
  }

  /**
   * After a parting, the last of what was on its way up answered: the page stood where the server's game is -
   * a question it holds shown from its board. A conversation set aside, on either side, the board cannot give
   * back: then the page's game is told the server instead.
   */
  private restoreFrom(board: BoardSnapshot | null): void {
    if (board === null || !this.standAt(board)) this.state = 'out';
  }

  /** A message sent by the connection there is now; that connection gone is the wire lost, and trying again. */
  private send(message: Record<string, unknown>): Promise<Said> {
    const connection = this.connection;
    return this.transport.send(message).catch(() => {
      if (connection === this.connection) this.lose();
      return { error: 'the connection closed' };
    });
  }
}
