/**
 * The page's way to its game on the server (`wire.ts`): the websocket at `/__play`, opened with the session
 * cookie the browser sends of itself, from the page's own origin.
 *
 * Each message is written out the moment it is given - a game told how it stands must be told how it stood
 * then, not after the intent that follows - and held until the socket is open; answers come back in the order
 * the messages went, each found by its `id`. A socket that closes fails whatever is still waiting, and the
 * wire with it.
 */

import { whoAmI } from './accounts';
import type { Said, Transport } from './wire';

export const PLAY_URL = '/__play';

export class PlaySocket implements Transport {
  private readonly socket: WebSocket;
  private next = 1;
  private readonly waiting = new Map<number, { answer: (said: Said) => void; fail: (why: Error) => void }>();
  private held: string[] | null = [];

  constructor(url: string = `${location.origin.replace(/^http/, 'ws')}${PLAY_URL}`) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      for (const text of this.held ?? []) this.socket.send(text);
      this.held = null;
    });
    this.socket.addEventListener('message', (event) => {
      const said = JSON.parse(String(event.data)) as Said & { id?: number };
      const waiter = typeof said.id === 'number' ? this.waiting.get(said.id) : undefined;
      if (waiter === undefined) return;
      this.waiting.delete(said.id!);
      waiter.answer(said);
    });
    this.socket.addEventListener('close', () => this.failAll());
  }

  send(message: Record<string, unknown>): Promise<Said> {
    const id = this.next++;
    const text = JSON.stringify({ ...message, id });
    if (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED) return Promise.reject(new Error('the connection closed'));
    return new Promise<Said>((answer, fail) => {
      this.waiting.set(id, { answer, fail });
      if (this.held !== null) this.held.push(text);
      else this.socket.send(text);
    });
  }

  close(): void {
    this.socket.close();
    this.failAll();
  }

  private failAll(): void {
    this.held = null;
    for (const { fail } of this.waiting.values()) fail(new Error('the connection closed'));
    this.waiting.clear();
  }
}

/**
 * Whether the page's game is held to one on the server: in development, on a dev server that keeps accounts
 * (not the tests', which has no server to ask), for somebody signed in, and not turned off (`?server=off`).
 */
export async function serverWanted(boot: 'file' | 'builtin'): Promise<boolean> {
  if (!import.meta.env.DEV || boot === 'builtin') return false;
  if (new URLSearchParams(location.search).get('server') === 'off') return false;
  const who = await whoAmI();
  return who !== null && who !== 'none';
}
