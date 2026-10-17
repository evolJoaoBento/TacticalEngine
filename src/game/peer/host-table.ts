/**
 * A peer game's table (`docs/PEER.md`): the host's page as the server is for a shared game (`server/serve/src/play.rs`).
 *
 * There is no server: the host's page keeps the game everybody plays - an engine of its own, built to WebAssembly,
 * beside the one the host's page predicts with - and every page at the game talks to it over a `Link` (`link.ts`):
 * the guests over WebRTC, the host's own page over a port. The table answers what the server answers, in the
 * server's shapes, so the wire (`wire.ts`) and everything that reads the table (`shared-game.ts`, the lobby, the
 * players' panel, the chat) are the same at a peer game as at a server's:
 *
 * - `open` - the host's alone: the game built over the host's project, its dice where the host's page's are (the host
 *   is trusted: it keeps the game), opened as a lobby or not; again, a fresh game, the guests' links closed;
 * - `project` - the project the game is played over, for a guest's page to boot with before it joins;
 * - `join` - the game joined (its invitation is not asked: a link is only ever to this table);
 * - `call`, `ask`, `resume`, `seat`, `start`, `visibility`, `say` - as the server's (`play.rs`), the same refusals;
 * - `load` - the host's alone: the save read from the host's browser (`readSave`), loaded as `loadGameText`, who
 *   played whom in it seated again; `save` is refused - the host's page saves its own game, the guests' nothing,
 *   and what it keeps with the save of who played whom is the table's (`seating`).
 *
 * Who played whom in a save is seated again as the server seats it - each player at the game in their own, the
 * others' kept for them until they come - but a peer player's id is their tab's, new each evening, so a player is
 * known by the name they give as well: a seat kept for an id nobody at the table has is theirs who goes by that id's
 * name (`sameName`), the host among them. The host already takes a guest at their word for who they are.
 *
 * What the server pushes, this pushes: `{ push: { board, views, by, seq } }`, `{ table }`, `{ chat }`. Before
 * anything of an account's is asked of the game, the game is told whom it plays for (`restoreSeating`) and refuses
 * what that account does not play (`engine::game::seats`). Nobody's page tells the game how theirs stands
 * (`NEVER_TOLD`); the test driver's hands (`TEST_HANDS`) are the host's alone, and only when `testHands`.
 *
 * Unlike the server's, a peer game ends with its host's page: nothing is handed on, nothing kept for a guest to come
 * back to but the game itself while the host plays on (a guest connects again with a fresh invitation, and joins).
 */

import type { ChatLine, SharedTable } from '../wire';
import type { Link } from './link';

/** What the table asks of the game it keeps: the engine's face, as the server asks it (`WasmEngine.respond`). */
export interface Responder {
  respond(message: unknown): { ok?: unknown; error?: string };
}

/** A player at the table: an id, which seats name, and the name the others see. */
export interface Member {
  id: string;
  name: string;
}

/** As the server's (`play.rs`): what no page tells the game, the tests' hands, what the game hands on to draw. */
export const NEVER_TOLD: readonly string[] = ['restoreRng', 'restoreWalk', 'restoreLog', 'restoreViews', 'restoreWalked', 'restoreAside', 'restoreSeating', 'loadGameText'];
export const TEST_HANDS: readonly string[] = ['placeAt', 'setGood', 'wound', 'markStress', 'setCondition', 'giveItem', 'grantLevel', 'setCards', 'startEncounter', 'travelTo'];
const VIEWS: readonly [string, string][] = [
  ['motions', 'takeMotions'],
  ['floaters', 'takeFloaters'],
  ['rolls', 'takeRolls'],
];
/** The drawings whose marks are the drawing page's: played and numbered, never pushed (`UNTOLD`, `play.rs`). */
const UNTOLD: readonly string[] = ['readContainer', 'readThing'];
const VISIBILITIES: readonly string[] = ['public', 'friends', 'invite'];
export const CHAT_LONGEST = 500;
/** What a removed guest's page is told before its link is let go (`remove`). */
export const REMOVED = '{"removed":true}';
const CHAT_KEPT = 100;

type Message = Record<string, unknown> & { op?: unknown; id?: unknown };
type Answer = Record<string, unknown> & { ok?: unknown; error?: string };

