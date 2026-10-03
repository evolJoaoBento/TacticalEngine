/**
 * The wire (`docs/SERVER.md`, phase 3, slice 3d; phase 5, slice 1): the page's game held to the game the server
 * plays, which is trusted alone.
 *
 * The page plays every intent at once, as it always has, and sends it up as it does (`Transport`, a
 * websocket to `/__play` in the page, `play-socket.ts`); the server plays the same intent in a game of its own
 * and answers with its answer and its board, which are held to the page's own just after it played the same
 * intent - the board snapshot taken then, since more may have been played by the time the answer is back.
 * Where they part, the parting is counted as the mirror's are (`window.__replica`), the rest of what is
 * on its way up is played and not held to anything, and when the last of it is answered the page's game is
 * stood where the server's board says (`restoreFromBoard`) - the page restored from the server. An intent the
 * server refuses is a parting too, and the page is stood where the server's game is, asked for it (`resume`).
 *
 * The server is never told how the page's game stands: a page out of step is only ever stood where the
 * server's board says. The server's game is opened over the page's project when the wire is, and the page
 * is stood where it says at once - its seed the dice the page goes on with. What the page plays while it is
 * opening is sent up behind the opening, and the page stood where the last of it leaves the server's game. A
 * save is loaded by its slot (`load`): the server loads its own copy, from the account's folder. The editor's
 * changes - the ground, the party, the project's cards, a pack imported - make a game the server's never was:
 * the wire closes, and the editor's playtest is the page's alone. In development only, and only for somebody
 * signed in.
 *
 * A connection that drops loses what was on its way; the page plays on, sending nothing, and the wire
 * connects again after a while, and again, longer each time (`RETRIES`), and asks for the game the server kept
 * (`resume`, for ten minutes after a socket closes): kept, of this project, the page is stood where it is -
 * what it played alone in between undone; gone, a fresh one is opened, and the page stood where that is. A
 * page reloaded asks first for the game kept (`resume`): kept, of this project, the page is stood where that
 * game is (`resumed`); else a game is opened as for any page.
 *
 * A question the server's game holds - a roll a script waits on, a defender asked how a hit lands, a line of a
 * conversation - the page's game cannot be given back: it is a script paused part-way, which no board carries.
 * So the page shows it from the server's board (`shownFrom`: what the views read of a question, and no runner),
 * and the answer is not played on the page but sent up (`asked`) without predicting it; the server's game plays
 * it, and the page is stood where its board says after - the next question shown the same way, or none. A
 * conversation set aside is known by who is having it (`asideFrom`), and the server's game plays it on.
 */

import { boardOf, restoreFromBoard, shownFrom, type BoardSnapshot } from './board';
import type { DemoScene } from './demo-scene';
import { firstDifference, recordAsked, recordParting, since } from './shadow';
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
 * Where the wire stands: `opening` the server's game, `in` step, `parted` (waiting for what is on its way up,
 * to be stood where the last of it leaves the server's game), `asked` (the page showing a question the server's
 * game holds), `lost` (the connection dropped, and trying again), `closed`.
 */
export type WireState = 'opening' | 'in' | 'parted' | 'asked' | 'lost' | 'closed';

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

/** The game the server kept, and the id of the project it was opened over. */
interface Kept {
  board: BoardSnapshot;
  project: unknown;
}

const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

export class Wire {
  private state: WireState = 'opening';
  /** Bumped when the page lets go of the server's game: answers to what was sent before it are held to nothing. */
  private epoch = 0;
  private inFlight = 0;
  private logs = { ours: 0, theirs: 0 };
  private retell: () => void = () => undefined;
  private transport: Transport;
  /** Which connection a message went by: a drop is the drop of the one it is. */
  private connection = 0;
  private tries = 0;
  /** The page showing a question the server's game holds (`shownFrom`), and an answer to it on its way up. */
  private showing = false;
  private answering = false;
  /** Whether the page came back to the game the server kept (a reload). */
  resumed = false;
  /** The server's game opened, and the page stood where it is - or the page come back to the game kept. */
  readonly ready: Promise<void>;

  constructor(private readonly connect: () => Transport, private readonly demo: DemoScene, private readonly shipped: unknown, private readonly options: WireOptions = {}) {
    this.transport = connect();
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    if (this.options.resume === true && (await this.comeBack())) return;
    if (this.state === 'opening') await this.open();
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
    const kept = said.ok as Kept | undefined;
    if (kept === undefined || kept.project !== this.demo.project.id) return false;
    this.resumed = true;
    this.opened(kept.board);
    return true;
  }

