/**
 * The server's game for the wire's tests (`src/game/wire.test.ts`): the very `.wasm` the page loads standing in for
 * the server's, answering as `serve::play` does - and what the tests hold the two games to each other with.
 */

import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDocument } from '../../src/engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../../src/engine/scene/schema';
import { boardOf, type BoardSnapshot } from '../../src/game/board';
import type { DemoScene } from '../../src/game/demo-scene';
import { firstDifference } from '../../src/game/shadow';
import type { WasmEngine } from '../../src/game/wasm-engine';
import { LOCAL, type ChatLine, type Said, type SharedTable, type Transport, type Visibility } from '../../src/game/wire';

const here = dirname(fileURLToPath(import.meta.url));

/** What the server's game is never told (`serve::play::NEVER_TOLD`): how another game stands, or a save's text. */
export const NEVER_TOLD = ['restoreRng', 'restoreWalk', 'restoreLog', 'restoreViews', 'restoreWalked', 'restoreSeating', 'loadGameText'];

/** The drawings pushed to nobody (`serve::play::UNTOLD`): a container's or a thing's state made as it is read. */
export const UNTOLD = ['readContainer', 'readThing'];

/**
 * The server's game, answering a tick late and in order, a seed of its own at every open as the server's are;
 * `meddle` changes its game behind the page's back, `reword` what it answers, `refuse` an intent outright, and
 * `noisy` has a game opened with lines already in its log. Its saves are the account's, kept across its games.
 * Its game is shared, as the server's are: each intent's answer carries what it gave to draw, taken off the
 * game's queues (`views`), and is pushed to every other connection that listens; `join` and `seat` as `play.rs`.
 * Unlike `play.rs` it pushes a board that changed nothing - a selection alone - so a page here can be told what the
 * server's would not tell it: what a page is pushed is `play_routes.rs`'s to prove.
 * And as `play.rs`, its game is told whom it plays for before each message (`restoreSeating`): the connection's
 * account - the host's for the one that opened it, a guest's for each that joined - and that account's own
 * selection, kept between its messages and put on every board it is pushed.
 */
export class EngineServer implements Transport {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  /** Messages refused because the server was closed. */
  refused = 0;
  /** Messages sent and not yet answered. */
  out = 0;
  /** The project the game kept is of, as the server's tables keep it; `null` once it has gone. */
  kept: unknown = null;
  noisy = false;
  meddle: ((engine: WasmEngine, calls: number) => void) | null = null;
  reword: ((answer: unknown, calls: number) => unknown) | null = null;
  /** A save's text changed on its way back, or a save refused outright. */
  rewordSave: ((text: string) => string) | null = null;
  refuseSave: string | null = null;
  /** Another page's intent, played just before a save is: numbered, and pushed to every page - or, a drawing one, not. */
  meanwhile: { play: (engine: WasmEngine) => void; pushed: boolean } | null = null;
  refuse: ((call: string, calls: number) => boolean) | null = null;
  /** The account's saves, by slot, as the server's folder keeps them. */
  readonly saves = new Map<string, string>();
  /** Who is at the game and who plays whom, as the server keeps it; and each connection's ear, by its number. */
  table: SharedTable = { game: 'g', host: 'host', invite: 'invite-1', members: [{ id: 'host', name: 'Host' }], seats: {}, started: true };
  private readonly ears = new Map<number, (message: Record<string, unknown>) => void>();
  /** Whose each connection is, and whom each account last had selected. */
  private readonly accounts = new Map<number, string>();
  private readonly selected = new Map<string, unknown>();
  /** What has been said at the table. */
  chat: ChatLine[] = [];
  private connections = 0;
  /** The intents the game has played, as the server numbers them (`seq`). */
  private played = 0;
  private calls = 0;
  private opens = 0;

  constructor(readonly engine: WasmEngine, private readonly seed = 'the-server') {}

  send(message: Record<string, unknown>, from = 0): Promise<Said> {
    if (this.closed) {
      this.refused++;
      return Promise.reject(new Error('closed'));
    }
    // Written out now, as the socket does: what is told is how the game stood when it was given.
    const text = JSON.stringify(message);
    this.out++;
    return new Promise((answered) =>
      setTimeout(() => {
        this.out--;
        answered(this.answer(JSON.parse(text) as Record<string, unknown>, from));
      }, 0),
    );
  }

