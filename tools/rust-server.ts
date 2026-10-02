import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Plugin, ProxyOptions } from 'vite';
import { ACCOUNTS_URL, servesRust } from './accounts.ts';
import { playsOnServer } from './serving.ts';
import { ANCESTRY_URL, MODEL_ADD_URL, SHIPPED_URL } from './model-manifest.ts';
import { MARKS_URL, PROVENANCE_URL } from './art-provenance.ts';
import { PROJECT_URL, SAVE_URL } from './default-project.ts';
import { STORE_URL } from './store.ts';
import { IMPORT_MODEL_URL, USER_MODELS_URL, YOUR_MODELS_URL } from './your-models.ts';

/**
 * The Rust server beside the dev server (`docs/SERVER.md`, phase 1): the routes that have moved to it are
 * passed through, and the dev server starts it.
 *
 * `RUST_ROUTES` is what has moved - every route the dev plugins answered: the accounts, the Store, your
 * models, the engine's models, the art marks and the default project, and the two lists the page asks
 * for as it opens. Vite proxies each to `tactical-serve` on `TACTICAL_SERVER_PORT` (8430),
 * keeping the Host header, so the server sees the page's own origin and host as the plugins did, and
 * its cookies come back untouched.
 *
 * Starting it: `cargo build --release` (quick once built), then the binary itself, run from here so
 * closing the dev server stops it - not `cargo run`, which on Windows would leave the server running
 * when cargo is stopped. Its lines are printed with the dev server's. If the port is taken - the
 * server run by hand with `npm run server`, or the one the last dev server started still going - it
 * tries again a few times and then leaves the port to whoever has it, since the proxy reaches that one.
 *
 * And two routes no plugin ever answered: the games the server plays (`PLAY_URL`, phase 3 slice 3c), a
 * websocket, passed through as one - its upgrade too - and the saves those games write (`SAVES_URL`).
 *
 * The tests' server whose games the Rust server plays (`TACTICAL_E2E_SERVER=1`) starts one of its own, over a
 * scratch folder (`TACTICAL_E2E_ROOT`) on the port the tests give it, and passes it the accounts, the games and
 * their saves (`PLAYED_ROUTES`) and nothing else: the project and what saves it stay the tests' server's, which
 * opens the demo from code and refuses every save.
 *
 * When the tests are serving (`TACTICAL_BOOT=builtin`), or for a build, there is no server and no
 * proxy: the plugins answer those routes as they always did (404: no accounts). Nor under Vitest, which
 * loads this config as a dev server of its own (`servesRust`): a unit test run must not start one.
 */

/**
 * The routes the Rust server answers now. A proxy key is a prefix, so a player's files go by
 * `/__models/u/` - with its slash - and catch nothing else under `/__models/`.
 */
export const RUST_ROUTES: readonly string[] = [ACCOUNTS_URL, STORE_URL, YOUR_MODELS_URL, IMPORT_MODEL_URL, `${USER_MODELS_URL}/`, MODEL_ADD_URL, ANCESTRY_URL, SHIPPED_URL, PROVENANCE_URL, MARKS_URL, PROJECT_URL, SAVE_URL];

export { servesRust };

/** The server's games: a websocket behind the session cookie (`server/serve/src/play.rs`). */
export const PLAY_URL = '/__play';
/** Each player's saves, which their games on the server write (`server/serve/src/saves.rs`). */
export const SAVES_URL = '/__saves';

/** What the tests' server passes to the Rust server when it plays their games: signing in, the games, their saves. */
export const PLAYED_ROUTES: readonly string[] = [ACCOUNTS_URL, PLAY_URL, SAVES_URL];

/** The scratch folder the tests' Rust server keeps its accounts and saves in. */
export const e2eRoot = (): string => process.env['TACTICAL_E2E_ROOT'] ?? join(tmpdir(), 'tactical-e2e-server');

export const serverPort = (): number => Number(process.env['TACTICAL_SERVER_PORT'] ?? 8430);

