/**
 * A peer game's connections (`link.ts`), its codes (`connect.ts`) and who a page is at one (`peer-play.ts`).
 */

import { describe, expect, it } from 'vitest';
import { LinkTransport, linkedPorts } from './link';
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