  listen(heard: (message: Record<string, unknown>) => void): void {
    this.ears.set(0, heard);
  }

  /**
   * Something told every listening connection but the one whose message it answers, as the game plays it: before
   * any answer to a message the game plays after, as each connection's one queue on the server keeps them.
   */
  private push(from: number, message: Record<string, unknown>): void {
    for (const [connection, heard] of this.ears) {
      if (connection === from) continue;
      const told = JSON.parse(JSON.stringify(message)) as { push?: { board: BoardSnapshot } };
      const account = this.accountOf(connection);
      if (told.push !== undefined && this.selected.has(account)) (told.push.board.replica.party as { selected: unknown }).selected = this.selected.get(account);
      heard(told as Record<string, unknown>);
    }
  }

  /** Something told an account's connections alone, from outside the game - a friend's doing (`Tables::tell`). */
  tell(account: string, message: Record<string, unknown>): void {
    for (const [connection, heard] of this.ears) if (this.accountOf(connection) === account) heard(JSON.parse(JSON.stringify(message)) as Record<string, unknown>);
  }

  private accountOf(connection: number): string {
    return this.accounts.get(connection) ?? 'host';
  }

  /** The game told whom it plays for, as `play.rs` tells it before anything of an account's is asked of it. */
  private playFor(account: string): void {
    const seating: Record<string, unknown> = { you: account, host: this.table.host, seats: this.table.seats, started: this.table.started };
    if (this.selected.has(account)) seating['selected'] = this.selected.get(account);
    this.engine.call('restoreSeating', [seating]);
  }

  /** The game's board as an account's page is handed it: with that account's own selection on it. */
  boardFor(account: string): BoardSnapshot {
    const board = this.engine.board() as BoardSnapshot;
    if (this.selected.has(account)) (board.replica.party as { selected: unknown }).selected = this.selected.get(account);
    return board;
  }

  /** Whom the account has selected after a message, kept for its next. */
  private chose(account: string): void {
    this.selected.set(account, (this.engine.board() as BoardSnapshot).replica.party.selected);
  }

  /** What an intent gave to draw, taken off the game's queues, as the server takes it. */
  private views(call = ''): Record<string, unknown> {
    const take = (name: string) => (call === name ? [] : this.engine.call(name, []));
    return { motions: take('takeMotions'), floaters: take('takeFloaters'), rolls: take('takeRolls') };
  }

  close(): void {
    this.closed = true;
  }

  /**
   * A connection of its own to this server's game, which can drop - what is on its way lost with it, and whoever
   * holds it told it closed, as a socket says so.
   */
  connection(): Transport & { drop: () => void } {
    let dropped = false;
    let shut: ((opened: boolean) => void) | null = null;
    const waiting = new Set<(why: Error) => void>();
    const number = ++this.connections;
    return {
      listen: (heard) => this.ears.set(number, (message) => {
        if (!dropped) heard(message);
      }),
      onClose: (then) => (shut = then),
      send: (message) => {
        if (dropped) return Promise.reject(new Error('dropped'));
        return new Promise<Said>((answer, fail) => {
          waiting.add(fail);
          void this.send(message, number).then(
            (said) => {
              waiting.delete(fail);
              if (!dropped) answer(said);
            },
            (why: Error) => {
              waiting.delete(fail);
              fail(why);
            },
          );
        });
      },
      close: () => undefined,
      drop: () => {
        dropped = true;
        this.ears.delete(number);
        for (const fail of waiting) fail(new Error('dropped'));
        waiting.clear();
        shut?.(true);
      },
    };
  }

