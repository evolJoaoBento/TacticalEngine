/**
 * A build of the page plays the engine (`docs/SERVER.md`, phase 4, slice 3; phase 5, slice 0):
 *
 *   node tools/bundle-guard.mjs <built folder>      (run by `npm run build` and `npm run build:server`)
 *
 * The page's game is the engine built to WebAssembly, and a build that does not load it has no game. This
 * reads the built scripts and fails the build where none of them loads `/wasm/engine.wasm`. It once also
 * looked for words only the page's own TypeScript rules wrote into the log, while those rules lived beside
 * the page's model; they are deleted (phase 5, slice 0b), and their words are nowhere to be found.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Why a built folder fails the guard, or `null`. */
export function judgeBuild(folder) {
  const assets = join(folder, 'assets');
  const scripts = readdirSync(assets).filter((file) => file.endsWith('.js'));
  if (scripts.length === 0) return `no scripts in ${assets}`;
  const bundle = scripts.map((file) => readFileSync(join(assets, file), 'utf8')).join('\n');
  if (!bundle.includes('/wasm/engine.wasm')) return 'the bundle does not load the engine';
  return null;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const why = judgeBuild(process.argv[2] ?? 'dist');
  if (why !== null) {
    console.error(`bundle-guard: ${why}`);
    process.exit(1);
  }
  console.log('bundle-guard: the page plays the engine');
}
