/**
 * The wire (`wire.ts`): the page's game held to a game on the server, here the very `.wasm` the page loads
 * standing in for the server's - the same face and dispatcher (`engine::game::face`) - answering each message
 * a tick after it was sent, in order, as a socket does. The page plays on without waiting; the answers are
 * held to the boards it had then. Needs `npm run wasm`, and says so without it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../engine/core/rng';
import { migrateDocument } from '../engine/scene/migrate';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { boardOf, type BoardSnapshot } from './board';
import { LocalGame } from './client';
import { buildProjectScene, type DemoScene } from './demo-scene';
import { firstDifference, replicaCount, Shadow } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { WasmGame } from './wasm-game';
import { Wire, type Said, type Transport } from './wire';
import { talkingTo, talkingView } from './ui/play-views';
import { interactablesOf } from '../engine/scene/prop-functions';
import { act } from '../../tests/fixtures/random-play';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

/**
 * The server's game, answering a tick late and in order, a seed of its own at every open as the server's are;
 * `meddle` changes its game behind the page's back, `reword` what it answers, and `noisy` has a game opened
 * with lines already in its log.
 */
class EngineServer implements Transport {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  /** Messages refused because the server was closed. */
  refused = 0;
  /** The project the game kept is of, as the server's tables keep it; `null` once it has gone. */
  kept: unknown = null;
  noisy = false;
  meddle: ((engine: WasmEngine, calls: number) => void) | null = null;
  reword: ((answer: unknown, calls: number) => unknown) | null = null;
  /** A save's text changed on its way back, or a save refused outright. */
  rewordSave: ((text: string) => string) | null = null;
  refuseSave: string | null = null;
  private calls = 0;
  private opens = 0;

  constructor(readonly engine: WasmEngine, private readonly seed = 'the-server') {}

  send(message: Record<string, unknown>): Promise<Said> {
    if (this.closed) {
      this.refused++;
      return Promise.reject(new Error('closed'));
    }
    // Written out now, as the socket does: what is told is how the game stood when it was given.
    const text = JSON.stringify(message);
    return new Promise((answered) => setTimeout(() => answered(this.answer(JSON.parse(text) as Record<string, unknown>)), 0));
  }

  close(): void {
    this.closed = true;
  }