  private answer(m: Record<string, unknown>, from: number): Said {
    this.sent.push(m);
    const engine = this.engine;
    if (m['op'] === 'join') this.accounts.set(from, `guest-${from}`);
    const you = this.accountOf(from);
    try {
      if (m['op'] !== 'open' && m['op'] !== 'seat' && m['op'] !== 'start' && m['op'] !== 'visibility' && m['op'] !== 'say' && this.kept !== null) this.playFor(you);
      switch (m['op']) {
        case 'open': {
          const seed = `${this.seed}:${++this.opens}`;
          engine.build(m['project'] as ProjectDoc, m['shipped'], seed, m['table'] as { animated: boolean; askDefender: boolean });
          // A rest writes its lines; what else it does, the page's game told after puts back.
          if (this.noisy) engine.call('rest', ['short']);
          this.kept = (m['project'] as ProjectDoc).id;
          this.played = 0;
          this.accounts.set(from, this.table.host);
          this.selected.clear();
          // A lobby, not started until its host says; told whom it plays for at once, as `play.rs` tells it.
          this.table = { ...this.table, started: m['lobby'] !== true, visibility: (m['visibility'] as Visibility | undefined) ?? 'invite' };
          this.playFor(this.table.host);
          this.chose(you);
          return { ok: { seed, board: engine.board(), table: this.table, game: this.table.game, invite: this.table.invite, seq: 0, you } };
        }
        case 'join': {
          if (m['invite'] !== this.table.invite || this.kept === null) return { error: 'no game for that invitation' };
          this.table = { ...this.table, members: [...this.table.members, { id: `guest-${from}`, name: `Guest ${from}` }] };
          this.push(from, { table: this.table });
          this.chose(you);
          return { ok: { board: engine.board(), project: this.kept, table: this.table, seq: this.played, you, chat: this.chat } };
        }
        case 'seat': {
          // The host's to say; before the start, anybody takes a seat nobody has or leaves their own.
          const character = m['character'] as string;
          if (you !== this.table.host) {
            if (this.table.started) return { error: 'only the host says who plays whom' };
            const taking = m['account'] === you && this.table.seats[character] === undefined;
            const leaving = m['account'] === null && this.table.seats[character] === you;
            if (!taking && !leaving) return { error: 'only a seat nobody has is yours to take' };
          }
          const seats = { ...this.table.seats };
          if (m['account'] === null) delete seats[m['character'] as string];
          else seats[m['character'] as string] = m['account'] as string;
          this.table = { ...this.table, seats };
          // Each account's selection kept among its own, as `play.rs` keeps it when who plays whom changes - and
          // numbered as an intent is.
          this.played++;
          for (const member of this.table.members) {
            this.playFor(member.id);
            this.chose(member.id);
          }
          this.push(from, { table: this.table });
          return { ok: { table: this.table } };
        }
        case 'start': {
          if (you !== this.table.host) return { error: 'only the host starts the game' };
          if (this.table.started) return { error: 'the game has started' };
          this.table = { ...this.table, started: true };
          this.played++;
          for (const member of this.table.members) {
            this.playFor(member.id);
            this.chose(member.id);
          }
          this.push(from, { table: this.table });
          return { ok: { table: this.table } };
        }
        case 'say': {
          // Said at the table, as `play.rs` keeps it: the line given back, every other page told.
          const line: ChatLine = { from: you, name: you, text: String(m['text']).trim(), at: this.chat.length + 1 };
          if (line.text === '') return { error: 'nothing said' };
          this.chat = [...this.chat, line];
          this.push(from, { chat: line });
          return { ok: { line } };
        }
        case 'visibility': {
          // Who may find it: the host's to say, as `play.rs` rules it.
          if (you !== this.table.host) return { error: 'only the host says who may find the game' };
          this.table = { ...this.table, visibility: m['visibility'] as Visibility };
          this.push(from, { table: this.table });
          return { ok: { table: this.table } };
        }
        case 'save': {
          if (you !== this.table.host) return { error: "the host keeps this game's saves" };
          // The game saves itself, as a game on the server does (`play.rs`), unless it may not now.
          const blocked = this.refuseSave ?? (engine.call('saveBlockedBy', []) as string | null);
          if (blocked !== null) return { error: blocked };
          if (this.meanwhile !== null) {
            this.meanwhile.play(engine);
            const seq = ++this.played;
            if (this.meanwhile.pushed) this.push(-1, { push: { board: engine.board(), views: this.views(), by: 'another', seq } });
          }
          const text = engine.call('serialiseSave', []) as string;
          const slot = { id: m['slot'], name: m['name'], savedAt: 1, where: m['where'] };
          this.saves.set(m['slot'] as string, text);
          return { ok: { slot, text: this.rewordSave === null ? text : this.rewordSave(text), seq: this.played } };
        }
        case 'begin': {
          // Another project begun, as `play.rs` begins it: the host's alone, from a moment a save could be made in;
          // the table kept, everybody's selection kept or made again, the others pushed the board with the project.
          if (you !== this.table.host) return { error: 'only the host takes the party into an adventure' };
          const blocked = engine.call('saveBlockedBy', []) as string | null;
          if (blocked !== null) return { error: blocked };
          engine.build(m['project'] as ProjectDoc, m['shipped'], `${this.seed}:begun`, m['table'] as { animated: boolean; askDefender: boolean });
          this.kept = (m['project'] as ProjectDoc).id;
          this.played++;
          for (const member of this.table.members) {
            this.playFor(member.id);
            this.chose(member.id);
          }
          this.playFor(you);
          this.push(from, { push: { board: engine.board(), views: {}, by: from, seq: this.played }, begun: { project: m['project'] } });
          return { ok: { board: engine.board(), seq: this.played } };
        }
        case 'resume':
          if (this.kept === null) return { error: 'no game: open one' };
          this.chose(you);
          return { ok: { board: engine.board(), project: this.kept, table: this.table, seq: this.played, you } };
        case 'load': {
          // The account's save, loaded by the server's game from its own copy.
          const text = this.saves.get(m['slot'] as string);
          if (text === undefined) return { error: 'no such save' };
          const answer = engine.call('loadGameText', [text]);
          const views = this.views();
          const seq = ++this.played;
          this.chose(you);
          this.push(from, { push: { board: engine.board(), views, by: from, seq } });
          return { ok: { answer, board: engine.board(), views, seq } };
        }
        case 'call': {
          const call = m['call'] as string;
          if (NEVER_TOLD.includes(call)) return { error: `"${call}" is never told to the server's game` };
          this.calls++;
          this.meddle?.(engine, this.calls);
          if (this.refuse?.(call, this.calls) === true) return { error: `"${call}" refused` };
          const answer = engine.call(call, m['args'] as unknown[]);
          const views = this.views(call);
          const seq = ++this.played;
          this.chose(you);
          if (!UNTOLD.includes(call)) this.push(from, { push: { board: engine.board(), views, by: from, seq } });
          return { ok: { answer: this.reword === null ? answer : this.reword(answer, this.calls), board: engine.board(), views, seq } };
        }
        default:
          return { error: `no op ${String(m['op'])}` };
      }
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : String(failure) };
    }
  }
}

