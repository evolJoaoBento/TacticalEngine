import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Plugin, ProxyOptions } from 'vite';
import { ACCOUNTS_URL, servesRust } from './accounts.ts';
import { ANCESTRY_URL, MODEL_ADD_URL } from './model-manifest.ts';
import { STORE_URL } from './store.ts';
import { IMPORT_MODEL_URL, USER_MODELS_URL, YOUR_MODELS_URL } from './your-models.ts';

/**
 * The Rust server beside the dev server (`docs/SERVER.md`, phase 1): the routes that have moved to it are
 * passed through, and the dev server starts it.
 *
 * `RUST_ROUTES` is what has moved - the accounts, the Store, your models and the engine's models, so far; each dev plugin's route leaves `tools/*.ts`
 * for `server/serve` in turn. Vite proxies each to `tactical-serve` on `TACTICAL_SERVER_PORT` (8430),
 * keeping the Host header, so the server sees the page's own origin and host as the plugins did, and
 * its cookies come back untouched.
 *
 * Starting it: `cargo build --release` (quick once built), then the binary itself, run from here so
 * closing the dev server stops it - not `cargo run`, which on Windows would leave the server running
 * when cargo is stopped. Its lines are printed with the dev server's. If the port is taken - the
 * server run by hand with `npm run server`, or the one the last dev server started still going - it
 * tries again a few times and then leaves the port to whoever has it, since the proxy reaches that one.
 *
 * When the tests are serving (`TACTICAL_BOOT=builtin`), or for a build, there is no server and no
 * proxy: the plugins answer those routes as they always did (404: no accounts). Nor under Vitest, which
 * loads this config as a dev server of its own (`servesRust`): a unit test run must not start one.
 */

/**
 * The routes the Rust server answers now. A proxy key is a prefix, so a player's files go by
 * `/__models/u/` - with its slash - and catch nothing else under `/__models/`.
 */
export const RUST_ROUTES: readonly string[] = [ACCOUNTS_URL, STORE_URL, YOUR_MODELS_URL, IMPORT_MODEL_URL, `${USER_MODELS_URL}/`, MODEL_ADD_URL, ANCESTRY_URL];

export { servesRust };

export const serverPort = (): number => Number(process.env['TACTICAL_SERVER_PORT'] ?? 8430);

/** Where cargo is: `CARGO`, else rustup's own folder (a shell opened before Rust was installed has no PATH to it), else the PATH. */
export function cargoPath(): string {
  if (process.env['CARGO'] !== undefined) return process.env['CARGO'];
  const own = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  return existsSync(own) ? own : 'cargo';
}

/** The proxy entries for the moved routes. */
export function rustProxy(port: number = serverPort()): Record<string, ProxyOptions> {
  return Object.fromEntries(RUST_ROUTES.map((route) => [route, { target: `http://127.0.0.1:${port}`, changeOrigin: false }]));
}

export function rustServer(): Plugin {
  let root = process.cwd();
  let on = false;
  let child: ChildProcess | null = null;
  let closed = false;
  const say = (line: string): void => console.log(`[tactical-serve] ${line}`);

  const run = (binary: string, tries: number): void => {
    if (closed) return;
    const started = Date.now();
    child = spawn(binary, ['--root', root, '--port', String(serverPort())], { cwd: root, windowsHide: true });
    child.stdout?.on('data', (chunk: Buffer) => say(chunk.toString().trim()));
    child.stderr?.on('data', (chunk: Buffer) => say(chunk.toString().trim()));
    child.on('exit', (code) => {
      child = null;
      // A quick exit is a port still held: by the last dev server's, which is on its way out, or by hand.
      if (closed || code === 0 || Date.now() - started > 3000) return;
      if (tries > 0) setTimeout(() => run(binary, tries - 1), 1000);
      else say(`port ${serverPort()} is someone else's: the routes go to whatever answers there`);
    });
  };

  return {
    name: 'tactical-rust-server',
    config(_config, env) {
      on = servesRust(env.command);
      return on ? { server: { proxy: rustProxy() } } : {};
    },
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      if (!on) return;
      const manifest = resolve(root, 'server', 'Cargo.toml');
      const binary = resolve(root, 'server', 'target', 'release', process.platform === 'win32' ? 'tactical-serve.exe' : 'tactical-serve');
      say('building (the first time takes a minute or two)...');
      const build = spawn(cargoPath(), ['build', '--release', '--quiet', '--manifest-path', manifest, '-p', 'tactical-serve'], { cwd: root, windowsHide: true });
      build.stderr?.on('data', (chunk: Buffer) => say(chunk.toString().trim()));
      build.on('error', () => say('cargo was not found: install Rust (rustup) for the accounts; see docs/SERVER.md'));
      build.on('exit', (code) => {
        if (code === 0) run(binary, 5);
        else if (code !== null) say(`the build failed (${code}): the accounts are not being answered`);
      });
      // Stopped when this dev server is closed - a restart, or the end - not when its HTTP server says it has
      // closed: that waits for every open connection, and a browser's keep-alive can hold it for good, so
      // the server outlived the dev server that started it and the next one found its port taken.
      const stop = (): void => {
        closed = true;
        child?.kill();
        build.kill();
      };
      const close = server.close.bind(server);
      server.close = async () => {
        stop();
        return close();
      };
      stopOnExit.add(stop);
      server.httpServer?.on('close', () => stopOnExit.delete(stop));
    },
  };
}

/** Whatever the dev servers in this process started, stopped when the process ends. One listener, however many restarts. */
const stopOnExit = new Set<() => void>();
process.once('exit', () => {
  for (const stop of stopOnExit) stop();
});