/** Where cargo is: `CARGO`, else rustup's own folder (a shell opened before Rust was installed has no PATH to it), else the PATH. */
export function cargoPath(): string {
  if (process.env['CARGO'] !== undefined) return process.env['CARGO'];
  const own = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
  return existsSync(own) ? own : 'cargo';
}

/** The proxy entries for the moved routes, the games' websocket and their saves - only the last three for the tests. */
export function rustProxy(port: number = serverPort(), tests: boolean = playsOnServer()): Record<string, ProxyOptions> {
  const target = `http://127.0.0.1:${port}`;
  if (tests) return Object.fromEntries(PLAYED_ROUTES.map((route) => [route, { target, changeOrigin: false, ...(route === PLAY_URL ? { ws: true } : {}) }]));
  return {
    ...Object.fromEntries(RUST_ROUTES.map((route) => [route, { target, changeOrigin: false }])),
    [PLAY_URL]: { target, changeOrigin: false, ws: true },
    [SAVES_URL]: { target, changeOrigin: false },
  };
}

/**
 * How the server is started: over the repository on its port - or, for the tests whose games it plays, over
 * their scratch folder, each game taking the page's dice (`--dice-from-page`) so the suite rolls what it was
 * written for.
 */
export function serverArguments(root: string, tests: boolean = playsOnServer()): string[] {
  return tests ? ['--root', e2eRoot(), '--port', String(serverPort()), '--dice-from-page'] : ['--root', root, '--port', String(serverPort())];
}

/**
 * The one server this process has started, whichever dev server started it. On `globalThis`, because a
 * restart loads this file afresh: several restarts at once (a few `tools/*.ts` saved together) each had
 * their own idea of the server, and an older one's outlived its dev server and kept the port.
 */
interface Held {
  child: ChildProcess | null;
  build: ChildProcess | null;
  exitHooked: boolean;
}
const held = ((globalThis as Record<string, unknown>)['__tacticalServe'] ??= { child: null, build: null, exitHooked: false }) as Held;
if (!held.exitHooked) {
  held.exitHooked = true;
  process.once('exit', () => {
    held.child?.kill();
    held.build?.kill();
  });
}

export function rustServer(): Plugin {
  let root = process.cwd();
  let on = false;
  let closed = false;
  const say = (line: string): void => console.log(`[tactical-serve] ${line}`);

  const run = (binary: string, tries: number): void => {
    if (closed) return;
    const started = Date.now();
    const child = spawn(binary, serverArguments(root), { cwd: root, windowsHide: true });
    held.child = child;
    child.stdout?.on('data', (chunk: Buffer) => say(chunk.toString().trim()));
    child.stderr?.on('data', (chunk: Buffer) => say(chunk.toString().trim()));
    child.on('exit', (code) => {
      if (held.child === child) held.child = null;
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
      // Whatever an earlier dev server in this process left running goes first: this one starts its own.
      held.child?.kill();
      held.build?.kill();
      say('building (the first time takes a minute or two)...');
      const build = spawn(cargoPath(), ['build', '--release', '--quiet', '--manifest-path', manifest, '-p', 'tactical-serve'], { cwd: root, windowsHide: true });
      held.build = build;
      build.stderr?.on('data', (chunk: Buffer) => say(chunk.toString().trim()));
      build.on('error', () => say('cargo was not found: install Rust (rustup) for the accounts; see docs/SERVER.md'));
      build.on('exit', (code) => {
        if (code === 0) run(binary, 5);
        else if (code !== null) say(`the build failed (${code}): the accounts are not being answered`);
      });
      // Stopped when this dev server is closed - a restart, or the end - not when its HTTP server says it has
      // closed: that waits for every open connection, and a browser's keep-alive can hold it for good, so
      // the server outlived the dev server that started it and the next one found its port taken.
      const close = server.close.bind(server);
      server.close = async () => {
        closed = true;
        held.child?.kill();
        build.kill();
        return close();
      };
    },
  };
}
