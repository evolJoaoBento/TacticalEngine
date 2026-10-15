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
 *
 * A game is shared (phase 5, slice 3): its host opened it, others join it with its invitation (`join`), and
 * each page is told the table - who is at it, who plays whom (`SharedTable`; `seat`, the host's). What another
 * page's intent did is pushed to this one (`Transport.listen`): its board, and what it gave to draw - the walks,
 * the numbers over heads, the dice (`Views`) - and the page is stood there with them, at once when nothing of its
 * own is on its way up; else when the last of that is answered, nothing counted as a parting, since the server
 * played the other page's intent between this page's own. The page's own walks, numbers and dice are its own
 * engine's to give its views (`LOCAL`): the server takes its own queues off as it plays (`views` in an answer)
 * and hands them to the others, so they are never sent up, and the dice are not held to the server's board.
 * The server numbers the intents it plays (`seq`), and an answer is held to what the page predicted only when
 * its number says no other page's intent came in between since the board the page predicted on - one that did
 * is no parting, only the page stood where the server's game is.
 */

import { boardOf, restoreFromBoard, shownFrom, type BoardSnapshot } from './board';
import type { DemoScene } from './demo-scene';
import { showRoll } from './log';
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
  /** What the server says unasked - another page's intent, the table changed - given to `heard` as it comes. */
  listen?(heard: (message: Record<string, unknown>) => void): void;
}

/**
 * Who is at a shared game, and who plays whom - a character's id to an account's - as the server says; and whether
 * it has started, which a game opened as a lobby has not until its host says (slice 5).
 */
/** Who may find a game in the list of games to join: everybody, the host's friends, or nobody - its invitation alone. */
export type Visibility = 'public' | 'friends' | 'invite';

export interface SharedTable {
  game: string;
  host: string;
  invite: string;
  members: { id: string; name: string }[];
  seats: Record<string, string>;
  started: boolean;
  /** The seats a save hosted again keeps for players not back yet: theirs as they join, nobody else's to take. */
  kept?: Record<string, { id: string; name: string }>;
  /** Who may find it in the list of games to join. */
  visibility?: Visibility;
  /** Who is at it now, by id: a member not here has left, for now. */
  here?: string[];
}

/** A line said at the table (`play.rs`, `say`): who said it, by id and by name, what, and when. */
export interface ChatLine {
  from: string;
  name: string;
  text: string;
  at: number;
}

/**
 * Whom a game plays for at a shared game: the account, the host, who plays whom, and whether it has started - before
 * then nobody plays anybody (`engine::game::seats`).
 */
export interface Seating {
  you: string;
  host: string;
  seats: Record<string, string>;
  started?: boolean;
}

/** Why a page that is not the host's saves nothing: a shared game's saves are its host's (`play.rs`). */
export const KEPT_BY_HOST = "The host keeps this game's saves.";

/** What an intent gave the pages to draw: the walks, the numbers over heads, the dice (`DemoScene`'s queues). */
export interface Views {
  motions: DemoScene['motions'];
  floaters: DemoScene['floaters'];
  rolls: BoardSnapshot['rolls'];
}

/**
 * The intents that only read the page's own engine for its views - its walks, numbers and dice to draw, the
 * dice shown - which the server's game, taking its own queues off as it plays, is never sent.
 */
export const LOCAL: readonly string[] = ['takeMotions', 'takeFloaters', 'rollShownAt', 'clearRolls'];

/**
 * The intents a page's drawing sends (`DRAWN`, `play.rs`): the conversations put where their talkers' players'
 * selections say, a container's or a thing's state made as it is read. Sent only when they left a mark on the page's
 * game (`did`, `client.ts`) - drawn again and again with nothing new, they are the page's alone. A container's or a
 * thing's is pushed to nobody (`UNTOLD`); a conversation set aside or brought back is, since the others wait on it.
 */
export const DRAWN: readonly string[] = ['readContainer', 'readThing', 'syncTalks'];

/**
 * Where the wire stands: `opening` the server's game, `in` step, `parted` (waiting for what is on its way up,
 * to be stood where the last of it leaves the server's game), `asked` (the page showing a question the server's
 * game holds), `lost` (the connection dropped, and trying again), `closed`.
 */
export type WireState = 'opening' | 'in' | 'parted' | 'asked' | 'lost' | 'closed';

/** How long to wait before each try to connect again, in milliseconds; when they are spent the wire closes. */
export const RETRIES: readonly number[] = [500, 1000, 2000, 4000, 8000, 15000, 30000];

