/**
 * The engine the page loads, asked what the TypeScript was asked (`server/fixtures/replica.json`).
 *
 * The very `public/wasm/engine.wasm` the page fetches - `npm run wasm` builds it from `server/` - stood up
 * from each session's project, told how the game stood after every step, and asked what the pointer asks.
 * The native Rust is held to the same fixture with a fresh session every step
 * (`server/hooks/tests/golden_replica.rs`); this holds the build and the face, one session a game, the
 * way the page uses it. Without the build there is nothing to ask, and it says so rather than passing.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WasmEngine } from './wasm-engine';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const FIXTURE = resolve(here, '../../server/fixtures/replica.json');
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));
const built = existsSync(WASM);

interface Step {
  replica: Parameters<WasmEngine['restore']>[0];
  asks: {
    reach: unknown;
    pressure: number[];
    previews: { destination: number; aim: { x: number; y: number }; result: unknown }[];
    cards: { id: string; ability: string; targets: string[]; tiles: number[]; shapes: { tile: number; caught: string[] }[] }[];
    jump: { offered: boolean; aim: number[] | null; reaches: { destination: number; aim: { x: number; y: number } | null; result: boolean }[] };
  };
}

describe('the engine the page loads', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('answers every step of replica.json as the game answered it', async () => {
    const engine = await WasmEngine.load(readFileSync(WASM));
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { shipped: unknown; projects: never[]; sessions: { name: string; project: number; steps: Step[] }[] };
    let asked = 0;
    for (const played of fixture.sessions) {
      engine.build(fixture.projects[played.project]!, fixture.shipped, `wasm:${played.name}`);
      played.steps.forEach((step, n) => {
        const at = `${played.name}, step ${n}`;
        engine.restore(step.replica);
        const { asks } = step;
        expect(plain(engine.reach()), `${at}: reach`).toEqual(plain(asks.reach));
        expect(engine.pressure(), `${at}: under pressure`).toEqual(asks.pressure);
        for (const preview of asks.previews) expect(plain(engine.preview(preview.destination, preview.aim)), `${at}: preview`).toEqual(plain(preview.result));
        for (const card of asks.cards) {
          expect(engine.targets(card.id, card.ability), `${at}: ${card.ability} aimed at`).toEqual(card.targets);
          expect(engine.tiles(card.id, card.ability), `${at}: ${card.ability} lands`).toEqual(card.tiles);
          for (const shape of card.shapes) expect(engine.shape(card.id, card.ability, shape.tile), `${at}: ${card.ability} catches`).toEqual(shape.caught);
        }
        expect(engine.jumpOffered(), `${at}: a jump offered`).toBe(asks.jump.offered);
        expect(engine.jumpAim(), `${at}: a jump's tiles`).toEqual(asks.jump.aim);
        const who = step.replica.party.selected;
        if (who !== null) for (const reach of asks.jump.reaches) expect(engine.jumpReaches(who, reach.destination, reach.aim ?? undefined), `${at}: a jump reaches`).toBe(reach.result);
        asked++;
      });
    }
    expect(asked).toBeGreaterThan(300);
  }, 300_000);

  it.skipIf(!built)('says why when it cannot answer', async () => {
    const engine = await WasmEngine.load(readFileSync(WASM));
    expect(() => engine.pressure()).toThrow('the engine: no game: build one first');
  });
});
