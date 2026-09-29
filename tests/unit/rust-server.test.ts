import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNTS_URL } from '../../tools/accounts';
import { STORE_URL } from '../../tools/store';
import { RUST_ROUTES, cargoPath, rustProxy, serverPort, servesRust } from '../../tools/rust-server';

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
  it('are the accounts and the Store, so far', () => {
    expect(RUST_ROUTES).toEqual([ACCOUNTS_URL, STORE_URL]);
  });

  it('are passed on to its port, the Host kept', () => {
    delete process.env['TACTICAL_SERVER_PORT'];
    expect(serverPort()).toBe(8430);
    const to8430 = { target: 'http://127.0.0.1:8430', changeOrigin: false };
    expect(rustProxy()).toEqual({ '/__accounts': to8430, '/__store': to8430 });
    process.env['TACTICAL_SERVER_PORT'] = '9555';
    expect(rustProxy()['/__accounts']!.target).toBe('http://127.0.0.1:9555');
  });
});

describe('the dev server starting it', () => {
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