/** How many lines said at the table a page keeps, as the server's game does (`CHAT_KEPT`). */
export const CHAT_KEPT = 100;

export interface WireOptions {
  /** Come back to the game the server kept rather than open one: the page was reloaded. */
  resume?: boolean;
  /** Join the shared game this invitation is to rather than open one (`?join=`). */
  join?: string;
  /** Open the game as a lobby, not started until the page's player starts it (`?host`). */
  lobby?: boolean;
  /** Who may find the lobby in the list of games to join (`?host=public|friends|invite`). */
  visibility?: Visibility;
  /** The waits between tries to connect again (`RETRIES`), and how a wait is waited - for a test. */
  retries?: readonly number[];
  later?: (run: () => void, ms: number) => void;
}

/** An intent's answer from the server, its board after, and how many intents the game has played (`seq`). */
interface Played {
  answer: unknown;
  board: BoardSnapshot;
  seq?: number;
}

/** The game the server kept, the id of the project it was opened over, and who is at it. */
interface Kept {
  board: BoardSnapshot;
  project: unknown;
  table?: SharedTable;
  seq?: number;
  you?: string;
  chat?: ChatLine[];
}

const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

/** A board as it is held to another: its dice left out, since each page shows its own and is handed the others'. */
const held = (board: Partial<BoardSnapshot>): unknown => ({ ...board, rolls: null });

export class Wire {
  private state: WireState = 'opening';
  /** Bumped when the page lets go of the server's game: answers to what was sent before it are held to nothing. */
  private epoch = 0;
  private inFlight = 0;
  /** How many intents the server's game had played at the board the page last stood at, or was in step with. */
  private known = 0;
  private logs = { ours: 0, theirs: 0 };
  private retell: () => void = () => undefined;
  private transport: Transport;
  /** Which connection a message went by: a drop is the drop of the one it is. */
  private connection = 0;
  private tries = 0;
  /** The page showing a question the server's game holds (`shownFrom`), and an answer to it on its way up. */
  private showing = false;
  /** The conversations set aside as the board the page was last stood at gave them: the server's game holds them. */
  private elsewhere: readonly string[] = [];
  private answering = false;
  /** Whether the page came back to the game the server kept (a reload). */
  resumed = false;
  /** Whether the page joined another's game (`?join=`), rather than opening its own. */
  joined = false;
  /** Who is at the game and who plays whom, as the server last said; nobody's told until it is opened. */
  table: SharedTable | null = null;
  /** The account the page plays as, as the server says it. */
  you: string | null = null;
  private tableHeard: ((table: SharedTable) => void)[] = [];
  /** What has been said at the table, oldest first, as the server keeps it - and who is told when it grows. */
  chat: ChatLine[] = [];
  private chatHeard: ((chat: ChatLine[]) => void)[] = [];
  private friendsHeard: ((from: string) => void)[] = [];
  /** What other pages' intents gave to draw while this page's own were on their way up, drawn when it is stood. */
  private waiting: Views[] = [];
  /** The server's game opened, and the page stood where it is - or the page come back to the game kept. */
  readonly ready: Promise<void>;

  constructor(private readonly connect: () => Transport, private readonly demo: DemoScene, private readonly shipped: unknown, private readonly options: WireOptions = {}) {
    this.transport = connect();
    this.hear();
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    if (this.options.join !== undefined) return this.join(this.options.join);
    if (this.options.resume === true && (await this.comeBack())) return;
    if (this.state === 'opening') await this.open();
  }

  /** What the server says unasked, heard on the connection there is now. */
  private hear(): void {
    const connection = this.connection;
    this.transport.listen?.((message) => {
      if (connection === this.connection) this.heard(message);
    });
  }

  /** A page joining a shared game with its invitation: stood where the game is, and told who is at it. */
  private async join(invite: string): Promise<void> {
    let said: Said;
    try {
      said = await this.transport.send({ op: 'join', invite });
    } catch {
      this.state = 'closed';
      return;
    }
    if (this.state !== 'opening') return;
    const joined = said.ok as Kept | undefined;
    if (joined === undefined) {
      recordParting('server: join', null, null, { failed: said.error ?? 'no game' });
      this.close();
      return;
    }
    this.joined = true;
    this.you = joined.you ?? null;
    if (joined.table !== undefined) this.setTable(joined.table);
    this.setChat(joined.chat);
    this.known = joined.seq ?? 0;
    this.opened(joined.board);
  }

  /** Told who is at the game, and who plays whom, whenever that changes - each that asks. */
  onTable(heard: (table: SharedTable) => void): void {
    this.tableHeard.push(heard);
    if (this.table !== null) heard(this.table);
  }

