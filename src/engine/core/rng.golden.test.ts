/**
 * The dice as the Rust server must roll them (`docs/SERVER.md`): this drives `createRng` through every
 * call it has, for seeds of every kind, and holds the answers to `server/fixtures/rng.json` - the file
 * the Rust port replays (`server/engine/tests/golden_rng.rs`). So the fixture is always what TypeScript
 * really does. `UPDATE_GOLDEN=1 npx vitest run src/engine/core/rng.golden.test.ts` writes it afresh.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, hashSeed } from './rng';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../server/fixtures/rng.json');

/** Seeds of every kind: text (with letters outside ASCII and outside the BMP), and numbers `>>> 0` folds. */
const TEXT_SEEDS = ['', 'demo', 'project', 'The Hollow Vault', 'Ælfric', 'dé 🎲 dado'];
const NUMBER_SEEDS = [0, 1, 42, 0xffffffff, 0x1_0000_0000 + 7, -1, -123456, 1.75, 2 ** 40 + 3];
const MAXES = [1, 2, 3, 6, 7, 10, 12, 20, 100, 1000, 0x7fffffff, 0x80000001, 0xffffffff];

function play(seed: number | string) {
  const rng = createRng(seed);
  const start = rng.save();
  // `next` is a u32 over 2^32, exact in a double: the u32 is what is compared.
  const uint32 = Array.from({ length: 8 }, () => rng.next() * 0x1_0000_0000);
  const ints = MAXES.map((max) => [max, rng.nextInt(max), rng.nextInt(max)]);
  const d20 = Array.from({ length: 10 }, () => rng.die(20));
  const dice = rng.dice(4, 6);
  const picked = Array.from({ length: 5 }, () => rng.pick(['a', 'b', 'c', 'd', 'e', 'f', 'g']));
  const shuffled = rng.shuffle(Array.from({ length: 12 }, (_, i) => i));
  const fork = rng.fork();
  const forked = Array.from({ length: 4 }, () => fork.next() * 0x1_0000_0000);
  const after = rng.save();
  const resumed = createRng(0);
  resumed.restore(after);
  return { seed, start, uint32, ints, d20, dice, picked, shuffled, forked, forkState: fork.save(), after, resumedNext: resumed.next() * 0x1_0000_0000 };
}

function golden() {
  return {
    about: 'core/rng.ts played for the Rust port; written by src/engine/core/rng.golden.test.ts',
    hashSeed: TEXT_SEEDS.map((seed) => [seed, hashSeed(seed)]),
    runs: [...TEXT_SEEDS, ...NUMBER_SEEDS].map(play),
  };
}

describe('the dice, as the Rust port must roll them', () => {
  it('are what server/fixtures/rng.json holds', () => {
    const now = golden();
    if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`, 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(now);
  });
});
