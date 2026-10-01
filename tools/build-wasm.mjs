/**
 * Build the engine the page answers the pointer with (`docs/SERVER.md`, phase 3, slice 2).
 *
 *   npm run wasm
 *
 * The Rust engine, built to WebAssembly behind its JSON face (`server/wasm`), copied to
 * `public/wasm/engine.wasm` - where the page fetches it and the vitest reads it. Like the models it
 * is not committed: it is built from what is, and a page without it answers from the game alone.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where cargo is: `CARGO`, else rustup's own folder, else the PATH - as `tools/rust-server.ts` finds it. */
function cargoPath() {
  if (process.env.CARGO !== undefined) return process.env.CARGO;
  const own = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  return existsSync(own) ? own : 'cargo';
}

const built = spawnSync(cargoPath(), ['build', '--release', '-p', 'tactical-wasm', '--target', 'wasm32-unknown-unknown'], {
  cwd: join(root, 'server'),
  stdio: 'inherit',
});
if (built.status !== 0) process.exit(built.status ?? 1);

const from = join(root, 'server', 'target', 'wasm32-unknown-unknown', 'release', 'wasm_face.wasm');
const to = join(root, 'public', 'wasm', 'engine.wasm');
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`engine: ${to}`);
