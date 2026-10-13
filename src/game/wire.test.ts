/**
 * The wire (`wire.ts`): the page's game held to a game on the server, here the very `.wasm` the page loads
 * standing in for the server's - the same face and dispatcher (`engine::game::face`) - answering each message
 * a tick after it was sent, in order, as a socket does, and refusing what the server's tables refuse
 * (`serve::play`): being told how the page's game stands. The page plays on without waiting; the answers are
 * held to the boards it had then, and where they part the page is stood where the server's game is. Needs
 * `npm run wasm`, and says so without it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../engine/core/rng';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { boardOf, type BoardSnapshot } from './board';
import { buildProjectScene, type DemoScene } from './demo-scene';
import { firstDifference, replicaCount } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { WasmGame } from './wasm-game';
import { KEPT_BY_HOST, LOCAL, Wire, type Said, type SharedTable, type Transport } from './wire';
import { AccountSaves } from './account-saves';
import { talkingTo, talkingView } from './ui/play-views';
import { interactablesOf } from '../engine/scene/prop-functions';
import { act } from '../../tests/fixtures/random-play';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

/** What the server's game is never told (`serve::play::NEVER_TOLD`): how another game stands, or a save's text. */
const NEVER_TOLD = ['restoreRng', 'restoreWalk', 'restoreLog', 'restoreViews', 'restoreWalked', 'restoreSeating', 'loadGameText'];

/**
 * The server's game, answering a tick late and in order, a seed of its own at every open as the server's are;
 * `meddle` changes its game behind the page's back, `reword` what it answers, `refuse` an intent outright, and
 * `noisy` has a game opened with lines already in its log. Its saves are the account's, kept across its games.
 * Its game is shared, as the server's are: each intent's answer carries what it gave to draw, taken off the
 * game's queues (`views`), and is pushed to every other connection that listens; `join` and `seat` as `play.rs`.
 * And as `play.rs`, its game is told whom it plays for before each message (`restoreSeating`): the connection's
 * account - the host's for the one that opened it, a guest's for each that joined - and that account's own
 * selection, kept between its messages and put on every board it is pushed.
 */
class EngineServer implements Transport {
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
  refuse: ((call: string, calls: number) => boolean) | null = null;
  /** The account's saves, by slot, as the server's folder keeps them. */
  readonly saves = new Map<string, string>();
  /** Who is at the game and who plays whom, as the server keeps it; and each connection's ear, by its number. */
  table: SharedTable = { game: 'g', host: 'host', invite: 'invite-1', members: [{ id: 'host', name: 'Host' }], seats: {}, started: true };
  private readonly ears = new Map<number, (message: Record<string, unknown>) => void>();
  /** Whose each connection is, and whom each account last had selected. */
  private readonly accounts = new Map<number, string>();
  private readonly selected = new Map<string, unknown>();
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

  /** A connection of its own to this server's game, which can drop - what is on its way lost with it. */
  connection(): Transport & { drop: () => void } {
    let dropped = false;
    const waiting = new Set<(why: Error) => void>();
    const number = ++this.connections;
    return {
      listen: (heard) => this.ears.set(number, (message) => {
        if (!dropped) heard(message);
      }),
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
      },
    };
  }

  private answer(m: Record<string, unknown>, from: number): Said {
    this.sent.push(m);
    const engine = this.engine;
    if (m['op'] === 'join') this.accounts.set(from, `guest-${from}`);
    const you = this.accountOf(from);
    try {
      if (m['op'] !== 'open' && m['op'] !== 'seat' && m['op'] !== 'start' && this.kept !== null) this.playFor(you);
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
          this.table = { ...this.table, started: m['lobby'] !== true };
          this.playFor(this.table.host);
          this.chose(you);
          return { ok: { seed, board: engine.board(), table: this.table, game: this.table.game, invite: this.table.invite, seq: 0, you } };
        }
        case 'join': {
          if (m['invite'] !== this.table.invite || this.kept === null) return { error: 'no game for that invitation' };
          this.table = { ...this.table, members: [...this.table.members, { id: `guest-${from}`, name: `Guest ${from}` }] };
          this.push(from, { table: this.table });
          this.chose(you);
          return { ok: { board: engine.board(), project: this.kept, table: this.table, seq: this.played, you } };
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
        case 'save': {
          if (you !== this.table.host) return { error: "the host keeps this game's saves" };
          // The game saves itself, as a game on the server does (`play.rs`), unless it may not now.
          const blocked = this.refuseSave ?? (engine.call('saveBlockedBy', []) as string | null);
          if (blocked !== null) return { error: blocked };
          const text = engine.call('serialiseSave', []) as string;
          const slot = { id: m['slot'], name: m['name'], savedAt: 1, where: m['where'] };
          this.saves.set(m['slot'] as string, text);
          return { ok: { slot, text: this.rewordSave === null ? text : this.rewordSave(text) } };
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
          this.push(from, { push: { board: engine.board(), views, by: from, seq } });
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
async function settle(server: EngineServer): Promise<void> {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 4000 && server.out > 0; i++) await tick();
  for (let i = 0; i < 20; i++) await tick();
}

const project = (): ProjectDoc => projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));

/**
 * Nothing of the page's game told to the server's: no replica, none of its dice, walk, log, views, or save text;
 * and nothing of its own views' reads of its own engine sent at all.
 */
function neverTold(server: EngineServer): void {
  expect(server.sent.filter((m) => m['op'] === 'restore' || NEVER_TOLD.includes(m['call'] as string) || LOCAL.includes(m['call'] as string))).toEqual([]);
}

