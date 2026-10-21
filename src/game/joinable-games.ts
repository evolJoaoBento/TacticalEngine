/**
 * The games the player signed in may join (`play.rs`, `GET /__play/games`; phase 6, slice 3): every public one, their
 * friends' friends-only ones, and any whose host loaded a save that kept a seat for them, whoever may find it - each
 * with its invitation, so Play Together joins it with no link sent (`MainMenu.tsx`). An invite-only game that keeps
 * nothing for them is not among them: that still takes the link.
 */

import type { Visibility } from './wire';

export const JOINABLE_URL = '/__play/games';

export interface JoinableGame {
  invite: string;
  /** The host's name. */
  host: string;
  /** The project's name. */
  project: string;
  /** How many are at it. */
  players: number;
  started: boolean;
  visibility: Visibility;
  /** The names of the characters it keeps for the player: theirs when they join. */
  kept: string[];
}

export type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** The games whoever is signed in may join: none when the server says nothing, or cannot be reached. */
export async function listJoinable(send: Fetch = (url, init) => fetch(url, init)): Promise<JoinableGame[]> {
  try {
    const response = await send(JOINABLE_URL, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return [];
    const { games } = (await response.json()) as { games?: unknown };
    return Array.isArray(games) ? games.filter(isJoinable) : [];
  } catch {
    return [];
  }
}

function isJoinable(game: unknown): game is JoinableGame {
  if (typeof game !== 'object' || game === null) return false;
  const { invite, host, project, players, started, visibility, kept } = game as Record<string, unknown>;
  return (
    typeof invite === 'string' &&
    invite !== '' &&
    typeof host === 'string' &&
    typeof project === 'string' &&
    typeof players === 'number' &&
    typeof started === 'boolean' &&
    (visibility === 'public' || visibility === 'friends' || visibility === 'invite') &&
    Array.isArray(kept) &&
    kept.every((name) => typeof name === 'string')
  );
}

const listed = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** What a joinable game is called in the menu: who kept whom for the player, or whose it is, how many are at it, and whether it has begun. */
export function joinableLine(game: JoinableGame): string {
  if (game.kept.length > 0) return `${game.host} kept ${listed(game.kept)} for you${game.started ? ', and has begun' : ''}.`;
  const who = game.visibility === 'public' ? 'open to everybody' : game.visibility === 'friends' ? 'for friends' : 'by invitation';
  return `${game.host}'s game, ${who} · ${game.players} at it${game.started ? ', begun' : ', gathering'}.`;
}

/** What Play Together says under its name: a game keeping a seat first, else how many there are to join. */
export function joinableSummary(games: JoinableGame[]): string | null {
  const keeping = games.find((game) => game.kept.length > 0);
  if (keeping !== undefined) return `${keeping.host} has a game waiting for you`;
  if (games.length === 0) return null;
  return games.length === 1 ? `${games[0]!.host} has a game you can join` : `${games.length} games you can join`;
}
