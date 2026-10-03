import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNTS_URL } from '../../tools/accounts';
import { STORE_URL } from '../../tools/store';
import { IMPORT_MODEL_URL, USER_MODELS_URL, YOUR_MODELS_URL } from '../../tools/your-models';
import { ANCESTRY_URL, MODEL_ADD_URL, SHIPPED_URL } from '../../tools/model-manifest';
import { MARKS_URL, PROVENANCE_URL } from '../../tools/art-provenance';
import { PROJECT_URL, SAVE_URL } from '../../tools/default-project';
import { PLAYED_ROUTES, PLAY_URL, RUST_ROUTES, SAVES_URL, cargoPath, e2eRoot, rustProxy, serverArguments, serverPort, servesRust } from '../../tools/rust-server';
import { playsOnServer } from '../../tools/serving';
import { SAVES_URL as PAGE_SAVES_URL } from '../../src/game/account-saves';
import { forRustServer, savesChanges } from '../../tools/serving';

/**
 * The Rust server beside the dev server (`tools/rust-server.ts`): which routes it answers now, how the
 * dev server passes them on - to its port, keeping the page's own Host so the same-origin guard reads
 * as it always did - and where cargo is looked for.
 */

const kept = { port: process.env['TACTICAL_SERVER_PORT'], cargo: process.env['CARGO'] };
afterEach(() => {
  for (const [name, value] of [['TACTICAL_SERVER_PORT', kept.port], ['CARGO', kept.cargo]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the routes the Rust server answers', () => {
  it('are every route the dev plugins answered', () => {
    expect(RUST_ROUTES).toEqual([ACCOUNTS_URL, STORE_URL, YOUR_MODELS_URL, IMPORT_MODEL_URL, `${USER_MODELS_URL}/`, MODEL_ADD_URL, ANCESTRY_URL, SHIPPED_URL, PROVENANCE_URL, MARKS_URL, PROJECT_URL, SAVE_URL]);
  });

  it('catch every models route, and the models themselves in public/models not at all', () => {
    const caught = (path: string): boolean => RUST_ROUTES.some((route) => path.startsWith(route));
    expect(caught('/__models/ancestry')).toBe(true);
    expect(caught('/__models/add?name=Fox.glb')).toBe(true);
    expect(caught('/models/Fox.glb')).toBe(false);
    expect(caught('/__models/u/bramble/imported/golem.glb')).toBe(true);
    expect(caught('/__models/mine')).toBe(true);
    expect(caught('/__models/import')).toBe(true);
  });

  it('are passed on to its port, the Host kept', () => {
    delete process.env['TACTICAL_SERVER_PORT'];
    expect(serverPort()).toBe(8430);
    const to8430 = { target: 'http://127.0.0.1:8430', changeOrigin: false };
    expect(rustProxy()).toEqual({
      '/__accounts': to8430, '/__store': to8430, '/__models/mine': to8430, '/__models/import': to8430, '/__models/u/': to8430, '/__models/add': to8430, '/__models/ancestry': to8430,
      '/__models/shipped': to8430, '/__art/provenance': to8430, '/__art/marks': to8430, '/projects/default.json': to8430, '/__project/save': to8430,
      // The games: a websocket, its upgrade passed through too; and the saves they write.
      '/__play': { ...to8430, ws: true },
      '/__saves': to8430,
    });
    expect(PLAY_URL).toBe('/__play');
    expect(SAVES_URL).toBe(PAGE_SAVES_URL);
    process.env['TACTICAL_SERVER_PORT'] = '9555';
    expect(rustProxy()['/__accounts']!.target).toBe('http://127.0.0.1:9555');
  });

  it('are only signing in, the games and their saves for the tests whose games it plays', () => {
    const to = { target: 'http://127.0.0.1:8431', changeOrigin: false };
    // Never the project nor what saves it: the tests' server opens the demo from code and refuses every save.
    expect(rustProxy(8431, true)).toEqual({ '/__accounts': to, '/__play': { ...to, ws: true }, '/__saves': to });
    expect(PLAYED_ROUTES).toEqual(['/__accounts', '/__play', '/__saves']);
  });
});

describe('the dev server starting it', () => {
  it('starts one for the tests when their games are played on it, over a scratch folder, and never for Vitest', () => {
    const was = { ...process.env };
    try {
      process.env['TACTICAL_BOOT'] = 'builtin';
      delete process.env['TACTICAL_E2E_SERVER'];
      delete process.env['VITEST'];
      expect(servesRust('serve')).toBe(false);
      process.env['TACTICAL_E2E_SERVER'] = '1';
      expect(playsOnServer()).toBe(true);
      expect(servesRust('serve')).toBe(true);
      expect(servesRust('build')).toBe(false);
      process.env['TACTICAL_E2E_ROOT'] = '/scratch/e2e';
      expect(e2eRoot()).toBe('/scratch/e2e');
      // Over the scratch folder, the page's dice taken; a dev server's over the repository, its own seed.
      process.env['TACTICAL_SERVER_PORT'] = '8431';
      expect(serverArguments('/repo')).toEqual(['--root', '/scratch/e2e', '--port', '8431', '--for-tests']);
      expect(serverArguments('/repo', false)).toEqual(['--root', '/repo', '--port', '8431']);
      process.env['VITEST'] = 'true';
      expect(servesRust('serve')).toBe(false);
    } finally {
      for (const key of ['TACTICAL_BOOT', 'TACTICAL_E2E_SERVER', 'TACTICAL_E2E_ROOT', 'TACTICAL_SERVER_PORT', 'VITEST']) {
        if (was[key] === undefined) delete process.env[key];
        else process.env[key] = was[key];
      }
    }
  });

  it('is never Vitest’s, which loads the same config: a unit test run starts no server', () => {
    expect(process.env['VITEST']).toBeDefined();
    expect(servesRust('serve')).toBe(false);
    expect(servesRust('build')).toBe(false);
  });
});

describe('cargo', () => {
  it('is CARGO when it is set, and otherwise rustup’s own or the PATH’s', () => {
    process.env['CARGO'] = '/opt/rust/cargo';
    expect(cargoPath()).toBe('/opt/rust/cargo');
    delete process.env['CARGO'];
    expect(cargoPath()).toMatch(/cargo(\.exe)?$/);
  });
});

describe('a build for the Rust server', () => {
  const boot = process.env['TACTICAL_BOOT'];
  afterEach(() => {
    if (boot === undefined) delete process.env['TACTICAL_BOOT'];
    else process.env['TACTICAL_BOOT'] = boot;
  });

  it('is the `server` mode, and saves back as the dev server does', () => {
    delete process.env['TACTICAL_BOOT'];
    expect(forRustServer('server')).toBe(true);
    expect(forRustServer('production')).toBe(false);
    expect(savesChanges('build', 'server')).toBe(true);
    expect(savesChanges('serve', 'development')).toBe(true);
  });

  it('is the only build that saves: a static site is read-only, and so is the tests\u2019 server', () => {
    expect(savesChanges('build', 'production')).toBe(false);
    process.env['TACTICAL_BOOT'] = 'builtin';
    expect(savesChanges('serve', 'development')).toBe(false);
  });
});