/** The two games, as the page and the server have them - the page's own selection, its account's - the same, past their logs' start. */
function differ(demo: DemoScene, server: EngineServer, account = 'host'): string | null {
  const ours = boardOf(demo);
  const theirs = server.boardFor(account);
  // The dice left out: each page shows its own, and is handed the others'.
  const parted = firstDifference({ ...ours, log: null, rolls: null }, { ...theirs, log: null, rolls: null }, 'board');
  return parted === null ? null : `${parted.path}: ${String(JSON.stringify(parted.game)).slice(0, 200)} / ${String(JSON.stringify(parted.replica)).slice(0, 200)}`;
}

describe('the wire to the server\'s game', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('plays on the server\'s seed from the start, and every intent in step with it, answers coming back late', async () => {
    const bytes = readFileSync(WASM);
    for (const kind of ['wasm'] as const) {
      const demo = buildProjectScene(project(), `wire:${kind}`);
      const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
      const server = new EngineServer(await WasmEngine.load(bytes));
      const before = replicaCount();
      const wire = new Wire(() => server, demo, shippedContent());
      game.wireWith(wire);
      const pagesOwn = demo.rng.save();
      await wire.ready;
      // Stood where the server's game opened, at once: its dice the page's from here on, not the page's own.
      expect(wire.status()).toBe('in');
      expect(differ(demo, server)).toBeNull();
      expect(demo.rng.save()).not.toBe(pagesOwn);
      // The page's dice offered at open, which only the tests' server takes.
      expect(server.sent.find((m) => m['op'] === 'open')!['rng']).toBe(pagesOwn);
      expect(demo.rng.save()).toBe((server.engine.board() as BoardSnapshot).rng);
      const g = createRng(`wire:${kind}`);
      // Played in bursts, the page never waiting: several intents up before the first is answered.
      for (let burst = 0; burst < 25; burst++) {
        for (let n = 0; n < 6; n++) act(game, demo, g);
        await settle(server);
      }
      const after = replicaCount();
      const partings = after.first.slice(before.first.length);
      expect(partings, JSON.stringify(partings.slice(0, 2), null, 1)).toEqual([]);
      expect(after.asked - before.asked, kind).toBeGreaterThan(100);
      expect(wire.status(), kind).toBe('in');
      expect(differ(demo, server), kind).toBeNull();
      // Opened once, and never told the page's game.
      expect(server.sent.filter((m) => m['op'] === 'open').length, kind).toBe(1);
      neverTold(server);
    }
  }, 300_000);

  it.skipIf(!built)('counts a parting, and stands the page\'s game where the server\'s is', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:parting');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    const wire = new Wire(() => server, demo, shippedContent());
    game.wireWith(wire);
    await wire.ready;
    const kara = demo.party.members()[0]!;
    // Behind the page's back, as the second intent arrives: the server's game wounds Kara.
    server.meddle = (engine, calls) => {
      if (calls === 2) engine.call('wound', [kara, 3]);
    };
    const before = replicaCount();
    game.selectNext();
    game.selectNext();
    game.selectNext();
    expect(demo.state.entity(kara)!.hitPoints.marked).toBe(0);
    await settle(server);
    const partings = replicaCount().first.slice(before.first.length);
    expect(partings.length).toBe(1);
    expect(partings[0]!.question).toMatch(/^server selectNext: board\.replica/);
    // The page's game is the server's now - wounded, the third intent's selection and all - and in step.
    expect(demo.state.entity(kara)!.hitPoints.marked).toBe(3);
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length).length, 'nothing more parts').toBe(1);
    // An answer that is not the page's, the boards the same: a parting too.
    server.reword = (answer, calls) => (calls === 5 ? { not: answer } : answer);
    game.selectNext();
    await settle(server);
    const reworded = replicaCount().first.slice(before.first.length);
    expect(reworded.length).toBe(2);
    expect(reworded[1]!.question).toBe('server selectNext: answer');
    expect(wire.status()).toBe('in');
  }, 60_000);

  it.skipIf(!built)('saves through the server\'s game: its own text, held to the page\'s by value', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:save');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    const wire = new Wire(() => server, demo, shippedContent());
    game.wireWith(wire);
    await wire.ready;
    const before = replicaCount();
    game.selectNext();
    game.selectNext();
    expect(game.saveBlockedBy()).toBeNull();
    const text = game.serialiseSave()!;
    const saved = await wire.save({ id: 'quick', name: 'Quick save', where: 'The Husk Vault' }, text);
    expect(saved?.slot).toEqual({ id: 'quick', name: 'Quick save', savedAt: 1, where: 'The Husk Vault' });
    // The engine's save of the game, as the page's: the same by value.
    expect(JSON.parse(saved!.text)).toEqual(JSON.parse(text));
    let after = replicaCount();
    expect(after.first.slice(before.first.length)).toEqual([]);
    expect(after.asked - before.asked).toBe(3);
    // Not the page's: a parting.
    server.rewordSave = (written) => JSON.stringify({ ...(JSON.parse(written) as object), version: -1 });
    await wire.save({ id: 'quick', name: 'Quick save', where: '' }, text);
    after = replicaCount();
    expect(after.first.slice(before.first.length).map((p) => p.question)).toEqual(['server save: save.version']);
    // Refused by the server's game: a parting, and nothing given back.
    server.rewordSave = null;
    server.refuseSave = 'Not while a question is open.';
    expect(await wire.save({ id: 'auto', name: 'Autosave', where: '' }, text)).toBeNull();
    expect(replicaCount().first.slice(before.first.length).map((p) => p.question)).toEqual(['server save: save.version', 'server save: refused']);
    // Not in step to save at all: no save sent.
    wire.close();
    const sent = server.sent.length;
    expect(wire.save({ id: 'quick', name: 'Quick save', where: '' }, text)).toBeNull();
    await settle(server);
    expect(server.sent.length).toBe(sent);
  }, 60_000);

  it.skipIf(!built)('lets the server\'s game go when the editor changes the page\'s: the playtest is the page\'s alone', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:edited');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    // A game opened with lines in its log already: the page stood where it is, those lines and all.
    server.noisy = true;
    const wire = new Wire(() => server, demo, shippedContent(), { retries: [0, 0] });
    game.wireWith(wire);
    await wire.ready;
    expect((server.engine.board() as BoardSnapshot).log.length).toBeGreaterThan(0);
    expect(demo.log.map((line) => line.text)).toEqual((server.engine.board() as BoardSnapshot).log.map((line) => line.text));
    const before = replicaCount();
    // The dice rolled first, so the page's are not where a fresh game's on the server start.
    const g = createRng('wire:edited');
    for (let n = 0; n < 40; n++) act(game, demo, g);
    await settle(server);
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    // The editor gathers the party somewhere else: a game the server's never was, which it is not told - the
    // wire closes, and the page plays on alone, sending nothing.
    const kara = demo.party.members()[0]!;
    const sent = server.sent.length;
    game.gatherParty(demo.state.entity(kara)!.tile + 2);
    expect(wire.status()).toBe('closed');
    for (let n = 0; n < 10; n++) act(game, demo, g);
    await settle(server);
    expect(server.sent.length).toBe(sent);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    neverTold(server);
  }, 60_000);

  it.skipIf(!built)('closes when it cannot connect again, and the page plays on', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:gone');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    const wire = new Wire(() => server, demo, shippedContent(), { retries: [0, 0] });
    game.wireWith(wire);
    await wire.ready;
    const before = replicaCount();
    // The socket goes, and will not come back: tried again twice, the wire closes, and the page plays on.
    server.close();
    game.selectNext();
    await settle(server);
    expect(wire.status()).toBe('closed');
    expect(server.refused, 'the intent, then a resume at each try').toBe(3);
    expect(() => game.selectNext()).not.toThrow();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 60_000);

  it.skipIf(!built)('stands the page where the server\'s game is when the server refuses an intent', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:refused');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    const wire = new Wire(() => server, demo, shippedContent());
    game.wireWith(wire);
    await wire.ready;
    const before = replicaCount();
    // The second intent refused - the server will not take it - and the third played on: the page, which played
    // all three, is stood where the server's game is after the third, without the second.
    server.refuse = (_, calls) => calls === 2;
    const first = demo.party.selected;
    game.selectNext();
    game.selectNext();
    game.selectNext();
    await settle(server);
    const partings = replicaCount().first.slice(before.first.length).map((p) => p.question);
    expect(partings).toEqual(['server selectNext: refused']);
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    expect(demo.party.selected).toBe((server.engine.board() as BoardSnapshot).replica.party.selected);
    expect(demo.party.selected).not.toBe(first);
    // The last one refused, nothing after it: the page asks where the server's game is, and is stood there.
    server.refuse = (_, calls) => calls === 4;
    game.selectNext();
    await settle(server);
    expect(server.sent.filter((m) => m['op'] === 'resume').length).toBe(1);
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    neverTold(server);
  }, 60_000);

  it.skipIf(!built)('sends what the page plays while the server\'s game opens behind the opening, and stands it where that leaves it', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:early');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    const before = replicaCount();
    const wire = new Wire(() => server, demo, shippedContent());
    game.wireWith(wire);
    game.selectNext();
    game.selectNext();
    expect(wire.status()).toBe('opening');
    await wire.ready;
    await settle(server);
    expect(server.sent.map((m) => m['op'] === 'call' ? m['call'] : m['op'])).toEqual(['open', 'selectNext', 'selectNext']);
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 60_000);

  it.skipIf(!built)('connects again when the connection drops, and goes on with the game the server kept, or a fresh one', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:dropped');
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    let current = server.connection();
    let connections = 0;
    const tries: number[] = [];
    const connect = () => {
      connections++;
      current = server.connection();
      return current;
    };
    // A server that is down comes up again as the second try after a drop is made.
    const wire = new Wire(connect, demo, shippedContent(), {
      retries: [5, 10, 20],
      later: (run, ms) => {
        tries.push(ms);
        if (tries.length === 3) server.closed = false;
        setTimeout(run, 0);
      },
    });
    game.wireWith(wire);
    await wire.ready;
    const early = game.serialiseSave()!;
    // Saved on the server, in the account's slot: loaded from there by its slot later.
    expect(await wire.save({ id: 'early', name: 'Early', where: '' }, early)).not.toBeNull();
    const before = replicaCount();
    const g = createRng('wire:dropped');
    for (let n = 0; n < 12; n++) act(game, demo, g);
    // Dropped with intents on their way: lost, and the page plays on without sending.
    current.drop();
    await settle(server);
    for (let n = 0; n < 12; n++) act(game, demo, g);
    await settle(server);
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    // Back: stood where the game kept is - what the page played alone undone - no game opened for it, in step.
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    expect(tries).toEqual([5]);
    expect(connections).toBe(2);
    game.selectNext();
    for (let n = 0; n < 12; n++) act(game, demo, g);
    await settle(server);
    // A save loaded by its slot: the server's game loads its own copy, and both games stand alike after it.
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    expect(game.loadGameText(early, 'early').ok).toBe(true);
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    expect(differ(demo, server)).toBeNull();
    expect(server.sent.filter((m) => m['op'] === 'load')).toEqual([{ op: 'load', slot: 'early' }]);
    expect(server.sent.filter((m) => m['op'] === 'resume').length).toBe(1);
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(1);
    // Dropped again, the game gone from the server meanwhile, and the server down a while: tried again until it
    // is up - longer each time - and a fresh game opened, and the page stood where that is.
    server.kept = null;
    server.closed = true;
    current.drop();
    game.selectNext();
    await settle(server);
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    expect(tries, 'the count of tries begun again once connected').toEqual([5, 5, 10]);
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(2);
    game.selectNext();
    for (let n = 0; n < 12; n++) act(game, demo, g);
    await settle(server);
    // The account's save, kept across the server's games: loaded into the fresh one by its slot.
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    expect(game.loadGameText(early, 'early').ok).toBe(true);
    game.selectNext();
    await settle(server);
    expect(wire.status()).toBe('in');
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    expect(differ(demo, server)).toBeNull();
    neverTold(server);
  }, 120_000);

  it.skipIf(!built)('comes back to the game the server kept when the page is reloaded, of the same project, and no other', async () => {
    const bytes = readFileSync(WASM);
    const server = new EngineServer(await WasmEngine.load(bytes));
    const first = buildProjectScene(project(), 'wire:before-reload');
    const played = new WasmGame(first, await WasmEngine.load(bytes), shippedContent());
    const wire = new Wire(() => server.connection(), first, shippedContent());
    played.wireWith(wire);
    await wire.ready;
    const early = played.serialiseSave()!;
    expect(early).not.toBeNull();
    expect(await wire.save({ id: 'early', name: 'Early', where: '' }, early)).not.toBeNull();
    const g = createRng('wire:reload');
    for (let n = 0; n < 30; n++) act(played, first, g);
    await settle(server);
    while (first.pending !== null) {
      played.answerPending({ kind: 'continue' });
      await settle(server);
    }
    played.selectNext();
    await settle(server);
    const before = replicaCount();
    // The page reloaded: a fresh game of its own, from another seed, comes back to the one the server kept.
    const again = buildProjectScene(project(), 'wire:after-reload');
    const game = new WasmGame(again, await WasmEngine.load(bytes), shippedContent());
    game.selectNext();
    const back = new Wire(() => server.connection(), again, shippedContent(), { resume: true });
    game.wireWith(back);
    await back.ready;
    expect(back.resumed).toBe(true);
    expect(back.status()).toBe('in');
    expect(differ(again, server)).toBeNull();
    expect(boardOf(again).replica).toEqual(boardOf(first).replica);
    expect(again.log.map((line) => line.text)).toEqual(first.log.map((line) => line.text));
    expect(again.rng.save()).toBe(first.rng.save());
    expect(server.sent.filter((m) => m['op'] === 'open').length, 'no game opened').toBe(1);
    for (let n = 0; n < 20; n++) act(game, again, g);
    await settle(server);
    // A save loaded by its slot: the page's engine and the server's game alike after it.
    while (again.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    const loaded = game.loadGameText(early, 'early');
    expect(loaded, JSON.stringify(loaded)).toEqual({ ok: true });
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    // Another project's page does not come back to it: it opens its own.
    const other = buildProjectScene({ ...project(), id: 'another' }, 'wire:other');
    const elsewhere = new Wire(() => server.connection(), other, shippedContent(), { resume: true });
    new WasmGame(other, await WasmEngine.load(bytes), shippedContent()).wireWith(elsewhere);
    await elsewhere.ready;
    expect(elsewhere.resumed).toBe(false);
    expect(elsewhere.status()).toBe('in');
    expect(differ(other, server)).toBeNull();
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(2);
    // Nor does one whose kept game has nothing kept.
    server.kept = null;
    const nothing = new Wire(() => server.connection(), buildProjectScene(project(), 'wire:nothing'), shippedContent(), { resume: true });
    await nothing.ready;
    expect(nothing.resumed).toBe(false);
    expect(nothing.status()).toBe('in');
    neverTold(server);
  }, 120_000);

  /** A page and the server's game, the server's opening a question of its own - Kara stood beside a thing and using it - as the first intent arrives. */
  async function asking(name: string, thing: string, options: { connect?: (server: EngineServer) => () => Transport; retries?: number[] } = {}) {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), `wire:${name}`);
    const game = new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
    const server = new EngineServer(await WasmEngine.load(bytes));
    const wire = new Wire(options.connect?.(server) ?? (() => server), demo, shippedContent(), { retries: options.retries ?? [0], later: (run) => setTimeout(run, 0) });
    game.wireWith(wire);
    await wire.ready;
    const at = interactablesOf(demo.scene).find((i) => i.id === thing)!.position;
    const beside = at.y * demo.grid.width + at.x - 1;
    server.meddle = (engine, calls) => {
      if (calls !== 1) return;
      engine.call('placeAt', ['kara', beside]);
      engine.call('select', ['kara']);
      engine.call('useSelectedOn', [thing]);
    };
    const before = replicaCount();
    game.selectNext();
    await settle(server);
    return { demo, game, server, wire, before };
  }

  it.skipIf(!built)('shows a question the server\'s game holds from its board, and plays the answer there, not here', async () => {
    const { demo, game, server, wire, before } = await asking('asked', 'door-12-7');
    const theirs = server.engine.board() as BoardSnapshot;
    expect(theirs.pending).not.toBeNull();
    expect(wire.status()).toBe('asked');
    // What the page's views read of the question is what the server's board says, and the page draws it again.
    expect(boardOf(demo).pending).toEqual(theirs.pending);
    expect(boardOf(demo).replica).toEqual(theirs.replica);
    expect(game.changedBehind()).toBe(true);
    expect(game.changedBehind()).toBe(false);
    // Anything else is the page's to refuse, as with any question open, and nothing is sent.
    const sent = server.sent.length;
    const away = demo.state.entity('kara')!.tile - 2;
    expect(game.moveSelectedTo(away).moved).toBe(false);
    expect(game.syncTalks()).toBe(false);
    expect(game.saveBlockedBy()).not.toBeNull();
    await settle(server);
    expect(server.sent.length).toBe(sent);
    // The answer: sent up, not played here, and the page waits on it - a second answer meanwhile refused.
    const logBefore = demo.log.length;
    expect(game.answerPending({ kind: 'roll' }).status).toBe('waiting');
    expect(game.answerPending({ kind: 'roll' }).status).toBe('refused');
    expect(demo.log.length).toBe(logBefore);
    await settle(server);
    for (let n = 0; n < 10 && wire.status() === 'asked'; n++) {
      game.answerPending({ kind: 'choose', index: 0 });
      await settle(server);
    }
    // Stood where the server's game is after it, the roll's lines in the log, and in step.
    expect(wire.status()).toBe('in');
    expect(demo.pending).toBeNull();
    expect(demo.log.length).toBeGreaterThan(logBefore);
    expect(differ(demo, server)).toBeNull();
    expect(game.changedBehind()).toBe(true);
    game.selectNext();
    game.selectNext();
    await settle(server);
    const partings = replicaCount().first.slice(before.first.length).map((p) => p.question);
    expect(partings).toEqual([expect.stringMatching(/^server selectNext: board\./)]);
  }, 120_000);

  it.skipIf(!built)('shows the server\'s question with the page playing the engine, the engine told the game after', async () => {
    const { demo, game, server, wire, before } = await asking('asked-wasm', 'door-12-7');
    expect(wire.status()).toBe('asked');
    const held = (server.engine.board() as BoardSnapshot).pending;
    expect(boardOf(demo).pending).toEqual(held);
    // Anything else is played by the page's engine - told a question is open, which refuses as the page's own
    // game did - and not sent; a selection, which the engine takes, leaves the server's question on screen.
    const sent = server.sent.length;
    expect(game.moveSelectedTo(demo.state.entity('kara')!.tile - 2).moved).toBe(false);
    game.selectNext();
    expect(boardOf(demo).pending).toEqual(held);
    await settle(server);
    expect(server.sent.length).toBe(sent);
    expect(game.answerPending({ kind: 'roll' }).status).toBe('waiting');
    await settle(server);
    for (let n = 0; n < 10 && wire.status() === 'asked'; n++) {
      game.answerPending({ kind: 'choose', index: 0 });
      await settle(server);
    }
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    // Played on, the page's engine and the server's alike: nothing more parts.
    game.selectNext();
    game.selectNext();
    game.syncTalks();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length).length).toBe(1);
  }, 120_000);

  it.skipIf(!built)('shows a conversation the server\'s game holds - its node, lines and options - and answers it there', async () => {
    const { demo, game, server, wire, before } = await asking('talk', 'pillar-14-7');
    expect(wire.status()).toBe('asked');
    let rounds = 0;
    while (wire.status() === 'asked' && rounds++ < 12) {
      const theirs = server.engine.board() as BoardSnapshot;
      expect(boardOf(demo).pending, `round ${rounds}`).toEqual(theirs.pending);
      const view = talkingView(demo);
      const shown = (theirs.pending as { dialogue: { view: { options: { index: number; text: string }[] } | null } | null }).dialogue?.view ?? null;
      if (shown !== null) {
        // The conversation panel's own read: the node's lines from the page's project, the options the server's.
        expect(view?.options.map((o) => o.text)).toEqual(shown.options.map((o) => o.text));
        expect(view!.lines.length).toBeGreaterThan(0);
        expect(talkingTo(demo)).not.toBeNull();
        if (rounds === 1) {
          // Somebody else selected while the server's game holds the conversation: it is not set aside here -
          // the page has no conversation of its own to set aside - and it stays on screen.
          const other = demo.party.members().find((id) => id !== 'kara')!;
          game.select(other);
          expect(demo.party.selected).toBe(other);
          expect(game.syncTalks()).toBe(false);
          expect(boardOf(demo).pending).toEqual(theirs.pending);
          game.select('kara');
        }
        // As the panel answers: an option by its own index - the first, then the last (walking away) - or on.
        const options = shown.options;
        game.answerPending(options.length === 0 ? { kind: 'continue' } : { kind: 'choose', index: options[rounds === 1 ? 0 : options.length - 1]!.index });
      } else game.answerPending({ kind: 'roll' });
      await settle(server);
    }
    expect(rounds).toBeGreaterThan(1);
    expect(wire.status()).toBe('in');
    expect(demo.pending).toBeNull();
    expect(differ(demo, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length).length).toBe(1);
  }, 120_000);

  it.skipIf(!built)('comes back to a question the server\'s game holds when the page is reloaded, or lets it go with the game', async () => {
    let current: ReturnType<EngineServer['connection']> | null = null;
    const { server, before } = await asking('reload-asked', 'door-12-7', {
      connect: (s) => () => {
        current = s.connection();
        return current;
      },
    });
    expect((server.engine.board() as BoardSnapshot).pending).not.toBeNull();
    // Reloaded: the question shown again, from the board of the game kept.
    const again = buildProjectScene(project(), 'wire:reloaded-asked');
    const game = new WasmGame(again, await WasmEngine.load(readFileSync(WASM)), shippedContent());
    const back = new Wire(() => server.connection(), again, shippedContent(), { resume: true });
    game.wireWith(back);
    await back.ready;
    expect(back.resumed).toBe(true);
    expect(back.status()).toBe('asked');
    expect(boardOf(again).pending).toEqual((server.engine.board() as BoardSnapshot).pending);
    expect(game.answerPending({ kind: 'roll' }).status).toBe('waiting');
    await settle(server);
    for (let n = 0; n < 10 && back.status() === 'asked'; n++) {
      game.answerPending({ kind: 'choose', index: 0 });
      await settle(server);
    }
    expect(back.status()).toBe('in');
    expect(differ(again, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length).length).toBe(1);
  }, 120_000);

  it.skipIf(!built)('keeps showing the server\'s question across a dropped connection, and lets it go when the game is gone', async () => {
    let current: ReturnType<EngineServer['connection']> | null = null;
    const { demo, game, server, wire, before } = await asking('dropped-asked', 'door-12-7', {
      connect: (s) => () => {
        current = s.connection();
        return current;
      },
      retries: [0, 0, 0],
    });
    expect(wire.status()).toBe('asked');
    // Dropped while the question is open, the game kept: back, and the question shown again.
    current!.drop();
    game.answerPending({ kind: 'roll' });
    await settle(server);
    expect(wire.status()).toBe('asked');
    expect(boardOf(demo).pending).toEqual((server.engine.board() as BoardSnapshot).pending);
    // Dropped again, the game gone: the question let go with it, a fresh game opened, and the page stood there.
    server.kept = null;
    current!.drop();
    game.answerPending({ kind: 'roll' });
    await settle(server);
    expect(demo.pending).toBeNull();
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    game.selectNext();
    await settle(server);
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length).length).toBe(1);
  }, 120_000);
});

