/**
 * The shared game, as the page shows it (`docs/SERVER.md`, phase 5, slice 3): who is at the game the page plays
 * on the server, who plays whom, and the invitation others join it with - the table the wire is told
 * (`wire.ts`, `SharedTable`) - and the host's word on who plays whom (`seat`).
 *
 * The Players section of the settings reads it (`ui/Players.tsx`); a test reads it too (`window.__table`). A page
 * that plays with no server has no table.
 */

import type { SharedTable, Wire } from './wire';

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
