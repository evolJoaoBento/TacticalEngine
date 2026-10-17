/**
 * How two pages find each other with no server between them (`docs/PEER.md`): WebRTC, its handshake carried by hand.
 *
 * The host makes an invitation (`invite`): a connection offering a data channel, every way it may be reached gathered
 * into it, written out as a code to send - by chat, mail, anything. The guest pastes it (`reply`), and their page
 * writes back a reply code, which says who they are (`Member`) as well as how to reach them; the host pastes that
 * (`Invitation.accept`), and the channel opens. One invitation is one guest: another needs another.
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

interface Offered {
  v: 1;
  sdp: string;
}

interface Replied {
  v: 1;
  sdp: string;
  who: Member;
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

/** A channel open, or why not. */
function opened(channel: RTCDataChannel, connection: RTCPeerConnection): Promise<RTCDataChannel> {
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

/** An invitation for one guest. */
export async function invite(iceServers: RTCIceServer[] = iceFrom()): Promise<Invitation> {
  const connection = new RTCPeerConnection({ iceServers });
  const channel = connection.createDataChannel('play', { ordered: true });
  await connection.setLocalDescription(await connection.createOffer());
  await gathered(connection);
  const offered: Offered = { v: 1, sdp: connection.localDescription?.sdp ?? '' };
  return {
    code: await encode(offered),
    async accept(reply) {
      const replied = (await decode(reply)) as Partial<Replied> | null;
      if (replied === null || replied.v !== 1 || typeof replied.sdp !== 'string' || typeof replied.who?.id !== 'string' || typeof replied.who.name !== 'string') {
        throw new Error('That is not a reply code: paste the whole code your guest sent back.');
      }
      await connection.setRemoteDescription({ type: 'answer', sdp: replied.sdp });
      return { channel: await opened(channel, connection), who: { id: replied.who.id, name: replied.who.name } };
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
  const offered = (await decode(code)) as Partial<Offered> | null;
  if (offered === null || offered.v !== 1 || typeof offered.sdp !== 'string') throw new Error('That is not an invitation code: paste the whole code your host sent.');
  const connection = new RTCPeerConnection({ iceServers });
  const channel = new Promise<RTCDataChannel>((done) => connection.addEventListener('datachannel', (event) => done(event.channel)));
  await connection.setRemoteDescription({ type: 'offer', sdp: offered.sdp });
  await connection.setLocalDescription(await connection.createAnswer());
  await gathered(connection);
  const replied: Replied = { v: 1, sdp: connection.localDescription?.sdp ?? '', who };
  return { code: await encode(replied), channel: channel.then((c) => opened(c, connection)) };
}