  private setTable(table: SharedTable): void {
    this.table = table;
    for (const heard of this.tableHeard) heard(table);
  }

  /** Told what has been said at the table whenever more is - each that asks. */
  onChat(heard: (chat: ChatLine[]) => void): void {
    this.chatHeard.push(heard);
    if (this.chat.length > 0) heard(this.chat);
  }

  /** Told whenever a friend of the page's player asked, answered, removed or wrote to them - whose doing. */
  onFriends(heard: (from: string) => void): void {
    this.friendsHeard.push(heard);
  }

  /** Everything said at the table, as the server hands it to a page that opens, joins or comes back to the game. */
  private setChat(lines: ChatLine[] | undefined): void {
    if (!Array.isArray(lines)) return;
    this.chat = lines;
    for (const heard of this.chatHeard) heard(this.chat);
  }

  private addChat(line: ChatLine): void {
    this.chat = [...this.chat, line].slice(-CHAT_KEPT);
    for (const heard of this.chatHeard) heard(this.chat);
  }

  /** Something said at the table: `null` once the server has it - everybody else told - or why not. */
  async say(text: string): Promise<string | null> {
    if (this.state !== 'in' && this.state !== 'parted' && this.state !== 'asked') return 'not at a game';
    const said = await this.send({ op: 'say', text });
    const line = (said.ok as { line?: ChatLine } | undefined)?.line;
    if (line === undefined) return said.error ?? 'it was not said';
    this.addChat(line);
    return null;
  }

  /**
   * Whom the page's own engine plays for (`restoreSeating`, `engine::game::seats`): the account the page plays as,
   * the host, who plays whom - as the server last said - so it refuses what the server's game refuses, and keeps
   * the selection among the page's own. Everybody, `null`, until the table is told, and once the wire is closed:
   * a game nobody shares, the editor's playtest among them.
   */
  seating(): Seating | null {
    if (this.state === 'closed') return null;
    return this.table === null || this.you === null ? null : { you: this.you, host: this.table.host, seats: this.table.seats, started: this.table.started };
  }

  /** Whether the page keeps this game's saves: the host's does, and a page at nobody's table. */
  keepsSaves(): boolean {
    return this.state === 'closed' || this.table === null || this.you === null || this.you === this.table.host;
  }

  /** A game opened as a lobby started, as its host says: whether the server took it. Nobody else may. */
  async startGame(): Promise<boolean> {
    if (this.state !== 'in' && this.state !== 'parted' && this.state !== 'asked') return false;
    const said = await this.send({ op: 'start' });
    const table = (said.ok as { table?: SharedTable } | undefined)?.table;
    if (table === undefined) return false;
    this.setTable(table);
    return true;
  }

  /** Who may find the game in the list of games to join, as its host says: whether the server took it. */
  async setVisibility(visibility: Visibility): Promise<boolean> {
    if (this.state !== 'in' && this.state !== 'parted' && this.state !== 'asked') return false;
    const said = await this.send({ op: 'visibility', visibility });
    const table = (said.ok as { table?: SharedTable } | undefined)?.table;
    if (table === undefined) return false;
    this.setTable(table);
    return true;
  }

  /**
   * Who plays a character - an account at the game, or nobody (`null`) - as the host says: whether the server
   * took it. Nobody else may, and the server says so.
   */
  async seat(character: string, account: string | null): Promise<boolean> {
    if (this.state !== 'in' && this.state !== 'parted' && this.state !== 'asked') return false;
    const said = await this.send({ op: 'seat', character, account });
    const table = (said.ok as { table?: SharedTable } | undefined)?.table;
    if (table === undefined) return false;
    this.setTable(table);
    return true;
  }

  /**
   * What the server says unasked. The table changed, or something said, or a friend did something: told. Another page's intent: the page stood where its board
   * says, with what it gave to draw - at once when nothing of this page's own is on its way up, else when the
   * last of that is answered, the boards the answers bring held to nothing (the server played the other page's
   * intent between this page's own, which the page did not).
   */
  private heard(message: Record<string, unknown>): void {
    if (message['table'] !== undefined) this.setTable(message['table'] as SharedTable);
    if (message['chat'] !== undefined) this.addChat(message['chat'] as ChatLine);
    const friend = (message['friends'] as { from?: unknown } | undefined)?.from;
    if (typeof friend === 'string') for (const heard of this.friendsHeard) heard(friend);
    const pushed = message['push'] as { board: BoardSnapshot; views: Views; seq?: number } | undefined;
    if (pushed === undefined || this.state === 'opening' || this.state === 'closed' || this.state === 'lost') return;
    if (this.inFlight > 0) {
      this.waiting.push(pushed.views);
      this.state = 'parted';
      return;
    }
    this.standAt(pushed.board, [...this.takeWaiting(), pushed.views]);
    this.known = pushed.seq ?? this.known;
  }

