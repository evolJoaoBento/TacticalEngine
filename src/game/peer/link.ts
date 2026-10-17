/**
 * A peer game's connections (`docs/PEER.md`): the way a page talks to the host's table when there is no server.
 *
 * A `Link` carries text both ways and says once when it has closed: a WebRTC data channel between a guest's page and
 * the host's (`channelLink`), or a `MessagePort` between the host's own page and the table it keeps (`portLink`) - so
 * the host plays through the same path as everybody else, each message its own task, as off a socket. `LinkTransport`
 * is the page's end of one, the wire's `Transport` (`wire.ts`) as `PlaySocket` is a websocket's (`play-socket.ts`):
 * each message numbered (`id`) and its answer found by it, what the table says unasked given to whoever listens, and
 * whatever still waits failed when the link closes.
 *
 * A port says nothing when its other end goes, so whichever end closes first says so (`BYE`) before it does.
 */

import type { Said, Transport } from '../wire';

export interface Link {
  send(text: string): void;
  /** Every text heard, as it comes. */
  onText(heard: (text: string) => void): void;
  /** Told once the link has closed, by either end - at once, if it already has. */
  onClose(shut: () => void): void;
  close(): void;
}

/** What a port's end says as it closes: the other end closes too. */
const BYE = '{"bye":true}';

/** A `MessagePort` as a link. */
export function portLink(port: MessagePort): Link {
  let heard: (text: string) => void = () => undefined;
  let shut: (() => void) | null = null;
  let gone = false;
  const end = (): void => {
    if (gone) return;
    gone = true;
    port.close();
    shut?.();
  };
  port.onmessage = (event: MessageEvent) => {
    if (gone) return;
    const text = String(event.data);
    if (text === BYE) return end();
    heard(text);
  };
  return {
    send: (text) => {
      if (!gone) port.postMessage(text);
    },
    onText: (h) => {
      heard = h;
    },
    onClose: (s) => {
      shut = s;
      if (gone) s();
    },
    close: () => {
      if (!gone) port.postMessage(BYE);
      end();
    },
  };
}

/** A WebRTC data channel as a link. */
export function channelLink(channel: RTCDataChannel): Link {
  let heard: (text: string) => void = () => undefined;
  let shut: (() => void) | null = null;
  let gone = channel.readyState === 'closing' || channel.readyState === 'closed';
  const end = (): void => {
    if (gone) return;
    gone = true;
    shut?.();
  };
  channel.addEventListener('message', (event: MessageEvent) => {
    if (!gone) heard(String(event.data));
  });
  channel.addEventListener('close', end);
  channel.addEventListener('error', end);
  return {
    send: (text) => {
      if (!gone && channel.readyState === 'open') channel.send(text);
    },
    onText: (h) => {
      heard = h;
    },
    onClose: (s) => {
      shut = s;
      if (gone) s();
    },
    close: () => {
      channel.close();
      end();
    },
  };
}

/** Both ends of a port pair: the page's and the table's. */
export function linkedPorts(): [Link, Link] {
  const { port1, port2 } = new MessageChannel();
  return [portLink(port1), portLink(port2)];
}

/** The page's end of a link: numbered messages and their answers, the rest given to whoever listens. */
export class LinkTransport implements Transport {
  private next = 1;
  private readonly waiting = new Map<number, { answer: (said: Said) => void; fail: (why: Error) => void }>();
  private heard: ((message: Record<string, unknown>) => void) | null = null;
  private shut: ((opened: boolean) => void) | null = null;
  private gone = false;

  constructor(private readonly link: Link) {
    link.onText((text) => {
      if (this.gone) return;
      let said: Said & { id?: number };
      try {
        said = JSON.parse(text) as Said & { id?: number };
      } catch {
        return;
      }
      if (typeof said.id !== 'number') return this.heard?.(said as Record<string, unknown>);
      const waiter = this.waiting.get(said.id);
      if (waiter === undefined) return;
      this.waiting.delete(said.id);
      waiter.answer(said);
    });
    link.onClose(() => this.ended());
  }

  private ended(): void {
    if (this.gone) return;
    this.gone = true;
    for (const { fail } of this.waiting.values()) fail(new Error('the connection closed'));
    this.waiting.clear();
    this.shut?.(true);
  }

  send(message: Record<string, unknown>): Promise<Said> {
    if (this.gone) return Promise.reject(new Error('the connection closed'));
    const id = this.next++;
    return new Promise<Said>((answer, fail) => {
      this.waiting.set(id, { answer, fail });
      this.link.send(JSON.stringify({ ...message, id }));
    });
  }

  close(): void {
    this.link.close();
    this.ended();
  }

  listen(heard: (message: Record<string, unknown>) => void): void {
    this.heard = heard;
  }

  onClose(shut: (opened: boolean) => void): void {
    this.shut = shut;
    if (this.gone) shut(true);
  }

  /** Whether the link has closed. */
  get closed(): boolean {
    return this.gone;
  }
}
