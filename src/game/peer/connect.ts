/**
 * How two pages find each other with no server between them (`docs/PEER.md`): WebRTC, its handshake carried by hand.
 *
 * The host makes an invitation (`invite`): a connection offering a data channel, every way it may be reached gathered
 * into it, written out as a code to send - by chat, mail, anything. The guest pastes it (`reply`), and their page
 * writes back a reply code, which says who they are (`Member`) as well as how to reach them; the host pastes that
 * (`Invitation.accept`), and the channel opens. One invitation is one guest: another needs another. Or the other way
round (`ask`, `answer`): the guest's code first, saying who they are, and the host's answer back - for a guest coming
back, whom the host is not waiting for with an invitation. Each of the four kinds of code is marked (`k`), and a box
given another kind says which it wanted. A channel closes when its connection fails, so the link it carries ends.
 *
 * The ways a page may be reached are found with a STUN server (`ICE`), which tells a page the address the internet
 * sees it at - nothing of the game passes through it. Two pages behind networks that will not let a stranger in (some
 * phone networks, some offices) cannot meet this way at all; that would take a relay (TURN), which this does not have.
 * On one machine, or one network, no STUN is needed (`?ice=none`, which the tests use).
 *
 * A code is `TE1.` and the description, deflated and in URL-safe base64, where the browser can deflate (all current
 * ones can); else `TE0.` and the description as it is.
 */

import type { Member } from './host-table';

export const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** The STUN servers a page asked for: none for `?ice=none`, else `ICE`. */
export function iceFrom(search: string = globalThis.location?.search ?? ''): RTCIceServer[] {
  return new URLSearchParams(search).get('ice') === 'none' ? [] : ICE;
}

/** How long to wait for the ways a page may be reached before writing the code with those found. */
const GATHERING_MS = 5000;

/** How long a channel may take to open once the answer is in. */
const OPENING_MS = 20000;

/** What a code carries: which of the four it is, the page's description of itself, and - from a guest - who they are. */
type Kind = 'invite' | 'reply' | 'rejoin' | 'answer';

interface Carried {
  v: 1;
  k: Kind;
  sdp: string;
  who?: Member;
}

/** What to say when a code of another kind is pasted where one of these was asked for. */
const WRONG: Record<Kind, string> = {
  invite: 'That is not an invitation code: paste the whole code your host sent.',
  reply: 'That is not a reply code: paste the whole code your guest sent back.',
  rejoin: "That is not a player's code: paste the whole code your player sent.",
  answer: "That is not your host's answer: paste the whole code your host sent back.",
};

/** A code of the kind asked for, read; else why not. */
async function carried(code: string, kind: Kind, from: boolean): Promise<Carried> {
  const read = (await decode(code)) as Partial<Carried> | null;
  const who = read?.who;
  const fromOk = !from || (typeof who?.id === 'string' && typeof who.name === 'string');
  if (read === null || read.v !== 1 || read.k !== kind || typeof read.sdp !== 'string' || !fromOk) throw new Error(WRONG[kind]);
  return read as Carried;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Something written out as a code. */
export async function encode(value: unknown): Promise<string> {
  const text = JSON.stringify(value);
  if (typeof CompressionStream === 'undefined') return `TE0.${toBase64Url(new TextEncoder().encode(text))}`;
  return `TE1.${toBase64Url(await through(new TextEncoder().encode(text), new CompressionStream('deflate-raw')))}`;
}

/** A code read back; `null` for anything that is not one. */
export async function decode(code: string): Promise<unknown> {
  const text = code.replace(/\s+/g, '');
  try {
    if (text.startsWith('TE0.')) return JSON.parse(new TextDecoder().decode(fromBase64Url(text.slice(4))));
    if (text.startsWith('TE1.')) return JSON.parse(new TextDecoder().decode(await through(fromBase64Url(text.slice(4)), new DecompressionStream('deflate-raw'))));
  } catch {
    return null;
  }
  return null;
}

/** Every way the connection may be reached gathered - or what was found in the time given. */
function gathered(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, GATHERING_MS);
    connection.addEventListener('icegatheringstatechange', () => {
      if (connection.iceGatheringState === 'complete') {
        clearTimeout(timer);
        done();
      }
    });
  });
}

/**
 * A channel open, or why not; and closed when its connection fails or closes - which a network gone does not say on
 * the channel itself - so the link it carries ends, and the page knows it is cut off.
 */