  /** What other pages gave to draw while this page waited, taken. */
  private takeWaiting(): Views[] {
    return this.waiting.splice(0);
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
    this.you = kept.you ?? null;
    if (kept.table !== undefined) this.setTable(kept.table);
    this.setChat(kept.chat);
    this.known = kept.seq ?? 0;
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

  /** A game opened over the page's project and table - and its dice, which only the tests' server takes; as a lobby, if asked. */
  private opening(): Record<string, unknown> {
    return { op: 'open', project: this.demo.project, shipped: this.shipped, table: { animated: this.demo.animated, askDefender: this.demo.askDefender }, rng: this.demo.rng.save(), ...(this.options.lobby === true ? { lobby: true, ...(this.options.visibility === undefined ? {} : { visibility: this.options.visibility }) } : {}) };
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
    const opened = said.ok as { seed: string; board: BoardSnapshot; table?: SharedTable; seq?: number; you?: string; chat?: ChatLine[] } | undefined;
    if (opened === undefined) {
      recordParting('server: open', null, null, { failed: said.error ?? 'no game' });
      this.close();
      return;
    }
    this.you = opened.you ?? null;
    if (opened.table !== undefined) this.setTable(opened.table);
    this.setChat(opened.chat);
    this.known = opened.seq ?? 0;
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

  /** Whether a conversation set aside is held by the server's game alone: one the page was stood where it is. */
  heldThere(who: string): boolean {
    return this.elsewhere.includes(who);
  }

  /**
   * Intents the page cannot play - a conversation only the server's game holds, set aside or brought back there -
   * sent up with nothing predicted, the page stood where the last of them leaves the server's game, as it is after
   * a parting, none counted.
   */
  unpredicted(calls: readonly (readonly [string, readonly unknown[]])[]): void {
    const epoch = this.epoch;
    this.state = 'parted';
    for (const [call, args] of calls) {
      this.inFlight++;
      void this.send(this.message(call, args)).then((said) => {
        if (epoch !== this.epoch || this.state === 'closed' || this.state === 'lost') return;
        this.inFlight--;
        const played = said.ok as Played | undefined;
        if (played?.seq !== undefined) this.known = played.seq;
        if (played === undefined) recordParting(`server ${call}: refused`, args, null, { failed: said.error });
        if (this.state === 'parted' && this.inFlight === 0) this.restoreFrom(played?.board ?? null);
      });
    }
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
      if (played !== undefined) {
        this.standAt(played.board);
        this.known = played.seq ?? this.known;
        return;
      }
      recordParting(`server ${call}: refused`, args, null, { failed: said.error });
      this.state = 'parted';
      this.standWhereTheServerIs();
    });
    return { status: 'waiting', lines: [] } as T;
  }

  /**
   * The page stood where a board of the server's says the game is: a question it holds shown, not played
   * (`asked`); none, and in step. The conversations set aside known by who is having them - the server's game
   * plays them on. What other pages' intents gave to draw (`views`) given to the page's views to draw; the walks
   * and numbers the page's own engine had still to draw dropped, its own dice still to be shown kept.
   */
  private standAt(board: BoardSnapshot, views: readonly Views[] = []): void {
    const demo = this.demo;
    const own = demo.rolls.slice();
    // The question the server's game holds, if one: shown from its board (`restoreFromBoard`, `shownFrom`).
    restoreFromBoard(demo, board);
    this.showing = board.pending !== null;
    this.answering = false;
    demo.motions.length = 0;
    demo.floaters.length = 0;
    demo.rolls.length = 0;
    demo.rolls.push(...own);
    for (const drawn of views) {
      demo.motions.push(...drawn.motions);
      demo.floaters.push(...drawn.floaters);
      for (const { who, what, roll } of drawn.rolls) showRoll(demo, who, what, roll);
    }
    this.logs = { ours: demo.log.length, theirs: board.log.length };
    this.elsewhere = board.aside;
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
      if (this.inFlight === 0) {
        this.standAt(kept.board, this.takeWaiting());
        this.known = kept.seq ?? this.known;
      }
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
    this.hear();
    const kept = said.ok as Kept | undefined;
    if (kept !== undefined && kept.project === this.demo.project.id) {
      if (kept.table !== undefined) this.setTable(kept.table);
      this.setChat(kept.chat);
      this.standAt(kept.board);
      this.known = kept.seq ?? this.known;
      return;
    }
    // Gone - the server started again - or another project's. Another's game, joined, has ended; this page's
    // own: a fresh game, and the page stood where it is.
    this.release();
    if (this.joined) return this.close();
    let fresh: Said;
    try {
      fresh = await this.transport.send(this.opening());
    } catch {
      if (this.state === 'lost') this.retry();
      return;
    }
    if (this.state !== 'lost') return;
    const opened = fresh.ok as { board: BoardSnapshot; table?: SharedTable; seq?: number; chat?: ChatLine[] } | undefined;
    if (opened === undefined) {
      recordParting('server: open', null, null, { failed: fresh.error ?? 'no game' });
      this.close();
      return;
    }
    if (opened.table !== undefined) this.setTable(opened.table);
    this.setChat(opened.chat);
    this.standAt(opened.board);
    this.known = opened.seq ?? 0;
  }

