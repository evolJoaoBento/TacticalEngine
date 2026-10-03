/**
 * The page's own TypeScript game - its rules - is the oracle the Rust is held to, quarantined (`docs/SERVER.md`,
 * phase 4, slice 3): nothing the page loads as it starts reaches it. Walked from `src/main.ts` by the imports
 * that load with a module - not `import type` or `export type`, which are erased, nor an `import(...)` made on
 * request (the oracle, in development only) - no module under `src/game/oracle/` is reached; the tests, which
 * play the oracle, do reach it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ORACLE = resolve(repo, 'src/game/oracle');

/** The modules a module loads with it: its static imports and re-exports that are not types alone. */
function loaded(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  const statement = /^\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const match of text.matchAll(statement)) {
    if (match[2] !== undefined) continue;
    const spec = match[4] ?? match[5]!;
    if (!spec.startsWith('.')) continue;
    const base = resolve(dirname(file), spec);
    const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find((candidate) => existsSync(candidate) && !candidate.endsWith('.css') && /\.tsx?$/.test(candidate));
    if (found !== undefined) out.push(found);
  }
  return out;
}

function reachedFrom(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...loaded(file));
  }
  return seen;
}

describe('the oracle, quarantined', () => {
  it('is reached by nothing the page loads as it starts', () => {
    const page = reachedFrom(resolve(repo, 'src/main.ts'));
    // The walk sees the page: its game, its views, the engine it plays.
    for (const module of ['src/game/client.ts', 'src/game/wasm-game.ts', 'src/game/board.ts', 'src/game/ui/play-views.ts']) {
      expect(page.has(resolve(repo, module)), module).toBe(true);
    }
    expect([...page].filter((file) => file.startsWith(ORACLE))).toEqual([]);
  });

  it('is what the tests play, and holds the page\'s rules', () => {
    expect(reachedFrom(resolve(repo, 'src/game/mirror.test.ts')).has(resolve(ORACLE, 'local-game.ts'))).toBe(true);
    const rules = loaded(resolve(ORACLE, 'local-game.ts'));
    expect(rules).toContain(resolve(ORACLE, 'plays.ts'));
  });
});
