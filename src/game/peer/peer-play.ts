/**
 * The page at a peer game (`docs/PEER.md`): `?peer=host` hosts one, `?peer=join` joins one - no server either way.
 *
 * The host's page keeps the game (`HostTable`, over an engine of its own) and plays through it as a guest does, over
 * a port (`link.ts`); it is opened as a lobby, so the players gather and take their seats before the host starts it.
 * Each guest is invited by hand (`inviteGuest`, `connect.ts`): a code out, a reply back, a channel open, the guest at
 * the table. A guest's page meets the host before it boots (`peer-join.ts`), reads the project the game is played
 * over through the channel, and boots over it - then the wire joins the game over the same channel.
 *
 * Who a page is at a peer game (`peerSelf`): an id of its own, kept for the tab (a reload keeps it; another tab,
 * even of the same browser, is somebody else), and the name it gave (`?as=`, else the last it gave, else the host's
 * or a guest's), kept in the browser.
 */

import type { Transport, WireOptions } from '../wire';
import { HostTable, type Member } from './host-table';
import { LinkTransport, channelLink, heldLink, linkedPorts, type Link } from './link';
import { answer, invite, type Invitation } from './connect';

export type PeerMode = 'host' | 'join';

const ID_KEY = 'tactical:peer-id';
const NAME_KEY = 'tactical:peer-name';
export const LONGEST_NAME = 40;

/** Whether the page was opened to host a peer game or to join one (`?peer=`). */
export function peerMode(search: string = globalThis.location?.search ?? ''): PeerMode | null {
  const asked = new URLSearchParams(search).get('peer');
  return asked === 'host' || asked === 'join' ? asked : null;
}