  /** A connection of its own to this server's game, which can drop - what is on its way lost with it. */
  connection(): Transport & { drop: () => void } {
    let dropped = false;
    const waiting = new Set<(why: Error) => void>();
    return {
      send: (message) => {
        if (dropped) return Promise.reject(new Error('dropped'));
        return new Promise<Said>((answer, fail) => {
          waiting.add(fail);
          void this.send(message).then(
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
        for (const fail of waiting) fail(new Error('dropped'));
        waiting.clear();
      },
    };
  }

  private answer(m: Record<string, unknown>): Said {
    this.sent.push(m);
    const engine = this.engine;
    try {
      switch (m['op']) {
        case 'open': {
          const seed = `${this.seed}:${++this.opens}`;
          engine.build(m['project'] as ProjectDoc, m['shipped'], seed, m['table'] as { animated: boolean; askDefender: boolean });
          // A rest writes its lines; what else it does, the page's game told after puts back.
          if (this.noisy) engine.call('rest', ['short']);
          this.kept = (m['project'] as ProjectDoc).id;
          return { ok: { seed, board: engine.board() } };
        }
        case 'save': {
          // The game saves itself, as a game on the server does (`play.rs`), unless it may not now.
          const blocked = this.refuseSave ?? (engine.call('saveBlockedBy', []) as string | null);
          if (blocked !== null) return { error: blocked };
          const text = engine.call('serialiseSave', []) as string;
          const slot = { id: m['slot'], name: m['name'], savedAt: 1, where: m['where'] };
          return { ok: { slot, text: this.rewordSave === null ? text : this.rewordSave(text) } };
        }
        case 'resume':
          return this.kept === null ? { error: 'no game: open one' } : { ok: { board: engine.board(), project: this.kept } };
        case 'restore':
          engine.restore(m['replica'] as never);
          return { ok: { board: engine.board() } };
        case 'call': {
          // The page's intents counted, not what the game is told with or drained of when it is.
          if (!['restoreRng', 'restoreWalk', 'restoreLog', 'restoreViews', 'takeMotions', 'takeFloaters'].includes(m['call'] as string)) this.meddle?.(engine, ++this.calls);
          const answer = engine.call(m['call'] as string, m['args'] as unknown[]);
          return { ok: { answer: this.reword === null ? answer : this.reword(answer, this.calls), board: engine.board() } };
        }
        default:
          return { error: `no op ${String(m['op'])}` };
      }
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : String(failure) };
    }
  }
}

/** Every answer on its way back, back. */
async function settle(server: EngineServer): Promise<void> {
  for (let i = 0; i < 400; i++) await new Promise((r) => setTimeout(r, 0));
  void server;
}

const project = (): ProjectDoc => projectSchema.parse(migrateDocument(JSON.parse(readFileSync(resolve(here, '../../projects/default.json'), 'utf8'))));

/** The two games, as the page and the server have them: the same, past their logs' start. */
function differ(demo: DemoScene, server: EngineServer): string | null {
  const ours = boardOf(demo);
  const theirs = server.engine.board() as BoardSnapshot;
  const parted = firstDifference({ ...ours, log: null }, { ...theirs, log: null }, 'board');
  return parted === null ? null : `${parted.path}: ${JSON.stringify(parted.game)?.slice(0, 200)} / ${JSON.stringify(parted.replica)?.slice(0, 200)}`;
}

describe('the wire to the server\'s game', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('plays on the server\'s seed from the start, and every intent in step with it, answers coming back late', async () => {
    const bytes = readFileSync(WASM);
    for (const kind of ['ts', 'wasm'] as const) {
      const demo = buildProjectScene(project(), `wire:${kind}`);
      const game = kind === 'ts' ? new LocalGame(demo, false) : new WasmGame(demo, await WasmEngine.load(bytes), shippedContent());
      const server = new EngineServer(await WasmEngine.load(bytes));
      const before = replicaCount();
      const wire = new Wire(() => server, demo, shippedContent());
      game.wireWith(wire);
      const pagesOwn = demo.rng.save();
      await wire.ready;
      expect(wire.status()).toBe('fresh');
      // The dice go on from the server's game's, not the page's own.
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
      // Told once, at the first intent - the game the server opened needed no opening again.
      expect(server.sent.filter((m) => m['op'] === 'open').length, kind).toBe(1);
      expect(server.sent.filter((m) => m['op'] === 'restore').length, kind).toBeGreaterThanOrEqual(1);
    }
  }, 300_000);

  it.skipIf(!built)('counts a parting, and stands the page\'s game where the server\'s is', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:parting');
    const game = new LocalGame(demo, false);
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
    const game = new LocalGame(demo, false);
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

  it.skipIf(!built)('opens a fresh game on the server after the editor changes the page\'s, and closes when it cannot connect again', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:edited');
    const game = new LocalGame(demo, false);
    const server = new EngineServer(await WasmEngine.load(bytes));
    // A game opened with lines in its log already: only what is written after it is told the page's is held.
    server.noisy = true;
    const wire = new Wire(() => server, demo, shippedContent(), { retries: [0, 0] });
    game.wireWith(wire);
    await wire.ready;
    expect((server.engine.board() as BoardSnapshot).log.length).toBeGreaterThan(0);
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
    // The editor gathers the party somewhere else: the server is out of step, and told again at the next intent.
    const kara = demo.party.members()[0]!;
    game.gatherParty(demo.state.entity(kara)!.tile + 2);
    expect(wire.status()).toBe('out');
    game.selectNext();
    expect(wire.status()).toBe('in');
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(2);
    expect(differ(demo, server)).toBeNull();
    // The socket goes, and will not come back: tried again twice, the wire closes, and the page plays on.
    server.close();
    game.selectNext();
    await settle(server);
    expect(wire.status()).toBe('closed');
    expect(server.refused, 'the intent, then a resume at each try').toBe(3);
    expect(() => game.selectNext()).not.toThrow();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 60_000);

  it.skipIf(!built)('connects again when the connection drops, and goes on with the game the server kept, or a fresh one', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:dropped');
    const game = new LocalGame(demo, false);
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
    // Back: the game kept, told the page's - no game opened for it - and played on, in step.
    expect(['fresh', 'in']).toContain(wire.status());
    expect(tries).toEqual([5]);
    expect(connections).toBe(2);
    game.selectNext();
    for (let n = 0; n < 12; n++) act(game, demo, g);
    await settle(server);
    // A save loaded, which puts its own log in place of both games': told the page's log when it came back,
    // the server's is the same after it, not cut at another line.
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    expect(game.loadGameText(early).ok).toBe(true);
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    expect(server.sent.filter((m) => m['op'] === 'resume').length).toBe(1);
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(1);
    // Dropped again, the game gone from the server meanwhile, and the server down a while: tried again until it
    // is up - longer each time - and a fresh game opened and told the page's.
    // Ten lines in the log first, on both, so the page's is not empty when the server is told it again.
    const ten = Array.from({ length: 10 }, (_, n) => ({ text: `Line ${n}.`, tone: 'system' }));
    expect(game.loadGameText(JSON.stringify({ ...(JSON.parse(early) as object), log: ten })).ok).toBe(true);
    await settle(server);
    server.kept = null;
    server.closed = true;
    current.drop();
    game.selectNext();
    await settle(server);
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    expect(wire.status()).toBe('out');
    expect(tries, 'the count of tries begun again once connected').toEqual([5, 5, 10]);
    game.selectNext();
    for (let n = 0; n < 12; n++) act(game, demo, g);
    await settle(server);
    expect(wire.status()).toBe('in');
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(2);
    // A save with lines in its log loaded into that fresh game - whose own log was empty when it was told the
    // page's: told the page's log too, both are cut at the same line after the load puts its log in place.
    while (demo.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    const lines = [{ text: 'One.', tone: 'system' }, { text: 'Two.', tone: 'system' }, { text: 'Three.', tone: 'system' }];
    expect(game.loadGameText(JSON.stringify({ ...(JSON.parse(early) as object), log: lines })).ok).toBe(true);
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    expect(differ(demo, server)).toBeNull();
  }, 120_000);

  it.skipIf(!built)('comes back to the game the server kept when the page is reloaded, of the same project, and no other', async () => {
    const bytes = readFileSync(WASM);
    const server = new EngineServer(await WasmEngine.load(bytes));
    const first = buildProjectScene(project(), 'wire:before-reload');
    const played = new LocalGame(first, false);
    const wire = new Wire(() => server.connection(), first, shippedContent());
    played.wireWith(wire);
    await wire.ready;
    const early = played.serialiseSave()!;
    expect(early).not.toBeNull();
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
    // The page reloaded: a fresh game of its own, from another seed, comes back to the one the server kept -
    // with the mirror beside it, as in development, built before the page came back.
    const again = buildProjectScene(project(), 'wire:after-reload');
    const game = new LocalGame(again, false);
    game.shadowWith(new Shadow(await WasmEngine.load(bytes), again, shippedContent(), await WasmEngine.load(bytes)));
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
    // A save loaded: the mirror, told the page's log when the page came back, holds the same log after it.
    while (again.pending !== null) {
      game.answerPending({ kind: 'continue' });
      await settle(server);
    }
    const loaded = game.loadGameText(early);
    expect(loaded, JSON.stringify(loaded)).toEqual({ ok: true });
    game.selectNext();
    await settle(server);
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
    // Another project's page does not come back to it: it opens its own.
    const other = buildProjectScene({ ...project(), id: 'another' }, 'wire:other');
    const elsewhere = new Wire(() => server.connection(), other, shippedContent(), { resume: true });
    new LocalGame(other, false).wireWith(elsewhere);
    await elsewhere.ready;
    expect(elsewhere.resumed).toBe(false);
    expect(elsewhere.status()).toBe('fresh');
    expect(server.sent.filter((m) => m['op'] === 'open').length).toBe(2);
    // Nor does one whose kept game has nothing kept.
    server.kept = null;
    const nothing = new Wire(() => server.connection(), buildProjectScene(project(), 'wire:nothing'), shippedContent(), { resume: true });
    await nothing.ready;
    expect(nothing.resumed).toBe(false);
    expect(nothing.status()).toBe('fresh');
  }, 120_000);

  /** A page and the server's game, the server's opening a question of its own - Kara stood beside a thing and using it - as the first intent arrives. */
  async function asking(name: string, thing: string, options: { connect?: (server: EngineServer) => () => Transport; retries?: number[]; wasm?: boolean } = {}) {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), `wire:${name}`);
    const game = options.wasm === true ? new WasmGame(demo, await WasmEngine.load(bytes), shippedContent()) : new LocalGame(demo, false);
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
    const { demo, game, server, wire, before } = await asking('asked-wasm', 'door-12-7', { wasm: true });
    expect(wire.status()).toBe('asked');
    expect(boardOf(demo).pending).toEqual((server.engine.board() as BoardSnapshot).pending);
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
    const game = new LocalGame(again, false);
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
    // Dropped again, the game gone: the question let go - the page cannot answer it - and a fresh game opened.
    server.kept = null;
    current!.drop();
    game.answerPending({ kind: 'roll' });
    await settle(server);
    expect(demo.pending).toBeNull();
    expect(wire.status()).toBe('out');
    game.selectNext();
    await settle(server);
    expect(wire.status()).toBe('in');
    expect(differ(demo, server)).toBeNull();
    expect(replicaCount().first.slice(before.first.length).length).toBe(1);
  }, 120_000);
});
