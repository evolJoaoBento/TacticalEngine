/**
 * The game as a friend reaches it (`playwright.tunnel.config.ts`): the Rust server serving the build made for it
 * (`dist-server`, `npm run build:server`) over a scratch folder of its own - the repository's `public/` and
 * `projects/` under it, `data/` empty, so nobody's accounts or saves are touched - on this machine alone, and
 * a tunnel in front of it (`proxy.mjs`).
 *
 *   node tests/tunnel/serve.mjs      (TUNNEL_SERVER_PORT, TUNNEL_PORT; the release binary built first)
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tunnel } from './proxy.mjs';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const serverPort = Number(process.env['TUNNEL_SERVER_PORT'] ?? 8441);
const publicPort = Number(process.env['TUNNEL_PORT'] ?? 8442);
const site = join(repo, 'dist-server');
if (!existsSync(join(site, 'index.html'))) throw new Error('no build for the server: npm run build:server');

const root = join(tmpdir(), 'tactical-tunnel');
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, 'data'), { recursive: true });
// The assets live, as the server serves them, without copying the models: a junction needs no rights on Windows.
symlinkSync(join(repo, 'public'), join(root, 'public'), 'junction');
cpSync(join(repo, 'projects'), join(root, 'projects'), { recursive: true });

const binary = join(repo, 'server', 'target', 'release', process.platform === 'win32' ? 'tactical-serve.exe' : 'tactical-serve');
const server = spawn(binary, ['--root', root, '--site', site, '--port', String(serverPort)], { stdio: 'inherit', windowsHide: true });
server.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill());
process.on('exit', () => server.kill());
await tunnel(publicPort, serverPort);
console.log(`tunnel: http://friends.example:${publicPort}/ -> 127.0.0.1:${serverPort}`);
