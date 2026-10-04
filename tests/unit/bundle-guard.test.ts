/**
 * The build's guard (`tools/bundle-guard.mjs`, run by `npm run build` and `npm run build:server`): a built page
 * that loads the engine passes; one that does not load it, or has no scripts, fails, saying why.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { judgeBuild } from '../../tools/bundle-guard.mjs';

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
  it('passes a page that plays the engine, in whichever of its scripts loads it', () => {
    expect(judgeBuild(built({ 'index-a.js': 'fetch("/wasm/engine.wasm"); const card = "Hit Points.";' }))).toBeNull();
    expect(judgeBuild(built({ 'index-a.js': 'boot()', 'chunk-b.js': 'fetch("/wasm/engine.wasm")' }))).toBeNull();
  });

  it('fails one that does not load the engine, and one with no scripts', () => {
    expect(judgeBuild(built({ 'index-a.js': 'nothing' }))).toMatch(/does not load the engine/);
    expect(judgeBuild(built({ 'index.css': 'body {}' }))).toMatch(/no scripts/);
  });
});