function opened(channel: RTCDataChannel, connection: RTCPeerConnection): Promise<RTCDataChannel> {
  connection.addEventListener('connectionstatechange', () => {
    if (connection.connectionState === 'failed' || connection.connectionState === 'closed') channel.close();
  });
  if (channel.readyState === 'open') return Promise.resolve(channel);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('The connection did not open: the two of you may be on networks that keep strangers out.')), OPENING_MS);
    channel.addEventListener('open', () => {
      clearTimeout(timer);
      done(channel);
    });
    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState === 'failed') {
        clearTimeout(timer);
        fail(new Error('The connection failed: the two of you may be on networks that keep strangers out.'));
      }
    });
  });
}

export interface Invitation {
  /** The code to send the guest. */
  code: string;
  /** The guest's reply pasted: the channel open, and who they said they are. */
  accept(reply: string): Promise<{ channel: RTCDataChannel; who: Member }>;
  /** Given up on. */
  close(): void;
}

/** A connection offering the channel, its description gathered: the first half of either handshake. */
async function offering(iceServers: RTCIceServer[]): Promise<{ connection: RTCPeerConnection; channel: RTCDataChannel; sdp: string }> {
  const connection = new RTCPeerConnection({ iceServers });
  const channel = connection.createDataChannel('play', { ordered: true });
  await connection.setLocalDescription(await connection.createOffer());
  await gathered(connection);
  return { connection, channel, sdp: connection.localDescription?.sdp ?? '' };
}

/** An offer answered, the answer gathered: the second half; the channel the offer's side opens. */
async function answering(sdp: string, iceServers: RTCIceServer[]): Promise<{ sdp: string; channel: Promise<RTCDataChannel> }> {
  const connection = new RTCPeerConnection({ iceServers });
  const channel = new Promise<RTCDataChannel>((done) => connection.addEventListener('datachannel', (event) => done(event.channel)));
  await connection.setRemoteDescription({ type: 'offer', sdp });
  await connection.setLocalDescription(await connection.createAnswer());
  await gathered(connection);
  return { sdp: connection.localDescription?.sdp ?? '', channel: channel.then((c) => opened(c, connection)) };
}

/** An invitation for one guest: the host's half first. */
export async function invite(iceServers: RTCIceServer[] = iceFrom()): Promise<Invitation> {
  const { connection, channel, sdp } = await offering(iceServers);
  return {
    code: await encode({ v: 1, k: 'invite', sdp } satisfies Carried),
    async accept(reply) {
      const replied = await carried(reply, 'reply', true);
      await connection.setRemoteDescription({ type: 'answer', sdp: replied.sdp });
      return { channel: await opened(channel, connection), who: { id: replied.who!.id, name: replied.who!.name } };
    },
    close: () => connection.close(),
  };
}

export interface Reply {
  /** The code to send back to the host. */
  code: string;
  /** The channel, once the host has pasted the reply. */
  channel: Promise<RTCDataChannel>;
}

/** The host's invitation pasted by a guest: the reply to send back, and the channel it opens. */
export async function reply(code: string, who: Member, iceServers: RTCIceServer[] = iceFrom()): Promise<Reply> {
  const offered = await carried(code, 'invite', false);
  const { sdp, channel } = await answering(offered.sdp, iceServers);
  return { code: await encode({ v: 1, k: 'reply', sdp, who } satisfies Carried), channel };
}

/**
 * The other way round: a guest's half first (`ask`), for a host who is not waiting with an invitation - a guest whose
 * link dropped, coming back in the same tab, or one whose page was opened again. The host pastes it (`answer`) and
 * sends their answer back, which the guest pastes (`Asked.accept`).
 */
export interface Asked {
  code: string;
  accept(answer: string): Promise<RTCDataChannel>;
  close(): void;
}

export async function ask(who: Member, iceServers: RTCIceServer[] = iceFrom()): Promise<Asked> {
  const { connection, channel, sdp } = await offering(iceServers);
  return {
    code: await encode({ v: 1, k: 'rejoin', sdp, who } satisfies Carried),
    async accept(answer) {
      const answered = await carried(answer, 'answer', false);
      await connection.setRemoteDescription({ type: 'answer', sdp: answered.sdp });
      return opened(channel, connection);
    },
    close: () => connection.close(),
  };
}

/** A guest's code pasted by the host: who sent it, the answer to send back, and the channel it opens. */
export async function answer(code: string, iceServers: RTCIceServer[] = iceFrom()): Promise<{ who: Member; code: string; channel: Promise<RTCDataChannel> }> {
  const asked = await carried(code, 'rejoin', true);
  const { sdp, channel } = await answering(asked.sdp, iceServers);
  return { who: { id: asked.who!.id, name: asked.who!.name }, code: await encode({ v: 1, k: 'answer', sdp } satisfies Carried), channel };
}
