/**
 * A peer game's connections (`link.ts`), its codes (`connect.ts`) and who a page is at one (`peer-play.ts`).
 */

import { describe, expect, it } from 'vitest';
import { Joiner, LinkTransport, PIECE_LONGEST, channelLink, linkedPorts, pieces } from './link';
import { decode, encode, iceFrom, ICE } from './connect';
import { nameFrom, peerMode, LONGEST_NAME } from './peer-play';

describe('a link between a page and the table', () => {
  it('answers each message by its number, gives the rest to whoever listens, and fails what waits when it closes', async () => {
    const [page, table] = linkedPorts();
    table.onText((text) => {
      const message = JSON.parse(text) as { id: number; op: string };
      table.send(JSON.stringify({ table: 'told' }));
      if (message.op !== 'never') table.send(JSON.stringify({ id: message.id, ok: message.op }));
    });
    const transport = new LinkTransport(page);
    const heard: unknown[] = [];
    transport.listen((message) => heard.push(message));
    let closed: boolean | null = null;
    transport.onClose((opened) => (closed = opened));
    expect(await transport.send({ op: 'one' })).toEqual({ id: 1, ok: 'one' });
    expect(await transport.send({ op: 'two' })).toEqual({ id: 2, ok: 'two' });
    expect(heard).toEqual([{ table: 'told' }, { table: 'told' }]);
    const waiting = transport.send({ op: 'never' });
    await new Promise((wait) => setTimeout(wait, 20));
    let shut = false;
    table.onClose(() => (shut = true));
    transport.close();
    await expect(waiting).rejects.toThrow('the connection closed');
    expect(closed).toBe(true);
    await new Promise((wait) => setTimeout(wait, 20));
    expect(shut).toBe(true);
    await expect(transport.send({ op: 'after' })).rejects.toThrow('the connection closed');
  });

  it('closes the page\'s end when the table closes its own', async () => {
    const [page, table] = linkedPorts();
    const transport = new LinkTransport(page);
    const waiting = transport.send({ op: 'one' });
    table.close();
    await expect(waiting).rejects.toThrow('the connection closed');
    expect(transport.closed).toBe(true);
  });
});

describe('a long text on a data channel', () => {
  /** A channel's two ends, as an ordered, reliable data channel keeps what is sent: what one sends, the other hears. */
  function channels(): [RTCDataChannel, RTCDataChannel, string[]] {
    const sent: string[] = [];
    const end = (): RTCDataChannel & { far?: EventTarget } => Object.assign(new EventTarget(), { readyState: 'open' }) as unknown as RTCDataChannel;
    const [one, two] = [end(), end()];
    const wire = (from: RTCDataChannel, to: RTCDataChannel) =>
      Object.assign(from, {
        send: (data: string) => {
          if (data.length > PIECE_LONGEST + 20) throw new Error('Trying to send message larger than max-message-size');
          sent.push(data);
          to.dispatchEvent(new MessageEvent('message', { data }));
        },
      });
    wire(one, two);
    wire(two, one);
    return [one, two, sent];
  }

  it('is sent in pieces no longer than a channel takes, and heard whole', () => {
    const [one, two, sent] = channels();
    const heard: string[] = [];
    channelLink(two).onText((text) => heard.push(text));
    const long = JSON.stringify({ project: 'é'.repeat(PIECE_LONGEST * 2 + 5) });
    channelLink(one).send(long);
    channelLink(one).send('{"op":"short"}');
    expect(sent.length).toBe(4);
    expect(heard).toEqual([long, '{"op":"short"}']);
  });

  it('keeps a text whole that fits, and puts pieces together only once the last has come', () => {
    expect(pieces('{"a":1}')).toEqual(['{"a":1}']);
    const parts = pieces('abcdefg', 3);
    expect(parts.length).toBe(3);
    const joiner = new Joiner();
    expect(parts.map((part) => joiner.take(part))).toEqual([null, null, 'abcdefg']);
    expect(joiner.take('{"b":2}')).toBe('{"b":2}');
    // A text that happens to begin as a piece does is sent as one, so it is never taken for part of another.
    const odd = `${String.fromCharCode(0)}0${String.fromCharCode(0)}x`;
    expect(pieces(odd).map((part) => joiner.take(part))).toEqual([odd]);
  });
});

describe('a peer game\'s codes', () => {
  it('reads back what it wrote, and nothing that is not one', async () => {
    const value = { v: 1, sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'.repeat(20), who: { id: 'peer-1', name: 'Gus' } };
    const code = await encode(value);
    expect(code.startsWith('TE1.')).toBe(true);
    expect(code).toMatch(/^TE1\.[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(JSON.stringify(value).length);
    expect(await decode(code)).toEqual(value);
    expect(await decode(`  ${code.slice(0, 30)}\n${code.slice(30)} `)).toEqual(value);
    expect(await decode('hello')).toBeNull();
    expect(await decode('TE1.!!!')).toBeNull();
    expect(await decode(`TE0.${btoa('{"v":1}')}`)).toEqual({ v: 1 });
  });

  it('asks a STUN server the way out unless told none', () => {
    expect(iceFrom('?peer=host')).toBe(ICE);
    expect(iceFrom('?peer=host&ice=none')).toEqual([]);
  });
});

describe('who a page is at a peer game', () => {
  it('hosts or joins as the address says', () => {
    expect(peerMode('?peer=host')).toBe('host');
    expect(peerMode('?play&peer=join&as=Gus')).toBe('join');
    expect(peerMode('?peer=other')).toBeNull();
    expect(peerMode('?play')).toBeNull();
  });

  it('goes by a name trimmed and cut short, or the one it is given', () => {
    expect(nameFrom('  Gus ', 'Guest')).toBe('Gus');
    expect(nameFrom('   ', 'Guest')).toBe('Guest');
    expect(nameFrom(null, 'Host')).toBe('Host');
    expect([...nameFrom('é'.repeat(LONGEST_NAME + 5), 'x')]).toHaveLength(LONGEST_NAME);
  });
});
