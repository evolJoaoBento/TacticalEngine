/**
 * The page's socket to its game on the server (`play-socket.ts`), over a stand-in for the browser's
 * WebSocket: messages written out when given and held until it opens, answers found by their id whatever
 * order they come in, a close failing what still waits; and when the page asks for the wire at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaySocket, serverAccount } from './play-socket';

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.CONNECTING;
  readonly out: string[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  addEventListener(name: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  send(text: string): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('not open');
    this.out.push(text);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.fire('close');
  }

  fire(name: string, data?: unknown): void {
    if (name === 'open') this.readyState = FakeSocket.OPEN;
    for (const listener of this.listeners.get(name) ?? []) listener({ data });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the socket to the server\'s game', () => {
  it('writes each message when it is given, holds them until it opens, and finds each answer by its id', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const socket = new PlaySocket('ws://page/__play');
    const fake = FakeSocket.last!;
    expect(fake.url).toBe('ws://page/__play');
    const told = { replica: { round: 1 } };
    const first = socket.send({ op: 'restore', ...told });
    // Changed after it was given: what went is how it stood then.
    told.replica.round = 2;
    const second = socket.send({ op: 'call', call: 'endTurn', args: [] });
    expect(fake.out).toEqual([]);
    fake.fire('open');
    expect(fake.out.map((text) => JSON.parse(text) as unknown)).toEqual([
      { op: 'restore', replica: { round: 1 }, id: 1 },
      { op: 'call', call: 'endTurn', args: [], id: 2 },
    ]);
    // Answered out of order, and one nobody asked for: each goes to its own.
    fake.fire('message', JSON.stringify({ id: 2, ok: { answer: 0 } }));
    fake.fire('message', JSON.stringify({ id: 99, ok: null }));
    fake.fire('message', JSON.stringify({ id: 1, error: 'no game' }));
    await expect(first).resolves.toEqual({ id: 1, error: 'no game' });
    await expect(second).resolves.toEqual({ id: 2, ok: { answer: 0 } });
    // Open now: sent at once.
    void socket.send({ op: 'ask', ask: 'pressure' });
    expect(fake.out.length).toBe(3);
  });

  it('fails what still waits when it closes, and whatever is sent after', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const socket = new PlaySocket('ws://page/__play');
    const fake = FakeSocket.last!;
    fake.fire('open');
    const waiting = socket.send({ op: 'call', call: 'endTurn', args: [] });
    fake.close();
    await expect(waiting).rejects.toThrow('the connection closed');
    await expect(socket.send({ op: 'resume' })).rejects.toThrow('the connection closed');
    const held = new PlaySocket('ws://page/__play');
    const unopened = held.send({ op: 'open' });
    held.close();
    await expect(unopened).rejects.toThrow('the connection closed');
  });

  it('is for somebody signed in, in development, on a dev server that keeps accounts, unless turned off', async () => {
    const asked: string[] = [];
    const me = (status: number, body: unknown = {}) => {
      vi.stubGlobal('fetch', async (url: string) => {
        asked.push(url);
        return { ok: status === 200, status, json: async () => body };
      });
    };
    vi.stubGlobal('location', { search: '' });
    const admin = { id: 'admin', name: 'admin', admin: true };
    me(200, admin);
    // The tests' server keeps no accounts: not even asked.
    expect(await serverAccount('builtin')).toBeNull();
    expect(asked).toEqual([]);
    expect(await serverAccount('file')).toEqual(admin);
    expect(asked).toEqual(['/__accounts/me']);
    me(401);
    expect(await serverAccount('file')).toBeNull();
    me(404);
    expect(await serverAccount('file')).toBeNull();
    me(200, admin);
    vi.stubGlobal('location', { search: '?play&server=off' });
    asked.length = 0;
    expect(await serverAccount('file')).toBeNull();
    expect(asked).toEqual([]);
  });
});