  /** Before an intent: whether it is to be sent up - behind the opening, too, while the server's game opens. */
  before(): boolean {
    return this.state === 'in' || this.state === 'parted' || this.state === 'opening';
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
    // The page's own views' reads of its own engine: never the server's.
    if (LOCAL.includes(call)) return;
    const epoch = this.epoch;
    const ours = this.state === 'in' ? { answer: compare.answer ? copy(answer) : undefined, board: held(since(boardOf(this.demo), this.logs.ours)) } : null;
    // The number the server's game will give this intent if nothing of another page's comes in between.
    const expected = this.known + this.inFlight + 1;
    this.inFlight++;
    void this.send(this.message(call, args)).then((said) => {
      if (epoch !== this.epoch || this.state === 'closed' || this.state === 'lost') return;
      this.inFlight--;
      const played = said.ok as Played | undefined;
      // Another page's intent came in between: the page predicted on a board the server's game had moved on
      // from - no parting, only the page stood where the game is once the last of its own is answered.
      if (this.state === 'in' && played?.seq !== undefined && played.seq !== expected) this.state = 'parted';
      if (played?.seq !== undefined) this.known = played.seq;
      if (this.state === 'in' && ours !== null) {
        recordAsked();
        const parted =
          played === undefined
            ? { path: 'refused', game: null, replica: said.error }
            : (compare.answer ? firstDifference(ours.answer, played.answer, 'answer') : null) ?? firstDifference(ours.board, held(since(played.board, this.logs.theirs)), 'board');
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
   * not. `null` at once when the server is not in step to save the game the page has. Held to the page's only when
   * no other page's intent was played between the two (the save's `seq`, as the game stood when it saved - or, from
   * a server that does not say, the page's own count): one that was - a drawing one too, which nobody is pushed
   * (`DRAWN`, `play.rs`) - left the server's save of a game the page had not seen, and that is no parting.
   */
  save(slot: { id: string; name: string; where: string; project?: string }, text: string): Promise<{ slot: SaveSlot; text: string } | null> | null {
    if (this.state !== 'in') return null;
    const epoch = this.epoch;
    // Where the game will be once the page's own intents on their way are answered, nobody else's between.
    const expected = this.known + this.inFlight;
    const ours = JSON.parse(text) as unknown;
    return this.send({ op: 'save', slot: slot.id, name: slot.name, where: slot.where, ...(slot.project === undefined ? {} : { project: slot.project }) }).then((said) => {
      const saved = said.ok as { slot: SaveSlot; text: string; seq?: number } | undefined;
      if (saved === undefined) {
        if (epoch === this.epoch) recordParting('server save: refused', [slot.id], null, { failed: said.error });
        return null;
      }
      if (epoch === this.epoch && (saved.seq ?? this.known) === expected && this.state === 'in') {
        recordAsked();
        const parted = firstDifference(ours, JSON.parse(saved.text) as unknown, 'save');
        if (parted !== null) recordParting(`server save: ${parted.path}`, [slot.id], parted.game, parted.replica);
      }
      return { slot: saved.slot, text: saved.text };
    });
  }

  /**
   * After a parting, the last of what was on its way up answered: the page stood where the server's game is -
   * where its board says, or, the last intent refused, where the server says its game is when asked.
   */
  private restoreFrom(board: BoardSnapshot | null): void {
    if (board !== null) this.standAt(board, this.takeWaiting());
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
