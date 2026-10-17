/**
 * A guest's page at a peer game losing the host and coming back (`peer-play.ts`): the wire's first way in the channel it
 * met the host with; that channel closed, the page told it is cut off, and the wire, trying again, given a link that
 * waits - what it sends kept - until the channel the codes opened since is given, which it goes on over.
 */

import { describe, expect, it } from 'vitest';
import { onPeerLost, joinedOver, peerLost, peerWire, rejoinedOver } from './peer-play';
import { answer, reply } from './connect';
import { encode } from './connect';
import { heldLink, type Link } from './link';

/** Enough of a data channel for a link: what it was sent, and a close. */
class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  readonly sent: string[] = [];
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
  /** Something said by the host's end. */
  say(message: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

const channel = (): RTCDataChannel & FakeChannel => new FakeChannel() as RTCDataChannel & FakeChannel;

describe("a guest's page cut off from the host, and back", () => {
  it('waits on the link that comes back, what the wire sent meanwhile handed on to it', async () => {
    const first = channel();
    joinedOver(first);
    const told: boolean[] = [];
    onPeerLost((lost) => told.push(lost));
    const wire = peerWire('join')!;
    expect(wire.options).toEqual({ join: 'peer' });
    const met = wire.connect();
    const joining = met.send({ op: 'join' });
    first.say({ id: 1, ok: 'joined' });
    expect(await joining).toEqual({ id: 1, ok: 'joined' });

    first.close();
    expect(peerLost()).toBe(true);
    // The wire tries again: given a link that waits, its message kept.
    const again = wire.connect();
    const resuming = again.send({ op: 'resume' });
    let answered = false;
    void resuming.then(() => (answered = true));
    await new Promise((wait) => setTimeout(wait, 10));
    expect(answered).toBe(false);

    const back = channel();
    rejoinedOver(back);
    expect(peerLost()).toBe(false);
    expect(back.sent.map((text) => JSON.parse(text) as unknown)).toEqual([{ op: 'resume', id: 1 }]);
    back.say({ id: 1, ok: { board: {} } });
    expect(await resuming).toEqual({ id: 1, ok: { board: {} } });
    expect(told).toEqual([true, false]);

    // Back before the wire tried again: given the link when it does.
    back.close();
    const sooner = channel();
    rejoinedOver(sooner);
    const after = wire.connect();
    void after.send({ op: 'resume' });
    expect(sooner.sent).toHaveLength(1);
  });
});

describe('a held link', () => {
  it('keeps what is sent until it is given a link, and hands on its closing', () => {
    const held = heldLink();
    const heard: string[] = [];
    let shut = 0;
    held.link.onText((text) => heard.push(text));
    held.link.onClose(() => shut++);
    held.link.send('one');
    held.link.send('two');
    const sent: string[] = [];
    let hear: (text: string) => void = () => undefined;
    let close: () => void = () => undefined;
    const real: Link = { send: (t) => void sent.push(t), onText: (h) => (hear = h), onClose: (s) => (close = s), close: () => close() };
    held.attach(real);
    expect(sent).toEqual(['one', 'two']);
    hear('back');
    expect(heard).toEqual(['back']);
    held.link.close();
    expect(shut).toBe(1);
  });

  it('closed before it is given one, closes what it is given', () => {
    const held = heldLink();
    let shut = false;
    held.link.onClose(() => (shut = true));
    held.link.close();
    expect(shut).toBe(true);
    let given = false;
    held.attach({ send: () => undefined, onText: () => undefined, onClose: () => undefined, close: () => (given = true) });
    expect(given).toBe(true);
  });
});

describe("a peer game's codes, each of its kind", () => {
  it('says which code was wanted when another is pasted', async () => {
    const who = { id: 'peer-1', name: 'Gus' };
    const rejoin = await encode({ v: 1, k: 'rejoin', sdp: 'x', who });
    const invitation = await encode({ v: 1, k: 'invite', sdp: 'x' });
    await expect(reply(rejoin, who)).rejects.toThrow('That is not an invitation code');
    await expect(answer(invitation)).rejects.toThrow("That is not a player's code");
    await expect(answer(await encode({ v: 1, k: 'rejoin', sdp: 'x' }))).rejects.toThrow("That is not a player's code");
  });
});
