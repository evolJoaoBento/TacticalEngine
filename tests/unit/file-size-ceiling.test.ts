/**
 * Readability guard.
 *
 * `src/game/demo-scene.ts` went from 135 lines to 5,856 in eight days. Nothing was wrong with any
 * one slice; each one put its functions where the recipe said, and the recipe said there. The
 * file was still correct — the tests said so — and nobody could read it. That is the defect this
 * catches: not a broken build but a file that has quietly stopped being somewhere a person can
 * find their way around.
 *
 * Every source under `src/` and `tests/` stays under the ceiling. The files already over it when
 * the guard was written are pinned at the size they had that day, and a pin only goes down: shrink
 * one and this asks for the number to follow, so the table is always the truth and the way out is
 * always to take a file apart, never to raise its allowance.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Lines, in a file nobody has to scroll to understand. */
const CEILING = 1500;

/**
 * Files over the ceiling on 2026-09-15, at the size they had then. Delete a row when its file goes
 * under the ceiling; lower it when the file shrinks. Never raise one.
 */
const PINNED: Record<string, number> = {
  'src/game/demo-defense.test.ts': 10523,
  'src/game/demo-scene.ts': 5251,
  'src/editor/authored-scenario.test.ts': 3416,
  'tests/e2e/demo.spec.ts': 2903,
  'src/engine/script/world.ts': 2616,
  'src/main.ts': 2572,
  'src/engine/script/runner.ts': 1953,
  'src/editor/session.ts': 1932,
  'tests/fixtures/cards.ts': 1652,
  'src/editor/validate.test.ts': 1526,
  'src/editor/ui/EffectList.tsx': 1521,
};

/** How far a pinned file may sit under its pin before the pin has to come down. */
const SLACK = 40;

const ROOTS = ['src', 'tests'];

function sourcesUnder(directory: string, relative: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = `${directory}/${entry}`;
    const path = `${relative}/${entry}`;
    if (statSync(full).isDirectory()) {
      out.push(...sourcesUnder(full, path));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** What `wc -l` says: the newlines. The repo is LF, so a last line without one is not counted. */
function lineCount(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++;
  return count;
}

const sources = ROOTS.flatMap((root) => sourcesUnder(`${repoRoot}${root}`, root)).map((path) => ({
  path,
  lines: lineCount(readFileSync(`${repoRoot}${path}`, 'utf8')),
}));

describe('no source file outgrows a reader', () => {
  it('has sources to measure', () => {
    expect(sources.length).toBeGreaterThan(100);
    const paths = sources.map((s) => s.path);
    expect(paths).toContain('src/main.ts');
    expect(paths).toContain('src/game/demo-scene.ts');
    expect(paths).toContain('tests/e2e/demo.spec.ts');
  });

  it('keeps every file under the ceiling, or under its pin', () => {
    const over = sources
      .filter((s) => s.lines > (PINNED[s.path] ?? CEILING))
      .map((s) => `${s.path}: ${s.lines} lines, allowed ${PINNED[s.path] ?? CEILING}`);
    expect(over, 'A file has outgrown its allowance. Take it apart; do not raise the number.').toEqual([]);
  });

  it('pins only files that are still over the ceiling, at their real size', () => {
    const byPath = new Map(sources.map((s) => [s.path, s.lines]));
    const stale: string[] = [];
    for (const [path, pin] of Object.entries(PINNED)) {
      const lines = byPath.get(path);
      if (lines === undefined) stale.push(`${path}: pinned but gone — delete the row`);
      else if (lines <= CEILING) stale.push(`${path}: ${lines} lines is under the ceiling — delete the row`);
      else if (pin - lines > SLACK) stale.push(`${path}: ${lines} lines, pinned at ${pin} — lower the pin`);
    }
    expect(stale, 'The pin table has drifted from the files it pins.').toEqual([]);
  });

  it('counts lines the way wc does', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('one\n')).toBe(1);
    expect(lineCount('one\ntwo\n')).toBe(2);
    // A last line without its newline is not a line to wc either.
    expect(lineCount('one\ntwo')).toBe(1);
  });
});
