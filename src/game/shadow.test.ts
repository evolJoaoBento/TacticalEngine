/**
 * The shadow (`shadow.ts`): a question put to the game and to the replica, the game's answer given and any
 * parting counted. Asks the very engine the page loads, so it needs `npm run wasm`, and says so without it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoScene } from './demo-scene';
import { hollowVaultMap } from './demo-map';
import { underPressureTiles, reachableTiles } from './movement';
import { replicaCount, Shadow } from './shadow';
import { shippedContent } from './shipped';
import { WasmEngine } from './wasm-engine';

const here = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(here, '../../public/wasm/engine.wasm');
const built = existsSync(WASM);

describe('the shadow', () => {
  if (!built) console.warn(`${WASM} is not built: \`npm run wasm\` builds it, and these are skipped until it is`);

  it.skipIf(!built)('gives the game\'s answer, and counts nothing where the replica agrees', async () => {
    const demo = buildDemoScene(hollowVaultMap(), 'shadow');
    const shadow = new Shadow(await WasmEngine.load(readFileSync(WASM)), demo, shippedContent());
    const before = replicaCount();
    const answer = shadow.check('pressure', [], () => underPressureTiles(demo), (e) => e.pressure());
    expect(answer).toEqual(underPressureTiles(demo));
    const field = shadow.check('reach', [], () => reachableTiles(demo), (e) => e.reach(), (f) => ({ start: f.start, budget: Number.isFinite(f.budget) ? f.budget : null, tiles: f.tiles(), cost: f.tiles().map((t) => (Number.isFinite(f.costTo(t)) ? f.costTo(t) : null)) }));
    expect(field.tiles().length).toBeGreaterThan(0);
    const after = replicaCount();
    expect(after.asked - before.asked).toBe(2);
    expect(after.parted - before.parted).toBe(0);
  });

  it.skipIf(!built)('counts a parting, keeps what each said, and still gives the game\'s answer', async () => {
    const demo = buildDemoScene(hollowVaultMap(), 'shadow');
    const shadow = new Shadow(await WasmEngine.load(readFileSync(WASM)), demo, shippedContent());
    const before = replicaCount();
    const answer = shadow.check('pressure', ['asked'], () => [1, 2, 3], () => [4]);
    expect(answer).toEqual([1, 2, 3]);
    const after = replicaCount();
    expect(after.parted - before.parted).toBe(1);
    expect(after.first.at(-1)).toEqual({ question: 'pressure', asked: ['asked'], game: [1, 2, 3], replica: [4] });
  });

  it.skipIf(!built)('builds the replica again when the project has changed, and is told the game again', async () => {
    const demo = buildDemoScene(hollowVaultMap(), 'shadow');
    const shadow = new Shadow(await WasmEngine.load(readFileSync(WASM)), demo, shippedContent());
    shadow.check('pressure', [], () => underPressureTiles(demo), (e) => e.pressure());
    shadow.projectChanged();
    const before = replicaCount();
    shadow.check('jumpOffered', [], () => true, (e) => e.jumpOffered() || true);
    expect(replicaCount().parted - before.parted).toBe(0);
  });

  it.skipIf(!built)('says where telling the replica failed, and the game still answers', async () => {
    const demo = buildDemoScene(hollowVaultMap(), 'shadow');
    const shadow = new Shadow(await WasmEngine.load(readFileSync(WASM)), demo, { not: 'content' });
    const before = replicaCount();
    expect(shadow.check('pressure', [], () => [7], (e) => e.pressure())).toEqual([7]);
    const after = replicaCount();
    expect(after.parted - before.parted).toBe(1);
    expect(JSON.stringify(after.first.at(-1))).toContain('failed');
  });
});