export interface TableOptions {
  /** A save in the host's browser, by its slot, and who played whom in it; `null` for none. */
  readSave?: (slot: string) => { text: string; seats?: Record<string, string>; names?: Record<string, string> } | null;
  /** Whether the host's page may use the test driver's hands. */
  testHands?: boolean;
  now?: () => number;
  /** Fresh hex, for the game's id and its seed. */
  fresh?: (bytes: number) => string;
}

function freshHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether two names are one player's: alike but for case and the space around them. */
function sameName(a: string | undefined, b: string): boolean {
  return a !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A board as it is compared with the last one handed on: whoever is selected is each page's own. */
function unselected(board: unknown): string {
  const copy = JSON.parse(JSON.stringify(board ?? null)) as { replica?: { party?: { selected?: unknown } } } | null;
  if (copy?.replica?.party !== undefined) copy.replica.party.selected = null;
  return JSON.stringify(copy);
}

/** The selection on a board: `board.replica.party.selected`. */
function selectionOf(board: unknown): unknown {
  return (board as { replica?: { party?: { selected?: unknown } } } | null)?.replica?.party?.selected ?? null;
}

interface Watcher {
  conn: number;
  account: string;
  link: Link;
  host: boolean;
}

export class HostTable {
  private readonly now: () => number;
  private readonly fresh: (bytes: number) => string;
  private built = false;
  private game = '';
  private host: string;
  /** The project's id, and the project itself, for a guest's page to boot with. */
  private project: unknown = null;
  private document: unknown = null;
  private members: string[] = [];
  /** Every name the table has been told, by id: the members', and those a save keeps seats for. */
  private readonly names = new Map<string, string>();
  private seats: Record<string, string> = {};
  private kept: Record<string, string> = {};
  private readonly selected = new Map<string, unknown>();
  /** The links attached, and whose; `watching` those that have asked the game something. */
  private readonly links: Watcher[] = [];
  private watching: Watcher[] = [];
  private started = true;
  private seen = '';
  private visibility = 'invite';
  private chat: ChatLine[] = [];
  /** How many intents the game has played (`seq`). */
  private played = 0;
  private next = 0;

  constructor(
    private readonly engine: Responder,
    host: Member,
    private readonly options: TableOptions = {},
  ) {
    this.host = host.id;
    this.names.set(host.id, host.name);
    this.now = options.now ?? (() => Date.now());
    this.fresh = options.fresh ?? freshHex;
  }

  /** A page at the table: the host's own (`host`), or a guest's, its account the one the link was made for. */
  attach(link: Link, who: Member, host = false): void {
    if (!host && who.id === this.host) {
      link.close();
      return;
    }
    const watcher: Watcher = { conn: ++this.next, account: who.id, link, host };
    this.names.set(who.id, who.name);
    this.links.push(watcher);
    link.onText((text) => {
      let message: Message;
      try {
        message = JSON.parse(text) as Message;
      } catch {
        return;
      }
      if (!isObject(message)) return;
      this.handle(watcher, message);
    });
    link.onClose(() => this.detach(watcher));
  }

  /** Who is at the game now, each once, by id. */
  here(): string[] {
    return [...new Set(this.watching.map((watcher) => watcher.account))].sort();
  }

  /** Whether an account is at the game - its host, or a member not removed. */
  isMember(account: string): boolean {
    return account === this.host || this.members.includes(account);
  }

  /**
   * A guest removed from the game by the host: their pages told so and let go, their seats nobody's (the host plays
   * them), everybody told the table. They come back only as anybody does - the host letting them in. Whether there
   * was such a guest.
   */
  remove(account: string): boolean {
    if (account === this.host || !this.members.includes(account)) return false;
    for (const watcher of this.links.filter((w) => w.account === account)) {
      watcher.link.send(REMOVED);
      watcher.link.close();
    }
    this.members = this.members.filter((member) => member !== account);
    for (const [character, seated] of Object.entries(this.seats)) if (seated === account) delete this.seats[character];
    this.selected.delete(account);
    this.played += 1;
    this.reselect();
    this.push(null, { table: this.table() });
    return true;
  }

  /** The table as the pages are told it. */
  table(): SharedTable {
    const name = (id: string): string => this.names.get(id) ?? id;
    return {
      game: this.game,
      host: this.host,
      invite: '',
      members: this.members.map((id) => ({ id, name: name(id) })),
      seats: { ...this.seats },
      started: this.started,
      visibility: this.visibility as SharedTable['visibility'] & string,
      kept: Object.fromEntries(Object.entries(this.kept).map(([character, id]) => [character, { id, name: name(id) }])),
      here: this.here(),
    };
  }

  private detach(watcher: Watcher): void {
    const at = this.links.indexOf(watcher);
    if (at !== -1) this.links.splice(at, 1);
    const before = JSON.stringify(this.here());
    this.watching = this.watching.filter((w) => w !== watcher);
    if (JSON.stringify(this.here()) !== before && this.watching.length > 0) this.push(null, { table: this.table() });
  }

  /** A link at the game from its first message for it; the others told if its account was not here. */
  private watch(watcher: Watcher, joining: boolean): void {
    if (this.watching.includes(watcher)) return;
    const came = !this.watching.some((w) => w.account === watcher.account);
    this.watching.push(watcher);
    if (came && !joining) this.push(watcher, { table: this.table() });
  }

  /** Something for every page at the game but `except`'s: a pushed board with each page's own selection on it. */
  private push(except: Watcher | null, message: Record<string, unknown>): void {
    for (const watcher of this.watching) {
      if (watcher === except) continue;
      let told = message;
      const pushed = message['push'];
      if (isObject(pushed) && isObject(pushed['board']) && this.selected.has(watcher.account)) {
        const board = JSON.parse(JSON.stringify(pushed['board'])) as { replica?: { party?: { selected?: unknown } } };
        if (board.replica?.party !== undefined) board.replica.party.selected = this.selected.get(watcher.account);
        told = { push: { ...pushed, board } };
      }
      watcher.link.send(JSON.stringify(told));
    }
  }

  private reply(watcher: Watcher, said: Answer, id: unknown): void {
    watcher.link.send(JSON.stringify({ ...said, id }));
  }

  /** Why a message is refused before the game is asked, if it is (`play.rs`, `refused` and `route`). */
  private refused(watcher: Watcher, message: Message): string | null {
    const op = message.op;
    if (op === 'call') {
      const call = typeof message['call'] === 'string' ? message['call'] : '';
      if (NEVER_TOLD.includes(call)) return `"${call}" is never told to the server's game`;
      if (TEST_HANDS.includes(call) && !(watcher.host && this.options.testHands === true)) return `"${call}" is the tests' alone`;
    }
    if (op === 'open') return watcher.host ? null : 'only the host opens the game';
    if (op === 'project') return null;
    if (!this.built) return 'no game: open one';
    if (op === 'join') return null;
    if (!this.members.includes(watcher.account)) return 'no game: open one';
    if (op === 'load' && watcher.account !== this.host) return 'only the host loads a save into a game others are at';
    if (op === 'save') return "the host's page keeps this game's saves";
    return null;
  }

  /** The game told whom it plays for, before it is asked anything of an account's (`play_for`). */
  private playFor(account: string): void {
    if (!this.built) return;
    const seating: Record<string, unknown> = { you: account, host: this.host, seats: this.seats, started: this.started };
    if (this.selected.has(account)) seating['selected'] = this.selected.get(account);
    this.engine.respond({ op: 'call', call: 'restoreSeating', args: [seating] });
  }

  /** Each member's selection kept among their own, after who plays whom changed. */
  private reselect(): void {
    for (const member of this.members) {
      this.playFor(member);
      const board = this.engine.respond({ op: 'call', call: 'board', args: [] }).ok;
      this.selected.set(member, selectionOf(board));
    }
  }

  /** One message from a page, answered, and the others told what it changed - in the order the game played them. */
  private handle(watcher: Watcher, incoming: Message): void {
    const id = incoming.id;
    let message = incoming;
    const why = this.refused(watcher, message);
    if (why !== null) return this.reply(watcher, { error: why }, id);
    const op = typeof message.op === 'string' ? message.op : '';
    if (op === 'project') return this.reply(watcher, this.built ? { ok: { project: this.document } } : { error: 'no game: the host has not opened one' }, id);
    if (op === 'load') {
      const save = this.options.readSave?.(typeof message['slot'] === 'string' ? message['slot'] : '') ?? null;
      if (save === null) return this.reply(watcher, { error: 'no such save' }, id);
      message = { op: 'call', call: 'loadGameText', args: [save.text], keep: save.seats ?? {}, names: save.names ?? {} };
    }
    if (op === 'open') this.reset(watcher, message);
    if (op === 'join' && !this.members.includes(watcher.account)) {
      this.members.push(watcher.account);
      this.seatTheKept(watcher.account);
    }
    const effective = typeof message.op === 'string' ? message.op : '';
    this.watch(watcher, effective === 'open' || effective === 'join');
    const account = watcher.account;
    if (!['open', 'seat', 'start', 'visibility', 'say'].includes(effective)) this.playFor(account);
    let said: Answer;
    switch (effective) {
      case 'seat':
        said = this.seat(account, message);
        break;
      case 'start':
        said = this.start(account);
        break;
      case 'visibility':
        said = this.changeVisibility(account, message);
        break;
      case 'say':
        said = this.say(account, message);
        break;
      case 'join':
      case 'resume':
        said = this.built ? { ok: { board: this.board() } } : { error: 'no game to resume' };
        break;
      case 'open':
        said = this.open(message);
        break;
      case 'call':
        said = this.call(message);
        break;
      case 'ask':
        said = this.engine.respond(message) as Answer;
        break;
      default:
        said = { error: effective === '' ? 'no op' : `no op "${effective}"` };
    }
    const ok = isObject(said.ok) ? said.ok : null;
    if (effective === 'call' && ok !== null) this.played += 1;
    if (effective === 'open' && ok !== null) {
      this.playFor(account);
      ok['board'] = this.board();
    }
    if (['call', 'open', 'join', 'resume'].includes(effective) && ok !== null) {
      ok['seq'] = this.played;
      this.selected.set(account, selectionOf(ok['board']));
    }
    if (['open', 'join', 'resume'].includes(effective) && ok !== null) {
      ok['project'] = this.project;
      ok['table'] = this.table();
      ok['you'] = account;
      ok['chat'] = [...this.chat];
      if (effective === 'open') {
        ok['game'] = this.game;
        ok['invite'] = '';
      }
    }
    this.reply(watcher, said, id);
    const reseated = effective === 'call' && ok !== null && isObject(message['keep']) && this.keep(message['keep'], isObject(message['names']) ? message['names'] : {});
    if ((reseated || effective === 'seat' || effective === 'start') && ok !== null) {
      this.played += 1;
      this.reselect();
    }
    if ((effective === 'call' || effective === 'open') && ok !== null && !UNTOLD.includes(String(message['call'] ?? ''))) {
      const board = unselected(ok['board']);
      const views = isObject(ok['views']) ? ok['views'] : {};
      const drawn = VIEWS.some(([name]) => Array.isArray(views[name]) && (views[name] as unknown[]).length > 0);
      if (board !== this.seen || drawn) {
        this.seen = board;
        if (effective === 'call') this.push(watcher, { push: { board: ok['board'], views, by: account, seq: this.played } });
      }
    }
    if (['join', 'seat', 'start', 'visibility'].includes(effective) && ok !== null) this.push(watcher, { table: this.table() });
    if (effective === 'say' && ok !== null) this.push(watcher, { chat: ok['line'] });
    if (reseated) this.push(null, { table: this.table() });
  }

  private board(): unknown {
    return this.engine.respond({ op: 'call', call: 'board', args: [] }).ok ?? null;
  }

  /** A fresh game, opened by the host: whoever was at the last one let go. */
  private reset(watcher: Watcher, message: Message): void {
    for (const other of [...this.links]) if (other !== watcher) other.link.close();
    this.game = this.fresh(8);
    this.project = isObject(message['project']) ? (message['project']['id'] ?? null) : null;
    this.document = message['project'] ?? null;
    this.members = [watcher.account];
    this.seats = {};
    this.kept = {};
    this.selected.clear();
    this.watching = this.watching.filter((w) => w === watcher);
    this.started = message['lobby'] !== true;
    this.visibility = typeof message['visibility'] === 'string' && VISIBILITIES.includes(message['visibility']) ? message['visibility'] : 'invite';
    this.seen = '';
    this.chat = [];
    this.played = 0;
  }

  private open(message: Message): Answer {
    const seed = this.fresh(8);
    const table = isObject(message['table']) ? message['table'] : {};
    const built = this.engine.respond({ op: 'build', project: message['project'], shipped: message['shipped'], seed, animated: table['animated'], askDefender: table['askDefender'] });
    if (built.error !== undefined) {
      this.built = false;
      return { error: built.error };
    }
    this.built = true;
    if (typeof message['rng'] === 'number') {
      const restored = this.engine.respond({ op: 'call', call: 'restoreRng', args: [message['rng']] });
      if (restored.error !== undefined) return { error: restored.error };
    }
    return { ok: { seed, board: this.board() } };
  }

  private call(message: Message): Answer {
    const call = typeof message['call'] === 'string' ? message['call'] : '';
    const said = this.engine.respond({ op: 'call', call, args: message['args'] });
    if (said.error !== undefined) return { error: said.error };
    const views: Record<string, unknown> = {};
    for (const [name, take] of VIEWS) {
      if (call === take) {
        views[name] = [];
        continue;
      }
      const taken = this.engine.respond({ op: 'call', call: take, args: [] });
      if (taken.error !== undefined) return { error: taken.error };
      views[name] = taken.ok;
    }
    return { ok: { answer: said.ok ?? null, board: this.board(), views } };
  }

  /** Who plays a character, as the server rules it (`play.rs`, `seat`). */
  private seat(account: string, message: Message): Answer {
    const character = typeof message['character'] === 'string' ? message['character'] : '';
    if (character === '') return { error: 'no character' };
    const asked = message['account'];
    if (this.host !== account) {
      if (this.started) return { error: 'only the host says who plays whom' };
      const taking = asked === account && this.seats[character] === undefined && this.kept[character] === undefined;
      const leaving = asked === null && this.seats[character] === account;
      if (!taking && !leaving) return { error: 'only a seat nobody has is yours to take' };
    }
    delete this.kept[character];
    if (typeof asked !== 'string') delete this.seats[character];
    else if (this.members.includes(asked)) this.seats[character] = asked;
    else return { error: 'not at this game' };
    return { ok: { table: this.table() } };
  }

  /**
   * Who played whom in a save just loaded, and their names: theirs again if they are at the game - by their id, or
   * by the name that id went by - else kept for them.
   */
  private keep(keep: Record<string, unknown>, names: Record<string, unknown>): boolean {
    const entries = Object.entries(keep);
    if (entries.length === 0) return false;
    for (const [character, account] of entries) {
      if (typeof account !== 'string') continue;
      delete this.seats[character];
      delete this.kept[character];
      const name = names[account];
      if (typeof name === 'string' && !this.members.includes(account) && !this.names.has(account)) this.names.set(account, name);
      const member = this.members.includes(account) ? account : this.members.find((m) => typeof name === 'string' && sameName(this.names.get(m), name));
      if (member !== undefined) this.seats[character] = member;
      else this.kept[character] = account;
    }
    return true;
  }

  /** The seats kept for an account, theirs now that it has joined - by its id, or by the name it goes by. */
  private seatTheKept(account: string): void {
    const name = this.names.get(account);
    for (const [character, kept] of Object.entries(this.kept)) {
      const theirs = kept === account || (!this.members.includes(kept) && name !== undefined && sameName(this.names.get(kept), name));
      if (!theirs) continue;
      delete this.kept[character];
      if (this.seats[character] === undefined) this.seats[character] = account;
    }
  }

  /** Who plays whom, for the host's save: the seats and those kept for players not back, and everybody's names. */
  seating(): { seats: Record<string, string>; names: Record<string, string> } {
    const seats = { ...this.kept, ...this.seats };
    const names: Record<string, string> = {};
    for (const id of Object.values(seats)) names[id] = this.names.get(id) ?? id;
    return { seats, names };
  }

  private start(account: string): Answer {
    if (this.host !== account) return { error: 'only the host starts the game' };
    if (this.started) return { error: 'the game has started' };
    this.started = true;
    return { ok: { table: this.table() } };
  }

  private changeVisibility(account: string, message: Message): Answer {
    if (this.host !== account) return { error: 'only the host says who may find the game' };
    const visibility = message['visibility'];
    if (typeof visibility !== 'string' || !VISIBILITIES.includes(visibility)) return { error: 'public, friends or invite' };
    this.visibility = visibility;
    return { ok: { table: this.table() } };
  }

  private say(account: string, message: Message): Answer {
    const text = (typeof message['text'] === 'string' ? message['text'] : '').trim();
    if (text === '') return { error: 'nothing said' };
    if ([...text].length > CHAT_LONGEST) return { error: `a line is ${CHAT_LONGEST} characters at most` };
    const line: ChatLine = { from: account, name: this.names.get(account) ?? account, text, at: this.now() };
    this.chat.push(line);
    if (this.chat.length > CHAT_KEPT) this.chat.splice(0, this.chat.length - CHAT_KEPT);
    return { ok: { line } };
  }
}