function fresh(): string {
  const buffer = new Uint8Array(8);
  crypto.getRandomValues(buffer);
  return `peer-${Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A name as a peer game takes it: trimmed, at most `LONGEST_NAME` characters, or `fallback`. */
export function nameFrom(text: string | null | undefined, fallback: string): string {
  const name = [...(text ?? '').trim()].slice(0, LONGEST_NAME).join('');
  return name === '' ? fallback : name;
}

/** The name the page last gave at a peer game, or none. */
export function lastName(): string | null {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? null;
  } catch {
    return null;
  }
}

/** A name given, kept for next time. */
export function keepName(name: string): void {
  try {
    globalThis.localStorage?.setItem(NAME_KEY, name);
  } catch {
    // Storage refused: the name is asked again next time.
  }
}

let self: Member | null = null;

/** Who this page is at a peer game: its id for the tab, and its name. */
export function peerSelf(search: string = globalThis.location?.search ?? ''): Member {
  if (self !== null) return self;
  let id: string | null = null;
  try {
    id = globalThis.sessionStorage?.getItem(ID_KEY) ?? null;
    if (id === null) {
      id = fresh();
      globalThis.sessionStorage?.setItem(ID_KEY, id);
    }
  } catch {
    id ??= fresh();
  }
  const name = nameFrom(new URLSearchParams(search).get('as') ?? lastName(), peerMode(search) === 'host' ? 'Host' : 'Guest');
  self = { id, name };
  return self;
}

/** The page's name at the peer game changed (a guest names themself as they join). */
export function renamed(name: string): void {
  self = { ...peerSelf(), name };
  keepName(name);
}

let table: HostTable | null = null;
let guest: LinkTransport | null = null;
let wiredMode: PeerMode | null = null;

/** The game the host's page keeps, once it is made (`prepareHost`). */
export function hostTable(): HostTable | null {
  return table;
}

/** The host's table made, over an engine of its own - before the page's game is, which plays through it. */
export function prepareHost(engine: ConstructorParameters<typeof HostTable>[0], options: ConstructorParameters<typeof HostTable>[2] = {}): HostTable {
  table = new HostTable(engine, peerSelf(), options);
  return table;
}

/** The guest's link to the host now, if one is open; whether it is lost, and who is told when that changes. */
let guestLink: Link | null = null;
let lost = false;
const losing = new Set<(lost: boolean) => void>();

function setLost(now: boolean): void {
  if (lost === now) return;
  lost = now;
  for (const listener of losing) listener(now);
}

/** A guest's channel to the host as the link they play over: lost when it closes, unless another came since. */
function linked(channel: RTCDataChannel): Link {
  const link = channelLink(channel);
  guestLink = link;
  link.onClose(() => {
    if (guestLink !== link) return;
    guestLink = null;
    setLost(true);
  });
  setLost(false);
  return link;
}

/** The guest's page met the host: the channel it boots and plays over. */
export function joinedOver(channel: RTCDataChannel): LinkTransport {
  guest = new LinkTransport(linked(channel));
  return guest;
}

/** The transport a guest's page met the host with, until the wire takes it. */
export function guestTransport(): LinkTransport | null {
  return guest;
}

/** Whether the guest's link to the host is lost, and none come back yet. */
export function peerLost(): boolean {
  return lost;
}

/** Told whenever the guest's link is lost or back; what to call to stop. */
export function onPeerLost(listener: (lost: boolean) => void): () => void {
  losing.add(listener);
  return () => losing.delete(listener);
}

/** The link a guest's wire waits on while its player and the host carry the codes: given its channel when it opens. */
let waiting: ReturnType<typeof heldLink> | null = null;

/** A guest back: the channel opened by the codes carried since their link dropped - the wire, waiting, goes on over it. */
export function rejoinedOver(channel: RTCDataChannel): void {
  const link = linked(channel);
  if (waiting !== null) {
    waiting.attach(link);
    waiting = null;
  } else {
    // The wire has not tried again yet: it is given this when it does.
    ready = link;
  }
}

let ready: Link | null = null;

/** What a guest's wire is given when it tries again: the link come back, else one that waits for it. */
function again(): Transport {
  if (ready !== null) {
    const link = ready;
    ready = null;
    return new LinkTransport(link);
  }
  waiting ??= heldLink();
  return new LinkTransport(waiting.link);
}

/**
 * The wire's way to the peer game, and how it opens - `null` when the page is at none. The host opens its table's
 * game as a lobby; a guest joins over the channel it met the host with, once - a guest whose channel closes plays on
 * alone, the host out of reach until they are invited again.
 */
export function peerWire(mode: PeerMode | null = peerMode()): { connect: () => Transport; options: WireOptions } | null {
  if (mode === 'host' && table !== null) {
    const keeping = table;
    wiredMode = 'host';
    return {
      connect: () => {
        const [page, tables] = linkedPorts();
        keeping.attach(tables, peerSelf(), true);
        return new LinkTransport(page);
      },
      options: { lobby: true, visibility: 'invite' },
    };
  }
  if (mode === 'join' && guest !== null) {
    let first: Transport | null = guest;
    wiredMode = 'join';
    return {
      connect: () => {
        const given = first ?? again();
        first = null;
        return given;
      },
      options: { join: 'peer' },
    };
  }
  return null;
}

/** Whether the page plays at a peer game, and which side of it. */
export function peering(): PeerMode | null {
  return wiredMode;
}

/** A guest invited by the host: a code to send, their reply pasted, and they are at the table. */
export interface Invited {
  code: string;
  /** Their reply pasted: who came, once their channel is open and at the table. */
  accept(reply: string): Promise<Member>;
  close(): void;
}

/** A guest's own code, pasted by the host: who sent it, the answer to send back, and them at the table once it opens. */
export async function answerGuest(code: string, answering: typeof answer = answer): Promise<{ who: Member; code: string; joined: Promise<Member> }> {
  const keeping = table;
  if (keeping === null) throw new Error('This page hosts no peer game.');
  const answered = await answering(code);
  return {
    who: answered.who,
    code: answered.code,
    joined: answered.channel.then((channel) => {
      keeping.attach(channelLink(channel), answered.who);
      return answered.who;
    }),
  };
}

/** An invitation for one more guest, from the host's page. */
export async function inviteGuest(making: () => Promise<Invitation> = () => invite()): Promise<Invited> {
  const keeping = table;
  if (keeping === null) throw new Error('This page hosts no peer game.');
  const invitation = await making();
  return {
    code: invitation.code,
    async accept(reply) {
      const { channel, who } = await invitation.accept(reply);
      keeping.attach(channelLink(channel), who);
      return who;
    },
    close: () => invitation.close(),
  };
}

declare global {
  interface Window {
    /** A peer game, for a test: the guest's link to the host cut, as a network gone would cut it. */
    __peer?: { drop: () => void };
  }
}

if (typeof window !== 'undefined') window.__peer = { drop: () => guestLink?.close() };