describe('a shared game, on the wire', () => {
  /**
   * The host's page and a guest's, each its own page and engine, at one game on the server - the guest seated in
   * one of the party (`theirs`), the host playing the rest.
   */
  async function sharing(name: string, seated = true, lobby = false) {
    const bytes = readFileSync(WASM);
    const server = new EngineServer(await WasmEngine.load(bytes));
    const hostDemo = buildProjectScene(project(), `wire:${name}:host`);
    const host = new WasmGame(hostDemo, await WasmEngine.load(bytes), shippedContent());
    const hostWire = new Wire(() => server.connection(), hostDemo, shippedContent(), { lobby });
    host.wireWith(hostWire);
    await hostWire.ready;
    const guestDemo = buildProjectScene(project(), `wire:${name}:guest`);
    const guest = new WasmGame(guestDemo, await WasmEngine.load(bytes), shippedContent());
    const guestWire = new Wire(() => server.connection(), guestDemo, shippedContent(), { join: hostWire.table!.invite });
    guest.wireWith(guestWire);
    await guestWire.ready;
    await settle(server);
    const theirs = hostDemo.party.members().find((id) => id !== (hostDemo.party.selected ?? hostDemo.party.members()[0]))!;
    if (seated) {
      await hostWire.seat(theirs, guestWire.you!);
      await settle(server);
    }
    return { server, hostDemo, host, hostWire, guestDemo, guest, guestWire, theirs, before: replicaCount() };
  }

  it.skipIf(!built)('joins with an invitation, stood where the game is, and both pages are told who is at it', async () => {
    const { server, hostWire, guestDemo, guestWire } = await sharing('join');
    expect(guestWire.joined).toBe(true);
    expect(guestWire.status()).toBe('in');
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    expect(guestWire.table?.members.length).toBe(2);
    expect(hostWire.table?.members.length).toBe(2);
    // A wrong invitation joins nothing, and the wire closes.
    const stranger = new Wire(() => server.connection(), buildProjectScene(project(), 'wire:stranger'), shippedContent(), { join: 'nope' });
    await stranger.ready;
    expect(stranger.status()).toBe('closed');
  }, 120_000);

  it.skipIf(!built)('stands an idle page where another page\'s intent leaves the game, with the walk it gave to draw', async () => {
    const { server, hostDemo, host, guestDemo, guestWire, before } = await sharing('pushed');
    const kara = hostDemo.party.selected!;
    const from = hostDemo.state.entity(kara)!.tile;
    host.moveSelectedTo(from + 3);
    await settle(server);
    // The guest's page: the host's walk, as the server played it, and the walk to draw.
    expect(guestDemo.state.entity(kara)!.tile).toBe(hostDemo.state.entity(kara)!.tile);
    expect(guestDemo.state.entity(kara)!.tile).not.toBe(from);
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    expect(guestDemo.motions.some((motion) => motion.id === kara)).toBe(true);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 120_000);

  it.skipIf(!built)('lets another page\'s intent in between the page\'s own without a parting, and stands it where the last answer leaves it', async () => {
    const { server, hostDemo, host, guestDemo, guest, guestWire, before } = await sharing('between');
    const g = createRng('wire:between');
    // Both pages playing at once, the guest's intents on their way up when the host's pushes land.
    for (let burst = 0; burst < 10; burst++) {
      for (let n = 0; n < 3; n++) {
        guest.selectNext();
        act(host, hostDemo, g);
      }
      await settle(server);
      while (hostDemo.pending !== null) {
        host.answerPending({ kind: 'continue' });
        await settle(server);
      }
    }
    expect(differ(hostDemo, server)).toBeNull();
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    const partings = replicaCount().first.slice(before.first.length);
    expect(partings, JSON.stringify(partings.slice(0, 2), null, 1)).toEqual([]);
  }, 300_000);

  it.skipIf(!built)("keeps the page's own intent drawn when another page's lands while it is on its way up", async () => {
    const { server, hostDemo, host, guestDemo, guest, guestWire, before } = await sharing('in-flight');
    const kara = hostDemo.party.selected!;
    const tile = hostDemo.state.entity(kara)!.tile;
    // The host's walk goes up first, then the guest's own selection: the game plays them in that order.
    host.moveSelectedTo(tile + 2);
    guest.selectNext();
    const mine = guestDemo.party.selected;
    expect(mine).not.toBe(kara);
    // The host's walk is played, and pushed to the guest, before the guest's own selection is answered: the
    // guest's page keeps what it played, waiting for its answer, rather than going back to before it.
    await new Promise((tick) => setTimeout(tick, 0));
    expect(guestDemo.party.selected).toBe(mine);
    await settle(server);
    // Its answer back: stood where the game is, the host's walk and its own selection both - and the host's
    // walk, handed on while the guest waited, given to its views to draw then.
    expect(guestDemo.party.selected).toBe(mine);
    expect(guestDemo.state.entity(kara)!.tile).toBe(hostDemo.state.entity(kara)!.tile);
    expect(guestDemo.motions.some((motion) => motion.id === kara)).toBe(true);
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 120_000);

  it.skipIf(!built)('seats a character as the host says, and the guest is told', async () => {
    const { server, hostWire, guestWire } = await sharing('seats', false);
    const guestId = guestWire.table!.members[1]!.id;
    expect(await hostWire.seat('kara', guestId)).toBe(true);
    await settle(server);
    expect(guestWire.table?.seats).toEqual({ kara: guestId });
    expect(await hostWire.seat('kara', null)).toBe(true);
    await settle(server);
    expect(guestWire.table?.seats).toEqual({});
  }, 120_000);

  it.skipIf(!built)('cuts a walk short where it is drawn after another page\'s intent stood the page, as the server does', async () => {
    const { server, hostDemo, host, guest, before } = await sharing('landed');
    const kara = hostDemo.party.selected!;
    const from = hostDemo.state.entity(kara)!.tile;
    host.moveSelectedTo(from + 4);
    // The host's views drain the walk, as a frame does, and start drawing it.
    const walk = host.takeMotions().find((motion: { id: string }) => motion.id === kara)! as { route?: { x: number; y: number }[] };
    await settle(server);
    // The guest plays, and the host's page is stood where that leaves the game, mid-glide.
    guest.selectNext();
    await settle(server);
    // The host clicks again: the walk cut short where it is drawn, part-way along it.
    const route = walk.route!;
    const halfway = { x: (route[0]!.x + route.at(-1)!.x) / 2, y: (route[0]!.y + route.at(-1)!.y) / 2 };
    const landed = host.landWalkers({ isGliding: (id) => id === kara, spotOf: () => halfway, land: () => true, layout: undefined as never });
    expect(landed).toEqual([kara]);
    await settle(server);
    expect(differ(hostDemo, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 120_000);
  it.skipIf(!built)("acts with the page's own: another's refused by the page's engine as the server's refuses it, nothing parted", async () => {
    const { server, hostDemo, host, guestDemo, guest, guestWire, theirs, before } = await sharing('own');
    const kara = hostDemo.party.selected!;
    // The guest's own is selected for them; the host's is not theirs to select, or to play.
    expect(guestDemo.party.selected).toBe(theirs);
    expect(guest.select(kara)).toBe(false);
    expect(guestDemo.party.selected).toBe(theirs);
    const card = host.abilityList(kara)[0]?.ability.id ?? 'anything';
    expect(guest.useAbility(kara, card, [])).toEqual({ status: 'refused', lines: [] });
    expect(guest.equipItem(kara, 'anything').ok).toBe(false);
    expect(guest.unlink(kara)).toBe(false);
    await settle(server);
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    // Each keeps their own selection through the other's intents.
    host.moveSelectedTo(hostDemo.state.entity(kara)!.tile + 2);
    guest.selectNext();
    await settle(server);
    expect(hostDemo.party.selected).toBe(kara);
    expect(guestDemo.party.selected).toBe(theirs);
    expect(differ(hostDemo, server)).toBeNull();
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    // The host's walks up to a door to use it: the errand is the host's to finish - the guest's page, drawing the
    // same walk, does not even send it.
    host.placeAt(kara, hostDemo.state.entity(kara)!.tile);
    expect(host.approachThenUse('door-12-7')).toBe('walking');
    await settle(server);
    expect(guestDemo.approaching.map((errand) => errand.who)).toEqual([kara]);
    const sent = server.sent.length;
    expect(guest.arrived()).toBe(false);
    await settle(server);
    expect(server.sent.length).toBe(sent);
    // The guest's walks up to the door too, while the host's is still on its way: both errands stand, on both pages
    // and the server, each its own player's to finish once their own walkers are drawn stopping, whoever else's walk.
    expect(guest.approachThenUse('door-12-7')).toBe('walking');
    await settle(server);
    const walkers = (errands: { who: string }[]) => errands.map((errand) => errand.who);
    for (const demo of [hostDemo, guestDemo]) expect(walkers(demo.approaching)).toEqual([kara, theirs]);
    expect(walkers((server.engine.board() as BoardSnapshot).approaching)).toEqual([kara, theirs]);
    const hostStillWalking = { isGliding: (id: string) => id === kara };
    expect(host.arrivedWhereDrawn(hostStillWalking)).toBe(false);
    // Not while a walk has woken a fight, whose beginning calls every errand off.
    guestDemo.ambush = 'group-1';
    expect(guest.arrivedWhereDrawn(hostStillWalking)).toBe(false);
    guestDemo.ambush = null;
    expect(guest.arrivedWhereDrawn(hostStillWalking)).toBe(true);
    await settle(server);
    expect(walkers((server.engine.board() as BoardSnapshot).approaching)).toEqual([kara]);
    expect(walkers(hostDemo.approaching)).toEqual([kara]);
    expect(host.arrived()).toBe(true);
    await settle(server);
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 120_000);

  it.skipIf(!built)("keeps the selection among the page's own as the seats change", async () => {
    const { server, hostWire, guestDemo, guestWire, theirs, before } = await sharing('reseated');
    expect(guestDemo.party.selected).toBe(theirs);
    // Unseated, the guest plays nobody: nobody selected, on the page as on the server.
    expect(await hostWire.seat(theirs, null)).toBe(true);
    await settle(server);
    expect(guestDemo.party.selected).toBeNull();
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    // Seated again: theirs again.
    expect(await hostWire.seat(theirs, guestWire.you!)).toBe(true);
    await settle(server);
    expect(guestDemo.party.selected).toBe(theirs);
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    // The wire closed - the editor's playtest - the page's game is its own: it plays for everybody.
    expect(guestWire.seating()).not.toBeNull();
    guestWire.close();
    expect(guestWire.seating()).toBeNull();
  }, 120_000);

  it.skipIf(!built)('gathers in a lobby: nobody plays before the host starts it, the guest takes a seat, nothing parted', async () => {
    const { server, hostDemo, host, hostWire, guestDemo, guest, guestWire, theirs, before } = await sharing('lobby', false, true);
    expect(server.sent.find((m) => m['op'] === 'open')!['lobby']).toBe(true);
    expect(hostWire.table!.started).toBe(false);
    expect(guestWire.table!.started).toBe(false);
    // Nobody plays anybody yet, the host no more than the guest: nobody selected, everything refused on the page as
    // on the server.
    const kara = hostDemo.party.members()[0]!;
    for (const [demo, game] of [[hostDemo, host], [guestDemo, guest]] as const) {
      expect(demo.party.selected).toBeNull();
      expect(game.select(kara)).toBe(false);
      expect(game.endTurn()).toBe(0);
    }
    await settle(server);
    expect(differ(hostDemo, server)).toBeNull();
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    // The guest takes a seat nobody has, and may not take one somebody has; nor start the game.
    expect(await guestWire.seat(theirs, guestWire.you!)).toBe(true);
    await settle(server);
    expect(hostWire.table!.seats).toEqual({ [theirs]: guestWire.you });
    expect(await hostWire.seat(kara, 'host')).toBe(true);
    expect(await guestWire.seat(kara, guestWire.you!)).toBe(false);
    expect(await guestWire.startGame()).toBe(false);
    await settle(server);
    expect(guestDemo.party.selected).toBeNull();
    // The host starts it: both pages told, each with their own selected at once.
    expect(await hostWire.startGame()).toBe(true);
    await settle(server);
    expect(guestWire.table!.started).toBe(true);
    expect(hostDemo.party.selected).toBe(kara);
    expect(guestDemo.party.selected).toBe(theirs);
    expect(differ(hostDemo, server)).toBeNull();
    expect(differ(guestDemo, server, guestWire.you!)).toBeNull();
    // Started, the seats are the host's to say again.
    expect(await guestWire.seat(theirs, null)).toBe(false);
    // And played: the guest walks their own.
    guest.moveSelectedTo(guestDemo.state.entity(theirs)!.tile + 1);
    await settle(server);
    expect(differ(hostDemo, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 120_000);

  it.skipIf(!built)("keeps a shared game's saves the host's: a guest's page saves nothing, nor sends it", async () => {
    const { server, host, guest, guestWire, hostWire } = await sharing('saves');
    expect(guestWire.keepsSaves()).toBe(false);
    expect(hostWire.keepsSaves()).toBe(true);
    expect(guest.saveBlockedBy()).toBe(KEPT_BY_HOST);
    expect(host.saveBlockedBy()).toBeNull();
    const shelf = new AccountSaves([], new Map(), () => guestWire);
    expect(shelf.write('{}', 'Quick save', 'here', 'quick')).toBeNull();
    expect(shelf.refused()).toBe(KEPT_BY_HOST);
    await settle(server);
    expect(server.sent.filter((m) => m['op'] === 'save')).toEqual([]);
    // The host's is written.
    const hosts = new AccountSaves([], new Map(), () => hostWire);
    expect(hosts.write(host.serialiseSave()!, 'Quick save', 'here', 'quick')).not.toBeNull();
    await settle(server);
    expect(server.saves.has('quick')).toBe(true);
    // A page at nobody's table keeps its own.
    hostWire.close();
    expect(hostWire.keepsSaves()).toBe(true);
  }, 120_000);

  it.skipIf(!built)('puts a question to whoever plays the character it is about, and nobody else answers it', async () => {
    const { server, hostDemo, host, guestDemo, guest, guestWire } = await sharing('question');
    const kara = hostDemo.party.selected!;
    // The host's walks up to a door and tries it: a roll is asked, of the host's.
    const door = interactablesOf(hostDemo.scene).find((i) => i.id === 'door-12-7')!.position;
    host.placeAt(kara, door.y * hostDemo.grid.width + door.x - 1);
    host.useSelectedOn('door-12-7');
    await settle(server);
    const asked = (server.engine.board() as BoardSnapshot).pending as { for?: string } | null;
    expect(asked?.for).toBe(kara);
    // Both pages show it, and know whom it is put to.
    expect((guestDemo.pending as { for?: string } | null)?.for).toBe(kara);
    expect(guestWire.status()).toBe('asked');
    // The guest's answer is refused by the server's game: the question still open, still the host's.
    expect(guest.answerPending({ kind: 'roll' }).status).toBe('waiting');
    await settle(server);
    expect((server.engine.board() as BoardSnapshot).pending).toEqual(asked);
    expect(guestWire.status()).toBe('asked');
    // The host's answer is taken.
    for (let n = 0; n < 10 && hostDemo.pending !== null; n++) {
      host.answerPending(n === 0 ? { kind: 'roll' } : { kind: 'choose', index: 0 });
      await settle(server);
    }
    expect((server.engine.board() as BoardSnapshot).pending).toBeNull();
    expect(guestDemo.pending).toBeNull();
  }, 120_000);
});