/** Every answer on its way back, back - and a few ticks more for what each sets going (a retry, a game asked for). */
export async function settle(server: EngineServer): Promise<void> {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 4000 && server.out > 0; i++) await tick();
  for (let i = 0; i < 20; i++) await tick();
}

export const project = (): ProjectDoc => projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));

/**
 * Nothing of the page's game told to the server's: no replica, none of its dice, walk, log, views, or save text;
 * and nothing of its own views' reads of its own engine sent at all.
 */
export function neverTold(server: EngineServer): void {
  expect(server.sent.filter((m) => m['op'] === 'restore' || NEVER_TOLD.includes(m['call'] as string) || LOCAL.includes(m['call'] as string))).toEqual([]);
}

/** The two games, as the page and the server have them - the page's own selection, its account's - the same, past their logs' start. */
export function differ(demo: DemoScene, server: EngineServer, account = 'host'): string | null {
  const ours = boardOf(demo);
  const theirs = server.boardFor(account);
  // The dice left out: each page shows its own, and is handed the others'.
  const parted = firstDifference({ ...ours, log: null, rolls: null }, { ...theirs, log: null, rolls: null }, 'board');
  return parted === null ? null : `${parted.path}: ${String(JSON.stringify(parted.game)).slice(0, 200)} / ${String(JSON.stringify(parted.replica)).slice(0, 200)}`;
}
