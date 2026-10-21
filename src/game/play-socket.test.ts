/**
 * The page's socket to its game on the server (`play-socket.ts`), over a stand-in for the browser's
 * WebSocket: messages written out when given and held until it opens, answers found by their id whatever
 * order they come in, a close failing what still waits and said; and when the page asks for the wire at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaySocket, hasServer, serverAccount, serverAllowed } from './play-socket';

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

  it('gives what the server says unasked - no id - to whoever listens, and nothing waiting is answered by it', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const socket = new PlaySocket('ws://page/__play');
    const fake = FakeSocket.last!;
    fake.fire('open');
    const heard: unknown[] = [];
    // Nobody listening yet: dropped.
    fake.fire('message', JSON.stringify({ table: { game: 'g' } }));
    socket.listen((message) => heard.push(message));
    const waiting = socket.send({ op: 'call', call: 'endTurn', args: [] });
    fake.fire('message', JSON.stringify({ push: { board: { log: [] }, by: 'finn' } }));
    fake.fire('message', JSON.stringify({ id: 1, ok: { answer: 2 } }));
    await expect(waiting).resolves.toEqual({ id: 1, ok: { answer: 2 } });
    expect(heard).toEqual([{ push: { board: { log: [] }, by: 'finn' } }]);
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

  it('says it has closed - once, whether it had opened - and at once to whoever asks after', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const socket = new PlaySocket('ws://page/__play');
    const fake = FakeSocket.last!;
    const shut: boolean[] = [];
    socket.onClose((opened) => shut.push(opened));
    fake.fire('open');
    expect(shut).toEqual([]);
    fake.close();
    expect(shut).toEqual([true]);
    const late: boolean[] = [];
    socket.onClose((opened) => late.push(opened));
    expect(late).toEqual([true]);
    // One that never opened says so.
    new PlaySocket('ws://page/__play').onClose((opened) => shut.push(opened));
    FakeSocket.last!.close();
    expect(shut).toEqual([true, false]);
  });

  it('keeps the beats from whoever listens, and once beaten, closes a socket that hears nothing for three, said at once', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('WebSocket', FakeSocket);
      const socket = new PlaySocket('ws://page/__play');
      const fake = FakeSocket.last!;
      // A browser whose closing lingers, as one does on a connection gone half open: the socket says it at once.
      fake.close = () => {
        fake.readyState = FakeSocket.CLOSING;
      };
      const heard: unknown[] = [];
      socket.listen((message) => heard.push(message));
      const shut: boolean[] = [];
      socket.onClose((opened) => shut.push(opened));
      fake.fire('open');
      // Never beaten - a server that does not - nothing is waited out, whatever is heard.
      fake.fire('message', JSON.stringify({ table: { game: 'early' } }));
      vi.advanceTimersByTime(600_000);
      expect(shut).toEqual([]);
      fake.fire('message', JSON.stringify({ beat: 1000 }));
      vi.advanceTimersByTime(2000);
      // Anything heard puts the silence off.
      fake.fire('message', JSON.stringify({ table: { game: 'g' } }));
      vi.advanceTimersByTime(2999);
      expect(shut).toEqual([]);
      const waiting = socket.send({ op: 'resume' });
      vi.advanceTimersByTime(1);
      expect(shut).toEqual([true]);
      expect(fake.readyState).toBe(FakeSocket.CLOSING);
      await expect(waiting).rejects.toThrow('the connection closed');
      await expect(socket.send({ op: 'resume' })).rejects.toThrow('the connection closed');
      expect(heard).toEqual([{ table: { game: 'early' } }, { table: { game: 'g' } }]);
      // The browser's close, coming at last, says nothing more; nor does anything heard after.
      fake.fire('message', JSON.stringify({ table: { game: 'late' } }));
      fake.fire('close');
      expect(shut).toEqual([true]);
      expect(heard).toEqual([{ table: { game: 'early' } }, { table: { game: 'g' } }]);
    } finally {
      vi.useRealTimers();
    }
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
    // The tests' server whose games are played on the server does ask.
    me(200, admin);
    asked.length = 0;
    expect(await serverAccount('builtin', true)).toEqual(admin);
    expect(asked).toEqual(['/__accounts/me']);
    me(200, admin);
    vi.stubGlobal('location', { search: '?play&server=off' });
    asked.length = 0;
    expect(await serverAccount('file')).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe('a server behind the page', () => {
  const development = { DEV: true, MODE: 'development' };
  const forTheServer = { DEV: false, MODE: 'server' };
  const staticBuild = { DEV: false, MODE: 'production' };

  it('is there in development and in a build the Rust server serves, and not in a static build', () => {
    expect([hasServer(development), hasServer(forTheServer), hasServer(staticBuild)]).toEqual([true, true, false]);
    vi.stubGlobal('location', { search: '' });
    expect([serverAllowed(development), serverAllowed(forTheServer), serverAllowed(staticBuild)]).toEqual([true, true, false]);
    // Turned off, in either.
    vi.stubGlobal('location', { search: '?server=off' });
    expect([serverAllowed(development), serverAllowed(forTheServer)]).toEqual([false, false]);
  });

  it('is asked who is signed in, in a build the Rust server serves, and a static build asks nobody', async () => {
    const asked: string[] = [];
    const admin = { id: 'admin', name: 'admin', admin: true };
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => admin };
    });
    vi.stubGlobal('location', { search: '' });
    expect(await serverAccount('file', false, forTheServer)).toEqual(admin);
    expect(asked).toEqual(['/__accounts/me']);
    asked.length = 0;
    expect(await serverAccount('file', false, staticBuild)).toBeNull();
    expect(asked).toEqual([]);
  });
});
