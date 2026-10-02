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
import { firstDifference, replicaCount } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';
import { WasmGame } from './wasm-game';
import { Wire, type Said, type Transport } from './wire';
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
  noisy = false;
  meddle: ((engine: WasmEngine, calls: number) => void) | null = null;
  reword: ((answer: unknown, calls: number) => unknown) | null = null;
  private calls = 0;
  private opens = 0;

  constructor(readonly engine: WasmEngine, private readonly seed = 'the-server') {}

  send(message: Record<string, unknown>): Promise<Said> {
    if (this.closed) return Promise.reject(new Error('closed'));
    // Written out now, as the socket does: what is told is how the game stood when it was given.
    const text = JSON.stringify(message);
    return new Promise((answered) => setTimeout(() => answered(this.answer(JSON.parse(text) as Record<string, unknown>)), 0));
  }

  close(): void {
    this.closed = true;
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
          return { ok: { seed, board: engine.board() } };
        }
        case 'restore':
          engine.restore(m['replica'] as never);
          return { ok: { board: engine.board() } };
        case 'call': {
          // The page's intents counted, not what it is told the game with.
          if (m['call'] !== 'restoreRng' && m['call'] !== 'restoreWalk') this.meddle?.(engine, ++this.calls);
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
      const wire = new Wire(server, demo, shippedContent());
      game.wireWith(wire);
      const pagesOwn = demo.rng.save();
      await wire.ready;
      expect(wire.status()).toBe('fresh');
      // The dice go on from the server's game's, not the page's own.
      expect(demo.rng.save()).not.toBe(pagesOwn);
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
    const wire = new Wire(server, demo, shippedContent());
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

  it.skipIf(!built)('opens a fresh game on the server after the editor changes the page\'s, and closes with its socket', async () => {
    const bytes = readFileSync(WASM);
    const demo = buildProjectScene(project(), 'wire:edited');
    const game = new LocalGame(demo, false);
    const server = new EngineServer(await WasmEngine.load(bytes));
    // A game opened with lines in its log already: only what is written after it is told the page's is held.
    server.noisy = true;
    const wire = new Wire(server, demo, shippedContent());
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
    // The socket goes: the wire closes, and the page plays on without it.
    server.close();
    game.selectNext();
    await settle(server);
    expect(wire.status()).toBe('closed');
    expect(() => game.selectNext()).not.toThrow();
    expect(replicaCount().first.slice(before.first.length)).toEqual([]);
  }, 60_000);
});
