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
 * A port says nothing when its other end goes, so whichever end closes first says so (`BYE`) before it does. A data
 * channel takes a message only so long (a browser's `max-message-size`, a quarter of a megabyte or less), and a project
 * a guest boots with or goes into with the host is longer - a camp with the SRD's characters laid in it, an adventure -
 * so a long text is sent in pieces (`pieces`) and put together again as they come (`Joiner`), in order, as the channel
 * keeps them.
 */

import type { Said, Transport } from '../wire';

export interface Link {
  send(text: string): void;
  /** Every text heard, as it comes. */
  onText(heard: (text: string) => void): void;
  /** Told once the link has closed, by either end - at once, if it already has; everybody who asked. */
  onClose(shut: () => void): void;
  close(): void;
}

/** What a port's end says as it closes: the other end closes too. */
const BYE = '{"bye":true}';

/** A `MessagePort` as a link. */
export function portLink(port: MessagePort): Link {
  let heard: (text: string) => void = () => undefined;
  const shut: (() => void)[] = [];
  let gone = false;
  const end = (): void => {
    if (gone) return;
    gone = true;
    port.close();
    for (const s of shut) s();
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
      shut.push(s);
      if (gone) s();
    },
    close: () => {
      if (!gone) port.postMessage(BYE);
      end();
    },
  };
}

/** What a piece of a long text begins with: no message does - each is JSON. */
const PIECE = String.fromCharCode(0);

/** How long a text a channel is given at once, in characters: three bytes each at most, well under any browser's limit. */
export const PIECE_LONGEST = 16_000;

/** A text as a channel is given it: whole, or in pieces, each saying how many are still to come after it. */
export function pieces(text: string, longest = PIECE_LONGEST): string[] {
  if (text.length <= longest && !text.startsWith(PIECE)) return [text];
  const parts: string[] = [];
  for (let at = 0; at < text.length; at += longest) parts.push(text.slice(at, at + longest));
  return parts.map((part, index) => `${PIECE}${parts.length - 1 - index}${PIECE}${part}`);
}

/** The texts a channel was given, put together again from their pieces as they come, in order. */
export class Joiner {
  private held: string[] = [];

  /** A message as it came: the text it completes, or `null` while more pieces are to come. */
  take(message: string): string | null {
    if (!message.startsWith(PIECE)) return message;
    const split = message.indexOf(PIECE, 1);
    const left = Number(message.slice(1, split));
    this.held.push(message.slice(split + 1));
    if (left > 0) return null;
    const whole = this.held.join('');
    this.held = [];
    return whole;
  }
}

/** A WebRTC data channel as a link: a long text sent in pieces and put together again (`pieces`, `Joiner`). */
export function channelLink(channel: RTCDataChannel): Link {
  let heard: (text: string) => void = () => undefined;
  const shut: (() => void)[] = [];
  let gone = channel.readyState === 'closing' || channel.readyState === 'closed';
  const end = (): void => {
    if (gone) return;
    gone = true;
    for (const s of shut) s();
  };
  const joiner = new Joiner();
  channel.addEventListener('message', (event: MessageEvent) => {
    if (gone) return;
    const text = joiner.take(String(event.data));
    if (text !== null) heard(text);
  });
  channel.addEventListener('close', end);
  channel.addEventListener('error', end);
  return {
    send: (text) => {
      if (gone || channel.readyState !== 'open') return;
      for (const piece of pieces(text)) channel.send(piece);
    },
    onText: (h) => {
      heard = h;
    },
    onClose: (s) => {
      shut.push(s);
      if (gone) s();
    },
    close: () => {
      channel.close();
      end();
    },
  };
}

/**
 * A link that is not there yet: what is sent kept until one is given (`attach`), and handed on to it then - a guest's
 * wire, trying again after its link dropped, waits on it while its player and the host carry the codes between them.
 */
export function heldLink(): { link: Link; attach(real: Link): void } {
  let real: Link | null = null;
  const sent: string[] = [];
  let heard: (text: string) => void = () => undefined;
  const shut: (() => void)[] = [];
  let closed = false;
  return {
    link: {
      send: (text) => (real === null ? void sent.push(text) : real.send(text)),
      onText: (h) => {
        heard = h;
        real?.onText(h);
      },
      onClose: (s) => {
        shut.push(s);
        if (real !== null) real.onClose(s);
        else if (closed) s();
      },
      close: () => {
        if (real !== null) return real.close();
        closed = true;
        for (const s of shut) s();
      },
    },
    attach(given) {
      if (real !== null || closed) return given.close();
      real = given;
      given.onText(heard);
      for (const s of shut) given.onClose(s);
      for (const text of sent.splice(0)) given.send(text);
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
