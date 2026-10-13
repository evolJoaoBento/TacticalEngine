/**
 * The shared game, as the page shows it (`docs/SERVER.md`, phase 5, slices 3 and 4): who is at the game the page
 * plays on the server, who plays whom, and the invitation others join it with - the table the wire is told
 * (`wire.ts`, `SharedTable`) - and the host's word on who plays whom (`seat`). Whether a question open is the
 * page's to answer (`answers`): the engine refuses an answer from anybody else, so the panels show it only to
 * whoever plays the character it is put to, and the others whom it waits on (`waitingOn`).
 *
 * The Players section of the settings reads it (`ui/Players.tsx`); a test reads it too (`window.__table`). A page
 * that plays with no server has no table.
 */

import type { Seating, SharedTable, Wire } from './wire';

/** A character the table can seat: its id and the name the page shows. */
export interface Seatable {
  id: string;
  name: string;
}

let table: SharedTable | null = null;
let you: () => string | null = () => null;
let seatWith: ((character: string, account: string | null) => Promise<boolean>) | null = null;
let party: () => Seatable[] = () => [];
const heard = new Set<(table: SharedTable | null) => void>();

/** The table of the game the page plays now, as the server last said it; none without a server. */
export function sharedTable(): SharedTable | null {
  return table;
}

/** Told whenever the table changes - another joined, a seat given; what to call to stop. */
export function onSharedTable(listener: (table: SharedTable | null) => void): () => void {
  heard.add(listener);
  return () => heard.delete(listener);
}

function told(next: SharedTable | null): void {
  table = next;
  for (const listener of heard) listener(next);
}

/**
 * The wire of the game the page plays now, and its party: what the table is told from, and who may be seated.
 * `null` when the page plays with no server, which has no table.
 */
export function tableOf(wire: Wire | null, members: () => Seatable[] = () => []): void {
  told(null);
  party = members;
  you = () => wire?.you ?? null;
  seatWith = wire === null ? null : (character, account) => wire.seat(character, account);
  wire?.onTable(told);
}

/** Whether the page plays as the host of its game, as the server says who it plays as. */
export function hosting(): boolean {
  return table !== null && you() === table.host;
}

/**
 * Whether the page plays a character at its game: the one seated in it, or the host for one nobody is seated in -
 * and, for nobody in particular, the host. Every one, at no table. The engine's own rule (`engine::game::seats`),
 * which refuses the rest; this only decides what the page shows.
 */
export function playsFor(character: string | null | undefined): boolean {
  return plays(table === null ? null : { you: you() ?? '', host: table.host, seats: table.seats }, character);
}

/** Whether an account plays a character, as a seating says: the rule `playsFor` reads the page's table with. */
export function plays(seating: Seating | null, character: string | null | undefined): boolean {
  if (seating === null) return true;
  const seated = character === null || character === undefined ? undefined : seating.seats[character];
  return seated === undefined ? seating.you === seating.host : seated === seating.you;
}

/** Whether a question open is the page's to answer: put to a character it plays. */
export function answers(pending: { for?: string | null } | null): boolean {
  return pending === null || playsFor(pending.for);
}

/**
 * Whom a question the page does not answer waits on, as the panels say it: the character's player by name, or the
 * host for a question about nobody in particular. `null` when it is the page's own.
 */
export function waitingOn(pending: { for?: string | null } | null, nameOf: (character: string) => string): string | null {
  if (pending === null || table === null || answers(pending)) return null;
  const character = pending.for ?? null;
  const account = (character === null ? undefined : table.seats[character]) ?? table.host;
  const player = table.members.find((member) => member.id === account)?.name ?? account;
  return character === null ? `Waiting for ${player}.` : `Waiting for ${player} to answer for ${nameOf(character)}.`;
}

/** The characters the host may seat players in. */
export function seatable(): Seatable[] {
  return party();
}

/** Who plays a character - an account at the game, or nobody - as the host says: whether the server took it. */
export function seat(character: string, account: string | null): Promise<boolean> {
  return seatWith?.(character, account) ?? Promise.resolve(false);
}

/** The address a friend opens to join the game: the page's own, with the invitation. */
export function invitationLink(invite: string, origin: string = globalThis.location?.origin ?? ''): string {
  return `${origin}/?join=${encodeURIComponent(invite)}`;
}

/** The invitation the page was opened with to join a game (`?join=`), if one. */
export function invitationOf(search: string = globalThis.location?.search ?? ''): string | null {
  const invite = new URLSearchParams(search).get('join');
  return invite === null || invite === '' ? null : invite;
}

declare global {
  interface Window {
    /** The shared game's table, for a test: who is at it, who plays whom; the host's seating. */
    __table?: { table: () => SharedTable | null; seat: typeof seat; seatable: typeof seatable };
  }
}

if (typeof window !== 'undefined') window.__table = { table: sharedTable, seat, seatable };
