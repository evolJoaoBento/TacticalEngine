/**
 * The shared game, as the page shows it (`docs/SERVER.md`, phase 5, slices 3 to 5): who is at the game the page
 * plays on the server, who plays whom, and the invitation others join it with - the table the wire is told
 * (`wire.ts`, `SharedTable`) - and the host's word on who plays whom (`seat`). Whether a question open is the
 * page's to answer (`answers`): the engine refuses an answer from anybody else, so the panels show it only to
 * whoever plays the character it is put to, and the others whom it waits on (`waitingOn`). A game opened as a
 * lobby (`?host`) is not started until its host says (`start`); until then the players take their own seats
 * (`seatFor`), and the lobby is shown over the board (`ui/Lobby.tsx`). Who may find it in the list of games to join is
 * the host's to say (`?host=public|friends|invite`, `changeVisibility`; phase 6, slice 3). And what is said at the
 * table (`chat`, `say`; phase 6, slice 5), shown in the lobby and over the game (`ui/Chat.tsx`).
 *
 * The Players section of the settings reads it (`ui/Players.tsx`); a test reads it too (`window.__table`). A page
 * that plays with no server has no table.
 */

import type { ChatLine, Seating, SharedTable, Visibility, Wire } from './wire';

/** A character the table can seat: its id and the name the page shows. */
export interface Seatable {
  id: string;
  name: string;
}

let table: SharedTable | null = null;
let you: () => string | null = () => null;
let seatWith: ((character: string, account: string | null) => Promise<boolean>) | null = null;
let startWith: (() => Promise<boolean>) | null = null;
let visibilityWith: ((visibility: Visibility) => Promise<boolean>) | null = null;
let party: () => Seatable[] = () => [];
const heard = new Set<(table: SharedTable | null) => void>();
let lines: ChatLine[] = [];
let sayWith: ((text: string) => Promise<string | null>) | null = null;
const hearing = new Set<(chat: ChatLine[]) => void>();

/** What has been said at the table of the game the page plays, oldest first; nothing at no table. */
export function chat(): ChatLine[] {
  return lines;
}

/** Told whenever more is said at the table; what to call to stop. */
export function onChat(listener: (chat: ChatLine[]) => void): () => void {
  hearing.add(listener);
  return () => hearing.delete(listener);
}

function toldChat(next: ChatLine[]): void {
  lines = next;
  for (const listener of hearing) listener(next);
}

/** Something said at the table: `null` once everybody has been told it, or why not. */
export function say(text: string): Promise<string | null> {
  return sayWith?.(text) ?? Promise.resolve('not at a game');
}

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
  toldChat([]);
  sayWith = wire === null ? null : (text) => wire.say(text);
  wire?.onChat(toldChat);
  party = members;
  you = () => wire?.you ?? null;
  seatWith = wire === null ? null : (character, account) => wire.seat(character, account);
  startWith = wire === null ? null : () => wire.startGame();
  visibilityWith = wire === null ? null : (visibility) => wire.setVisibility(visibility);
  wire?.onTable(told);
}

/** Who is at a game, as its lobby and its panel list them: the host said, and a member whose page has gone, away. */
export function membersLine(table: SharedTable): string {
  const away = (id: string): boolean => table.here !== undefined && !table.here.includes(id);
  return table.members.map((member) => `${member.name}${member.id === table.host ? ' (host)' : ''}${away(member.id) ? ' (away)' : ''}`).join(' · ');
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
  return plays(table === null ? null : { you: you() ?? '', host: table.host, seats: table.seats, started: table.started }, character);
}

/**
 * Whether an account plays a character, as a seating says: the rule `playsFor` reads the page's table with. Nobody
 * plays anybody at a game not started.
 */
export function plays(seating: Seating | null, character: string | null | undefined): boolean {
  if (seating === null) return true;
  if (seating.started === false) return false;
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

/** Whether the game the page plays has started: a lobby's has not; a game nobody shares always has. */
export function started(): boolean {
  return table === null || table.started !== false;
}

/** The account the page plays as at its game, as the server says; none at no table. */
export function playingAs(): string | null {
  return table === null ? null : you();
}

/**
 * What the page's player may do about a seat, as the server rules it (`play.rs`): the host says who plays whom, at
 * any time; before the game starts anybody takes a seat nobody has (`take`) - and that a save hosted again does not
 * keep for a player not back yet (`kept`) - or leaves their own (`leave`).
 */
export function seatFor(character: string): 'choose' | 'take' | 'leave' | null {
  if (table === null) return null;
  if (hosting()) return 'choose';
  if (table.started !== false) return null;
  const seated = table.seats[character];
  if (seated === undefined) return table.kept?.[character] === undefined ? 'take' : null;
  return seated === you() ? 'leave' : null;
}

/** The game started, as its host says: whether the server took it. */
export function start(): Promise<boolean> {
  return startWith?.() ?? Promise.resolve(false);
}

/** Who may find the game in the list of games to join, as its host says: whether the server took it. */
export function changeVisibility(visibility: Visibility): Promise<boolean> {
  return visibilityWith?.(visibility) ?? Promise.resolve(false);
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

/** Whether the page was opened to host its game as a lobby, others gathering before it starts (`?host`). */
export function lobbyAsked(search: string = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).has('host');
}

/** Who the page asked may find the lobby it hosts (`?host=public|friends`); invitation alone for anything else. */
export function visibilityAsked(search: string = globalThis.location?.search ?? ''): Visibility {
  const asked = new URLSearchParams(search).get('host');
  return asked === 'public' || asked === 'friends' ? asked : 'invite';
}

/**
 * The invitation in what a friend pasted: the link the host sent (its `?join=`), or the invitation alone. `null`
 * for anything else.
 */
export function inviteFrom(pasted: string): string | null {
  const text = pasted.trim();
  const query = text.indexOf('?');
  const invite = query === -1 ? text : invitationOf(text.slice(query));
  return invite !== null && /^[0-9a-f]{32}$/.test(invite) ? invite : null;
}

declare global {
  interface Window {
    /** The shared game's table, for a test: who is at it, who plays whom; the host's seating. */
    __table?: { table: () => SharedTable | null; seat: typeof seat; seatable: typeof seatable; start: typeof start };
  }
}

if (typeof window !== 'undefined') window.__table = { table: sharedTable, seat, seatable, start };
