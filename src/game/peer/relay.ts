/**
 * The peer games' relay, from the page (`docs/PEER.md`, "A link instead of codes"; `server/serve/src/peer.rs`): where
 * the Rust server serves the page, it carries the codes a peer game's pages trade, so a guest joins - and comes back -
 * by opening a link. The host's page opens a room (`openRoom`, signed in), takes the knocks left at it and answers
 * each (`takeKnocks`, `answerKnock`) - or turns it away; a guest's page knocks with its own code (`knock`) and waits
 * for the answer (`waitForAnswer`), which is the host's code, or `false` for a guest turned away. The codes are the guest-first handshake's (`connect.ts`, `ask` and `answer`): nothing new about
 * WebRTC, only who carries the codes.
 *
 * Anything that fails - no server behind the page, nobody signed in, the room gone - is `null`, and the page falls
 * back to codes carried by hand. A static build has no server, and never asks (`relayAllowed`).
 */

import { hasServer, type Built } from '../play-socket';

export const PEER_URL = '/__peer';
/** The header the host's page proves its room with (`peer.rs`, `SECRET_HEADER`). */
const SECRET_HEADER = 'x-peer-secret';
const SAVE_HEADER = 'x-tactical-save';

export interface Room {
  room: string;
  secret: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

const posting = (body: unknown, secret?: string): RequestInit => ({
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'content-type': 'application/json', [SAVE_HEADER]: '1', ...(secret === undefined ? {} : { [SECRET_HEADER]: secret }) },
  body: JSON.stringify(body),
});

/** Whether the page may ask a relay: where a server is behind it, unless turned off (`?relay=off`). */
export function relayAllowed(built: Built = import.meta.env, search: string = globalThis.location?.search ?? ''): boolean {
  return hasServer(built) && new URLSearchParams(search).get('relay') !== 'off';
}

/** What a request answered, read; `null` for one that failed or was refused. */
async function asked(fetching: Promise<{ ok: boolean; json: () => Promise<unknown> }>): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetching;
    if (!response.ok) return null;
    const said = await response.json();
    return typeof said === 'object' && said !== null ? (said as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const roomPath = (room: string): string => `${PEER_URL}/rooms/${encodeURIComponent(room)}`;

/** A room opened for the host's game: `null` where there is no relay, or nobody signed in. */
export async function openRoom(send: Fetch = fetch): Promise<Room | null> {
  const said = await asked(send(`${PEER_URL}/rooms`, posting({})));
  return typeof said?.['room'] === 'string' && typeof said['secret'] === 'string' ? { room: said['room'], secret: said['secret'] } : null;
}

/** A guest's code left at a room: the knock it is known by, or `null`. */
export async function knock(room: string, code: string, send: Fetch = fetch): Promise<string | null> {
  const said = await asked(send(`${roomPath(room)}/knock`, posting({ code })));
  return typeof said?.['knock'] === 'string' ? said['knock'] : null;
}

/** The knocks the host has not taken, taken - `null` when the room is gone, or the relay with it. */
export async function takeKnocks(room: Room, send: Fetch = fetch): Promise<{ knock: string; code: string }[] | null> {
  const said = await asked(send(`${roomPath(room.room)}/knocks`, { credentials: 'same-origin', cache: 'no-store', headers: { [SECRET_HEADER]: room.secret } }));
  const knocks = said?.['knocks'];
  if (!Array.isArray(knocks)) return null;
  return knocks.filter((k): k is { knock: string; code: string } => typeof (k as { knock?: unknown }).knock === 'string' && typeof (k as { code?: unknown }).code === 'string');
}

/** The host's answer to a knock, left for the guest - their code, or `null` to turn them away: whether the relay took it. */
export async function answerKnock(room: Room, knocked: string, code: string | null, send: Fetch = fetch): Promise<boolean> {
  return (await asked(send(`${roomPath(room.room)}/answers/${encodeURIComponent(knocked)}`, posting(code === null ? { refused: true } : { code }, room.secret)))) !== null;
}

/**
 * The answer to a knock: the code, `false` for a guest turned away, `null` while the host has given none, `undefined`
 * when the room or relay is gone.
 */
export async function answerOf(room: string, knocked: string, send: Fetch = fetch): Promise<string | false | null | undefined> {
  const said = await asked(send(`${roomPath(room)}/answers/${encodeURIComponent(knocked)}`, { credentials: 'same-origin', cache: 'no-store' }));
  if (said === null) return undefined;
  if (said['refused'] === true) return false;
  return typeof said['code'] === 'string' ? said['code'] : null;
}

export interface Waiting {
  /** How often to ask, and for how long before giving up (ms). */
  every?: number;
  within?: number;
  send?: Fetch;
  /** How a wait is waited, for a test. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * The answer to a knock, asked for every so often until it comes: the host's code, `false` for a guest turned away,
 * `null` if none comes in time or the room goes.
 */
export async function waitForAnswer(room: string, knocked: string, { every = 1000, within = 60_000, send = fetch, wait = (ms) => new Promise((done) => setTimeout(done, ms)) }: Waiting = {}): Promise<string | false | null> {
  for (let waited = 0; waited <= within; waited += every) {
    const answer = await answerOf(room, knocked, send);
    if (answer === undefined) return null;
    if (answer !== null) return answer;
    await wait(every);
  }
  return null;
}

/** The link a guest opens to join the game at a room. */
export function roomLink(room: string, origin: string = globalThis.location?.origin ?? ''): string {
  return `${origin}/?peer=join&room=${encodeURIComponent(room)}`;
}

/** The room the page was opened to join (`?room=`), if one. */
export function roomOf(search: string = globalThis.location?.search ?? ''): string | null {
  const room = new URLSearchParams(search).get('room');
  return room !== null && /^[0-9a-f]{32}$/.test(room) ? room : null;
}