  /** The game it is the wire of, told when the page's game was stood somewhere under it. */
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
    if (this.state !== 'opening') return;
    const opened = said.ok as { seed: string; board: BoardSnapshot } | undefined;
    if (opened === undefined) {
      recordParting('server: open', null, null, { failed: said.error ?? 'no game' });
      this.close();
      return;
    }
    this.opened(opened.board);
  }

  /**
   * The server's game open, or come back to: the page stood where it is - unless what the page played while it
   * was opening is still on its way up, when it is stood where the last of that leaves it.
   */
  private opened(board: BoardSnapshot): void {
    if (this.inFlight > 0) this.state = 'parted';
    else this.standAt(board);
  }

  /**
   * The editor changed the page's game, or its project: a game the server's never was, which it is never told.
   * The wire closes, and the editor's playtest is the page's alone. Not while the server's game is opening: the
   * page that opens it builds its ground over the project the opening carries, which changes nothing.
   */
  outOfStep(): void {
    if (this.state === 'opening') return;
    this.close();
  }

  /** The page let go of a question the server's game held, which it cannot answer itself. */
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
      if (played !== undefined) return this.standAt(played.board);
      recordParting(`server ${call}: refused`, args, null, { failed: said.error });
      this.state = 'parted';
      this.standWhereTheServerIs();
    });
    return { status: 'waiting', lines: [] } as T;
  }

  /**
   * The page stood where a board of the server's says the game is: a question it holds shown, not played
   * (`asked`); none, and in step. The conversations set aside known by who is having them - the server's game
   * plays them on.
   */
  private standAt(board: BoardSnapshot): void {
    const demo = this.demo;
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
  }

  /**
   * The server's game asked where it is, and the page stood there - counted as on its way up, so the page is
   * stood where the last of what went after it leaves the server's game, if more did. Gone, the wire closes.
   */
  private standWhereTheServerIs(): void {
    const epoch = this.epoch;
    this.inFlight++;
    void this.send({ op: 'resume' }).then((said) => {
      if (epoch !== this.epoch || this.state === 'closed' || this.state === 'lost') return;
      this.inFlight--;
      const kept = said.ok as Kept | undefined;
      if (kept === undefined) {
        recordParting('server: resume', null, null, { failed: said.error ?? 'no game' });
        this.close();
        return;
      }
      if (this.inFlight === 0) this.standAt(kept.board);
    });
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

  /** Connected again: the page stood where the game the server kept is, or where a fresh one opened is. */
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
    const kept = said.ok as Kept | undefined;
    if (kept !== undefined && kept.project === this.demo.project.id) return this.standAt(kept.board);
    // Gone - the server started again - or another project's: a fresh game, and the page stood where it is.
    this.release();
    let fresh: Said;
    try {
      fresh = await this.transport.send(this.opening());
    } catch {
      if (this.state === 'lost') this.retry();
      return;
    }
    if (this.state !== 'lost') return;
    const opened = fresh.ok as { board: BoardSnapshot } | undefined;
    if (opened === undefined) {
      recordParting('server: open', null, null, { failed: fresh.error ?? 'no game' });
      this.close();
      return;
    }
    this.standAt(opened.board);
  }

  /** Before an intent: whether it is to be sent up - behind the opening, too, while the server's game opens. */
  before(): boolean {
    return this.state === 'in' || this.state === 'parted' || this.state === 'opening';
  }

  /**
   * What the server's game holds for a view to draw - the walks to show, the numbers to float - drained: the
   * board does not carry it, and the page's views, stood where its board says rather than having played it,
   * never will.
   */
  private drain(): Promise<Said>[] {
    return [this.send({ op: 'call', call: 'takeMotions', args: [] }), this.send({ op: 'call', call: 'takeFloaters', args: [] })];
  }

  /**
   * How an intent is sent up: as it was played - but a save, loaded by its slot, which the server reads from the
   * account's own folder rather than being told its text.
   */
  private message(call: string, args: readonly unknown[]): Record<string, unknown> {
    if (call === 'loadGameText') return { op: 'load', slot: args[1] };
    return { op: 'call', call, args };
  }

  /** An intent the page has played, sent up, and its answer held to the page's, and the board just after. */
  after(call: string, args: readonly unknown[], answer: unknown, compare: { answer: boolean }): void {
    const epoch = this.epoch;
    const ours = this.state === 'in' ? { answer: compare.answer ? copy(answer) : undefined, board: since(boardOf(this.demo), this.logs.ours) } : null;
    this.inFlight++;
    void this.send(this.message(call, args)).then((said) => {
      if (epoch !== this.epoch || this.state === 'closed' || this.state === 'lost') return;
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
    if (this.state !== 'in') return null;
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
   * where its board says, or, the last intent refused, where the server says its game is when asked.
   */
  private restoreFrom(board: BoardSnapshot | null): void {
    if (board !== null) this.standAt(board);
    else this.standWhereTheServerIs();
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
