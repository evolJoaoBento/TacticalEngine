/**
 * A build of the page carries none of its own game's rules (`docs/SERVER.md`, phase 4, slice 3):
 *
 *   node tools/bundle-guard.mjs <built folder>      (run by `npm run build` and `npm run build:server`)
 *
 * The rules live in modules the page still loads for its model and its views; the page plays the engine and
 * names a rule only as a type (`Plays`, `src/game/client.ts`), so a build leaves them out. This reads the built
 * scripts for words only a rule writes into the log, and fails the build where any is there. Content that
 * says the same - a card's own text, the demo's door - is content, and is not looked for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Words the page's rules write, each in one rule: a conversation's, the GM's, a condition's end, a fall's. */
export const RULES_SAY = ['breaks off the conversation', 'The GM spends a Shadow', 'shakes off', 'There is nothing to say', 'drops unconscious', 'marks their last Hit Point'];

/** The rules' words a bundle's text carries. */
export function rulesIn(text) {
  return RULES_SAY.filter((words) => text.includes(words));
}

/** Why a built folder fails the guard, or `null`. */
export function judgeBuild(folder) {
  const assets = join(folder, 'assets');
  const scripts = readdirSync(assets).filter((file) => file.endsWith('.js'));
  if (scripts.length === 0) return `no scripts in ${assets}`;
  const bundle = scripts.map((file) => readFileSync(join(assets, file), 'utf8')).join('\n');
  if (!bundle.includes('/wasm/engine.wasm')) return 'the bundle does not load the engine';
  const found = rulesIn(bundle);
  return found.length === 0 ? null : `the page's own rules are in the bundle (${found.join('; ')}): something the page loads names a rule rather than a type`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const why = judgeBuild(process.argv[2] ?? 'dist');
  if (why !== null) {
    console.error(`bundle-guard: ${why}`);
    process.exit(1);
  }
  console.log('bundle-guard: none of the page\'s own rules in the bundle');
}
