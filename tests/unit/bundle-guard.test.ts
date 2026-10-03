/**
 * The build's guard (`tools/bundle-guard.mjs`, run by `npm run build` and `npm run build:server`): a built page
 * that loads the engine and carries none of its own game's rules passes; one that carries a rule's words, or
 * does not load the engine, or has no scripts, fails, saying why.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RULES_SAY, judgeBuild, rulesIn } from '../../tools/bundle-guard.mjs';

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function built(scripts: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), 'tactical-guard-'));
  made.push(folder);
  mkdirSync(join(folder, 'assets'));
  for (const [name, text] of Object.entries(scripts)) writeFileSync(join(folder, 'assets', name), text);
  return folder;
}

describe('the build\'s guard', () => {
  it('passes a page that plays the engine and carries none of its own rules', () => {
    expect(judgeBuild(built({ 'index-a.js': 'fetch("/wasm/engine.wasm"); const card = "Hit Points.";' }))).toBeNull();
  });

  it('fails one that carries a rule\'s words, one that does not load the engine, and one with no scripts', () => {
    const ruled = judgeBuild(built({ 'index-a.js': 'fetch("/wasm/engine.wasm")', 'chunk-b.js': 'note(demo, `${who} shakes off ${what}.`)' }));
    expect(ruled).toMatch(/shakes off/);
    expect(judgeBuild(built({ 'index-a.js': 'nothing' }))).toMatch(/does not load the engine/);
    expect(judgeBuild(built({ 'index.css': 'body {}' }))).toMatch(/no scripts/);
  });

  it('looks for words only a rule writes, each found', () => {
    for (const words of RULES_SAY) expect(rulesIn(`x ${words} y`)).toEqual([words]);
    expect(rulesIn('Dragged into reach of the one holding this ground.')).toEqual([]);
  });
});
